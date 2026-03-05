import { google } from "googleapis";

export function GET() {
  return Response.json({ ok: true, message: "topup route alive" });
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// --- utils
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
  // 충돌 확률 낮추기: timestamp + random
  const rand = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `L${Date.now()}_${rand}`;
}

async function getSheetsClient() {
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
  // Users 시트에서 userId로 name 찾기 (헤더 매핑)
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
  // Ledger에서 requestId 컬럼 찾아서 중복 체크 (헤더 매핑)
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Ledger!A:Z",
  });

  const rows = data.values || [];
  if (rows.length < 2) return false;

  const h = headerIndexMap(rows[0]);
  const I_REQUEST_ID = h.requestId;

  // requestId 컬럼이 없으면 중복 체크 불가 -> false로 처리
  if (I_REQUEST_ID == null) return false;

  for (let i = 1; i < rows.length; i++) {
    if (toStr(rows[i][I_REQUEST_ID]) === requestId) return true;
  }

  return false;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = toStr(body.userId);
    const amount = toNum(body.amount);
    const requestId = toStr(body.requestId);

    console.log("[TOPUP INPUT]", { userId, amount, requestId });

    if (!userId) {
      return Response.json({ ok: false, error: { code: "missing_user_id" } }, { status: 400 });
    }

    if (!requestId) {
      return Response.json({ ok: false, error: { code: "missing_request_id" } }, { status: 400 });
    }

    if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000) {
      return Response.json({ ok: false, error: { code: "invalid_amount" } }, { status: 400 });
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // ✅ 멱등성: requestId 중복이면 append 금지
    const dup = await isDuplicateRequestId(sheets, spreadsheetId, requestId);
    if (dup) {
      return Response.json(
        { ok: false, error: { code: "duplicate_request_id", message: "Request already processed." } },
        { status: 409 }
      );
    }

    // ✅ 이름 조회 (Ledger에 userName 컬럼이 있으면 채우고 없으면 무시)
    const userName = await findUserNameById(sheets, spreadsheetId, userId);

    // ✅ Ledger 헤더를 읽어서 컬럼 인덱스 기반으로 row 생성
    const ledgerGet = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Ledger!A:Z",
    });

    const ledgerRows = ledgerGet.data.values || [];
    if (ledgerRows.length < 1) {
      return Response.json(
        { ok: false, error: { code: "ledger_empty", message: "Ledger header row is missing." } },
        { status: 500 }
      );
    }

    const h = headerIndexMap(ledgerRows[0]);

    const cols = {
      ledgerId: h.ledgerId,
      userId: h.userId,
      userName: h.userName, // ✅ optional
      type: h.type,
      amount: h.amount,
      relatedSessionId: h.relatedSessionId,
      memo: h.memo,
      createdAt: h.createdAt,
      requestId: h.requestId,
    };

    // 필수 컬럼 체크
    const required = ["ledgerId", "userId", "type", "amount", "createdAt", "requestId"];
    for (const k of required) {
      if (cols[k] == null) {
        return Response.json(
          { ok: false, error: { code: "ledger_header_mismatch", detail: { missing: k, header: Object.keys(h) } } },
          { status: 500 }
        );
      }
    }

    // row 길이는 헤더 길이에 맞추기
    const row = new Array(ledgerRows[0].length).fill("");

    const ledgerId = makeLedgerId();
    const createdAt = new Date().toISOString();

    row[cols.userId] = userId;
    if (cols.userName != null) row[cols.userName] = userName;
    row[cols.type] = "topup";
    row[cols.amount] = String(amount);
    if (cols.memo != null) row[cols.memo] = "충전";
    row[cols.createdAt] = createdAt;
    if (cols.relatedSessionId != null) row[cols.relatedSessionId] = "";
    row[cols.ledgerId] = ledgerId;
    row[cols.requestId] = requestId;

    // ✅ append는 "Ledger" 시트에 1행 추가 (range는 A:Z로 넉넉히)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Ledger!A:Z",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });

    return Response.json({
      ok: true,
      data: { ledgerId, userId, userName, amount, createdAt, requestId },
      meta: {},
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { ok: false, error: { code: "server_error", message: String(e?.message || e) } },
      { status: 500 }
    );
  }
}