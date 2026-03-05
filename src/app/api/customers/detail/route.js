import { google } from "googleapis";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 고객 상세 조회 API (Admin)
 * - Users + Ledger 시트를 읽어 고객 정보/잔액/거래내역을 반환
 * - 표준 응답 스키마: { ok, data, meta } / { ok:false, error:{code,message,detail} }
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/** 필수 env 강제. 없으면 즉시 서버 에러로 처리 */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * ✅  서비스계정 JSON 파싱을 "최대한" 복원해서 처리
 * 케이스 A) env에 JSON이 한 줄(정상) -> 그대로 JSON.parse 성공
 * 케이스 B) private_key에 "실제 개행"이 들어감 -> JSON.parse가 bad control character로 실패
 *        -> 모든 개행을 \\n으로 바꿔서 재시도
 */
function parseServiceAccountKey(raw) {
  const s = String(raw ?? "").trim().replace(/^"(.*)"$/, "$1"); // 혹시 따옴표로 감싸졌으면 제거

  try {
    // 1) 1차 시도: 있는 그대로 파싱
    return JSON.parse(s);
  } catch (e1) {
    try {
      // 2) 2차 시도: 실제 개행을 JSON 이스케이프 형태로 바꿔서 파싱
      const normalized = s.replace(/\r?\n/g, "\\n");
      return JSON.parse(normalized);
    } catch (e2) {
      // 3) 실패 원인을 명확히 노출(디버깅 편하게)
      throw new Error(
        `Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON. ` +
          `Try setting it as single-line JSON with \\n escapes. ` +
          `Original error: ${String(e2?.message || e2)}`,
      );
    }
  }
}

/**  Google Sheets client 생성 */
async function getSheetsClient() {
  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
  const key = parseServiceAccountKey(raw);

  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });

  await jwt.authorize();
  return google.sheets({ version: "v4", auth: jwt });
}

/** 외부 입력을 안전한 문자열로 정규화 */
function toStr(v) {
  return String(v ?? "").trim();
}

/** 숫자 문자열(콤마 포함)을 number로 변환. 실패하면 0 */
function toNum(v) {
  const n = Number(String(v ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 시트 헤더 1행을 기반으로 {컬럼명: index} 매핑 생성 */
function headerIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    map[toStr(h)] = i;
  });
  return map;
}

/** status 컬럼이 있으면 활성/비활성으로 정규화 */
function normalizeStatus(raw) {
  const s = toStr(raw).toLowerCase();
  if (!s) return "active";
  if (["inactive", "disabled", "blocked", "false", "0", "no"].includes(s)) return "inactive";
  return "active";
}

/** 성공 응답 표준화 */
function ok(data, meta = {}, status = 200) {
  return Response.json({ ok: true, data, meta }, { status });
}

/** 실패 응답 표준화 */
function fail(code, message, status = 400, detail = {}) {
  return Response.json({ ok: false, error: { code, message, detail } }, { status });
}


export async function GET(req) {
  try {
    // 쿼리 파라미터 파싱
    const url = new URL(req.url);
    const userId = toStr(url.searchParams.get("u"));
    const limit = toStr(url.searchParams.get("limit")) || "all"; // all | recent

    // 입력 검증 (필수 userId)
    if (!userId) {
      return fail(
        ERROR_CODES.MISSING_USER_ID,
        "Query param 'u' (userId) is required.",
        400,
      );
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // Users/Ledger를 한 번에 읽어서 I/O 최소화
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["Users!A:Z", "Ledger!A:Z"],
    });

    const [usersRes, ledgerRes] = data.valueRanges || [];
    const users = usersRes?.values || [];
    const ledger = ledgerRes?.values || [];

    // ✅ Users는 최소 헤더+1행 이상 있어야 “조회”가 의미 있음
    if (users.length < 2) {
      return fail(ERROR_CODES.USERS_EMPTY ?? "users_empty", "Users sheet has no data rows.", 500);
    }

    /**
     * ✅ Ledger는 "비어 있을 수 있음"
     * - 신규 고객은 거래가 없을 수 있으므로
     * - ledger.length < 2를 에러로 두면 detail이 무조건 실패함
     * - 따라서 ledger는 빈 배열로 정상 응답 처리
     */
    const ledgerHasRows = ledger.length >= 2;

    // --- Users 헤더 매핑
    const uHeader = headerIndexMap(users[0]);
    const U_USER_ID = uHeader.userId;
    const U_NAME = uHeader.name;
    const U_HOURLY_RATE = uHeader.hourlyRate;
    const U_STATUS = uHeader.status; // optional

    if (U_USER_ID == null || U_NAME == null || U_HOURLY_RATE == null) {
      return fail(
        ERROR_CODES.USERS_HEADER_MISMATCH ?? "users_header_mismatch",
        "Users header mismatch. Required columns: userId, name, hourlyRate.",
        500,
        {
          needed: ["userId", "name", "hourlyRate"],
          header: Object.keys(uHeader),
        },
      );
    }

    // --- 특정 userId 찾기
    let name = "";
    let hourlyRate = 0;
    let status = "active";

    for (let i = 1; i < users.length; i++) {
      if (toStr(users[i][U_USER_ID]) === userId) {
        name = toStr(users[i][U_NAME]);
        hourlyRate = toNum(users[i][U_HOURLY_RATE]);
        if (U_STATUS != null) status = normalizeStatus(users[i][U_STATUS]);
        break;
      }
    }

    if (!name) {
      return fail(ERROR_CODES.USER_NOT_FOUND, `User not found: ${userId}`, 404);
    }

    if (status !== "active") {
      return fail(ERROR_CODES.USER_INACTIVE ?? "user_inactive", `User is inactive: ${userId}`, 403);
    }

    // ✅ Ledger가 비어있으면 여기서 바로 OK 응답
    if (!ledgerHasRows) {
      return ok(
        {
          userId,
          name,
          hourlyRate,
          balance: 0,
          remainingMin: 0,
          ledger: [],
        },
        {
          limit,
          ledgerCount: 0,
        },
      );
    }

    // --- Ledger 헤더 매핑
    const lHeader = headerIndexMap(ledger[0]);
    const L_USER_ID = lHeader.userId;
    const L_TYPE = lHeader.type;
    const L_AMOUNT = lHeader.amount;
    const L_CREATED_AT = lHeader.createdAt;

    if (L_USER_ID == null || L_TYPE == null || L_AMOUNT == null || L_CREATED_AT == null) {
      return fail(
        ERROR_CODES.LEDGER_HEADER_MISMATCH ?? "ledger_header_mismatch",
        "Ledger header mismatch. Required columns: userId, type, amount, createdAt.",
        500,
        {
          needed: ["userId", "type", "amount", "createdAt"],
          header: Object.keys(lHeader),
        },
      );
    }

    // --- Ledger 합산/리스트
    const all = [];
    let balance = 0;

    for (let i = 1; i < ledger.length; i++) {
      if (toStr(ledger[i][L_USER_ID]) !== userId) continue;

      const type = toStr(ledger[i][L_TYPE]).toLowerCase();
      const amount = toNum(ledger[i][L_AMOUNT]);
      const createdAt = toStr(ledger[i][L_CREATED_AT]);

      balance += amount;
      all.push({ type, amount, createdAt });
    }

    // createdAt이 비어있을 때도 안정적으로 정렬되게 처리
    all.sort((a, b) => {
      const aKey = a.createdAt ? String(a.createdAt) : "0000";
      const bKey = b.createdAt ? String(b.createdAt) : "0000";
      return bKey.localeCompare(aKey);
    });

    const ledgerOut = limit === "recent" ? all.slice(0, 3) : all;

    // --- 남은 시간(예상)
    const perMinuteRate = hourlyRate > 0 ? hourlyRate / 60 : 0;
    const remainingMin = perMinuteRate > 0 ? Math.max(0, Math.floor(balance / perMinuteRate)) : 0;

    return ok(
      {
        userId,
        name,
        hourlyRate,
        balance,
        remainingMin,
        ledger: ledgerOut,
      },
      {
        limit,
        ledgerCount: all.length,
      },
    );
  } catch (err) {
    return fail(
      ERROR_CODES.SERVER_ERROR,
      "Unexpected server error.",
      500,
      { message: String(err?.message || err) },
    );
  }
}