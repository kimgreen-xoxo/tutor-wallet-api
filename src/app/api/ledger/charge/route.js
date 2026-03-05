// src/app/api/ledger/charge/route.js
import { google } from "googleapis";
import { ok, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

function toStr(v) {
  return String(v ?? "").trim();
}

function toNum(v) {
  const n = Number(String(v ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function headerIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    map[toStr(h)] = i;
  });
  return map;
}

function makeLedgerId() {
  // ledgerId는 "고유 식별자" (날짜/메모 넣으면 안 됨)
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `L${Date.now()}_${rand}`;
}

async function getSheetsClient() {
  // GOOGLE_SERVICE_ACCOUNT_KEY: 서비스 계정 JSON 문자열(통째로)
  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_KEY");
  const key = JSON.parse(raw);

  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });

  await jwt.authorize();
  return google.sheets({ version: "v4", auth: jwt });
}

async function findUserNameById(sheets, spreadsheetId, userId) {
  // Users 시트에서 userId로 name 조회 (없으면 빈 문자열)
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Users!A:Z",
  });

  const rows = data.values || [];
  if (rows.length < 2) return "";

  const h = headerIndexMap(rows[0]);
  const I_USER_ID = h.userId;
  const I_NAME = h.name;

  if (I_USER_ID == null || I_NAME == null) return "";

  for (let i = 1; i < rows.length; i++) {
    if (toStr(rows[i][I_USER_ID]) === userId) {
      return toStr(rows[i][I_NAME]);
    }
  }

  return "";
}

async function isDuplicateRequestId(sheets, spreadsheetId, requestId) {
  // Ledger에서 requestId 중복 체크 (멱등성)
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Ledger!A:Z",
  });

  const rows = data.values || [];
  if (rows.length < 2) return false;

  const h = headerIndexMap(rows[0]);
  const I_REQUEST_ID = h.requestId;

  // requestId 컬럼이 없으면 중복 방지 불가 -> 안전을 위해 "서버 에러"로 막는 것도 옵션
  if (I_REQUEST_ID == null) return false;

  for (let i = 1; i < rows.length; i++) {
    if (toStr(rows[i][I_REQUEST_ID]) === requestId) return true;
  }

  return false;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    // charge 입력: userId + amount(양수) + relatedSessionId(필수) + requestId(필수) + memo(선택)
    const userId = toStr(body.userId);
    const amountRaw = toNum(body.amount);
    const relatedSessionId = toStr(body.relatedSessionId);
    const requestId = toStr(body.requestId);
    const memo = toStr(body.memo) || "차감";

    if (!userId) {
      return fail(ERROR_CODES.MISSING_USER_ID, "userId is required.", 400);
    }

    if (!requestId) {
      return fail("missing_request_id", "requestId is required.", 400);
    }

    // charge는 “어떤 수업/세션 때문에 차감됐는지”가 핵심이라 필수로 강제
    if (!relatedSessionId) {
      return fail("missing_related_session_id", "relatedSessionId is required for charge.", 400);
    }

    // amount는 양수로 받되, Ledger에는 음수로 기록(장부 합산 = 잔액)
    if (!Number.isInteger(amountRaw) || amountRaw <= 0 || amountRaw > 1_000_000) {
      return fail("invalid_amount", "amount must be a positive integer (<= 1,000,000).", 400);
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // ✅ 멱등성: 같은 requestId면 중복 차감 방지
    const dup = await isDuplicateRequestId(sheets, spreadsheetId, requestId);
    if (dup) {
      return fail("duplicate_request_id", "Request already processed.", 409);
    }

    // ✅ Ledger 헤더 기반 매핑으로 안전하게 append
    const ledgerGet = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Ledger!A:Z",
    });

    const ledgerRows = ledgerGet.data.values || [];
    if (ledgerRows.length < 1) {
      return fail(ERROR_CODES.LEDGER_EMPTY, "Ledger header row is missing.", 500);
    }

    const h = headerIndexMap(ledgerRows[0]);

    // 필수 컬럼(협업/확장 대비): 최소한 이것들은 있어야 함
    const cols = {
      ledgerId: h.ledgerId,
      userId: h.userId,
      userName: h.userName, // optional
      type: h.type,
      amount: h.amount,
      relatedSessionId: h.relatedSessionId, // charge에선 강력 추천(사실상 필수)
      memo: h.memo, // optional
      createdAt: h.createdAt,
      requestId: h.requestId,
    };

    const required = ["ledgerId", "userId", "type", "amount", "createdAt", "requestId"];
    for (const k of required) {
      if (cols[k] == null) {
        return fail(
          ERROR_CODES.LEDGER_HEADER_MISMATCH,
          "Ledger header mismatch.",
          500,
          { missing: k, header: Object.keys(h) }
        );
      }
    }

    // relatedSessionId 컬럼이 아예 없으면, charge의 핵심 추적이 불가능하니 서버 에러로 막는 게 안전
    if (cols.relatedSessionId == null) {
      return fail(
        "ledger_missing_related_session_id_column",
        "Ledger must have relatedSessionId column for charge.",
        500,
        { header: Object.keys(h) }
      );
    }

    const userName = await findUserNameById(sheets, spreadsheetId, userId);

    const ledgerId = makeLedgerId();
    const createdAt = new Date().toISOString();
    const amount = -Math.abs(amountRaw); // ✅ 차감은 음수로 기록

    const row = new Array(ledgerRows[0].length).fill("");
    row[cols.ledgerId] = ledgerId;
    row[cols.userId] = userId;
    if (cols.userName != null) row[cols.userName] = userName;
    row[cols.type] = "charge";
    row[cols.amount] = String(amount);
    row[cols.relatedSessionId] = relatedSessionId;
    if (cols.memo != null) row[cols.memo] = memo;
    row[cols.createdAt] = createdAt;
    row[cols.requestId] = requestId;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Ledger!A:Z",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });

    // ✅ Response Schema(Standard): ok/data/meta
    return ok(
      {
        ledgerId,
        userId,
        userName,
        type: "charge",
        amount, // 음수로 내려줌(서버/시트 기준 단일 진실)
        relatedSessionId,
        memo,
        createdAt,
        requestId,
      },
      {}
    );
  } catch (e) {
    return fail(
      ERROR_CODES.SERVER_ERROR,
      "Unexpected server error.",
      500,
      { message: String(e?.message || e) }
    );
  }
}