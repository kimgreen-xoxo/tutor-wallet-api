// src/app/api/customers/new/route.js
import { google } from "googleapis";
import { ok, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ✅ 고객 생성 API (POST /api/customers/new)
 * - Users 시트에 새 고객 row를 추가한다.
 * - userId는 Users.userId 중 가장 큰 번호 + 1로 발급한다. (U0001, U0002...)
 * - shortUrl은 NEXT_PUBLIC_BASE_URL + "/c/" + userId 로 저장한다.
 * - 최소 보안: x-admin-key 헤더가 ADMIN_API_KEY와 일치해야 허용한다.
 * - 응답은 표준 스키마(ok/data/meta, ok:false/error)를 따른다.
 */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/* 환경변수 필수값을 강제한다. 없으면 즉시 서버 에러로 처리한다. */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

/** 외부 입력(요청 body/시트 값)을 안전한 문자열로 정규화한다. */
function toStr(v) {
  return String(v ?? "").trim();
}

/** 숫자 문자열(콤마 포함)을 number로 변환한다. 실패하면 NaN 반환. */
function toNum(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** 시트 헤더(1행)를 기반으로 컬럼명 → 인덱스 매핑을 만든다. */
function makeHeaderIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    map[toStr(h)] = i;
  });
  return map;
}

/**
 *  Users 시트의 userId 컬럼을 스캔해 다음 userId를 발급한다.
 * - 입력: values(Users 전체), userIdColIndex(userId 컬럼 인덱스)
 * - 출력: "U0001" 같은 다음 ID
 */
function issueNextUserIdFromUsers(values, userIdColIndex) {
  let max = 0;

  // 0행은 헤더, 1행부터 데이터
  for (let i = 1; i < values.length; i++) {
    const raw = toStr(values[i][userIdColIndex]);
    const m = raw.match(/^U(\d+)$/);
    if (!m) continue;

    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }

  const next = max + 1;
  return `U${String(next).padStart(4, "0")}`;
}

/**
 * Google Sheets API 클라이언트를 생성한다.
 * - GOOGLE_SERVICE_ACCOUNT_KEY: 서비스계정 JSON 문자열(통째로)
 */
async function getSheetsClient() {
  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_KEY");

  // env에 JSON이 "그대로" 들어왔든, \n 이스케이프가 들어왔든 최대한 복원해서 파싱한다.
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    key = JSON.parse(raw.replace(/\\n/g, "\n"));
  }

  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });

  await jwt.authorize();
  return google.sheets({ version: "v4", auth: jwt });
}

/**
 *  admin 요청인지 검증한다.
 * - 기대값: ADMIN_API_KEY
 * - 요청헤더: x-admin-key
 */
function isAdmin(req) {
  const expected = mustEnv("ADMIN_API_KEY");
  const got = req.headers.get("x-admin-key");
  return Boolean(got && got === expected);
}

export async function POST(req) {
  try {
    // ✅ 최소 보안 (로그인 없으니 헤더 키로 보호)
    if (!isAdmin(req)) {
      return fail(
        ERROR_CODES.UNAUTHORIZED || "unauthorized",
        "Invalid admin key.",
        401
      );
    }

    //  요청 바디 파싱 (JSON 아니면 빈 객체)
    const body = await req.json().catch(() => ({}));

    //  입력값 정규화
    const name = toStr(body.name);
    const hourlyRate = toNum(body.hourlyRate);

    // (요구사항 반영) 신규 고객 등록 필드들
    const phone = toStr(body.phone);
    const lessonSummary = toStr(body.lessonSummary); // 수업내용(요약/메모)

    // ✅ validation: name
    if (!name) {
      return fail(
        ERROR_CODES.INVALID_NAME || "invalid_name",
        "name is required.",
        400
      );
    }

    // ✅ validation: hourlyRate
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || hourlyRate > 1_000_000) {
      return fail(
        ERROR_CODES.INVALID_HOURLY_RATE || "invalid_hourly_rate",
        "hourlyRate must be a positive number (<= 1,000,000).",
        400
      );
    }

    // ✅ env
    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const baseUrl = toStr(mustEnv("NEXT_PUBLIC_BASE_URL")).replace(/\/+$/, "");

    // ✅ sheets client
    const sheets = await getSheetsClient();

    /**
     *  Users 전체 읽어서
     * 1) 헤더 인덱스 파악
     * 2) next userId 발급
     */
    const usersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Users!A:Z",
    });

    const users = usersRes.data.values || [];
    if (users.length < 1) {
      return fail(
        ERROR_CODES.USERS_EMPTY || "users_sheet_empty",
        "Users sheet header row is missing.",
        500
      );
    }

    const header = users[0];
    const idx = makeHeaderIndexMap(header);

    // ✅ 필수 컬럼 인덱스
    const USER_ID = idx.userId;
    const NAME = idx.name;
    const HOURLY_RATE = idx.hourlyRate;
    const IS_ACTIVE = idx.isActive; 
    const SHORT_URL = idx.shortUrl;
    const CREATED_AT = idx.createdAt;

    // ✅ 선택 컬럼(있으면 채우고 없으면 무시)
    const PHONE = idx.phone; // optional
    const LESSON_SUMMARY = idx.lessonSummary; // optional

    // 필수 컬럼 누락 방어
    const requiredCols = [
      ["userId", USER_ID],
      ["name", NAME],
      ["hourlyRate", HOURLY_RATE],
      ["isActive", IS_ACTIVE],
      ["shortUrl", SHORT_URL],
      ["createdAt", CREATED_AT],
    ];

    const missing = requiredCols.filter(([, i]) => i == null).map(([k]) => k);

    if (missing.length > 0) {
      return fail(
        ERROR_CODES.USERS_HEADER_MISMATCH || "users_header_mismatch",
        "Users header mismatch.",
        500,
        { needed: requiredCols.map(([k]) => k), missing, header: Object.keys(idx) }
      );
    }

    // ✅ userId 발급 + shortUrl 생성
    const userId = issueNextUserIdFromUsers(users, USER_ID);
    const shortUrl = `${baseUrl}/c/${encodeURIComponent(userId)}`;

    /**
     * 새 row를 “헤더 길이”와 동일하게 만들고 필요한 칸만 채운다.
     * - 장점: 컬럼 순서가 바뀌어도 헤더 기반 인덱스라 안전
     */
    const newRow = Array(header.length).fill("");
    newRow[USER_ID] = userId;
    newRow[NAME] = name;
    newRow[HOURLY_RATE] = String(hourlyRate);
    newRow[PHONE] = phone;
    newRow[IS_ACTIVE] = "active"; // 상태값 추가 (active/inactive)
    newRow[CREATED_AT] = new Date().toISOString();
    newRow[SHORT_URL] = shortUrl;
    newRow[LESSON_SUMMARY] = lessonSummary;

    // optional 컬럼은 존재할 때만 채움 (협업/확장 대비)
    if (PHONE != null) newRow[PHONE] = phone;
    if (LESSON_SUMMARY != null) newRow[LESSON_SUMMARY] = lessonSummary;

    // ✅ Users에 append
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Users!A:Z",
      valueInputOption: "RAW",
      requestBody: { values: [newRow] },
    });

    // ✅ 표준 스키마 응답 (ok/data/meta)
    return ok(
      {
        userId,
        name,
        hourlyRate,
        phone,
        isActive: true,
        createdAt: newRow[CREATED_AT],
        shortUrl,
        lessonSummary,
      },
      {
        ts: new Date().toISOString(),
      },
      201 // created
    );
  } catch (e) {
    // ✅ 표준 스키마 서버 에러
    return fail(
      ERROR_CODES.SERVER_ERROR,
      "Unexpected server error.",
      500,
      { message: String(e?.message || e) }
    );
  }
}