/**
 * POST /api/topup
 * 역할:
 * 1) 요청(userId, amount) 검증
 * 2) Google Sheets Ledger 시트에 거래 기록 1줄 추가
 * 3) ok / error 구조로 응답
 */

import { google } from "googleapis";

/** 어떤 값이 와도 숫자로 안전 변환, 실패 시 0 */
function toNum(v) {
  const n = Number(String(v ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 필수 환경변수 검사 */
function mustEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

/** 서비스 계정 JSON 문자열 파싱 */
function getServiceAccount() {
  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_KEY");

  try {
    const parsed = JSON.parse(raw);

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_KEY");
    }

    return parsed;
  } catch (error) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON parse failed");
  }
}

/** 간단한 고유 ID 생성 */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ledger 시트에 topup row 추가 */
async function appendLedgerRow({ userId, userName, relatedSessionId, amount }) {
  const sheetId = mustEnv("SPREADSHEET_ID");
  const serviceAccount = getServiceAccount();

  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({
    version: "v4",
    auth,
  });

  const createdAt = new Date().toISOString();
  const ledgerId = createId("ledger");
  const requestId = createId("req");

  // 컬럼 순서:
  // A userId
  // B userName
  // C type
  // D amount
  // E memo
  // F createdAt
  // G relatedSessionId
  // H ledgerId
  // I requestId
  const values = [
    [
      userId,
      userName,
      "topup",
      amount,
      "관리자 충전",
      createdAt,
      relatedSessionId,
      ledgerId,
      requestId,
    ],
  ];

  const result = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Ledger!A:I",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });

  return {
    createdAt,
    ledgerId,
    requestId,
    updates: result.data?.updates ?? null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();

    const userId = String(body.userId ?? "").trim();
    const userName = String(body.userName ?? "").trim();
    const relatedSessionId = String(body.relatedSessionId ?? "").trim();
    const amount = toNum(body.amount);

    if (!userId) {
      return Response.json(
        {
          ok: false,
          data: null,
          error: "invalid_userId",
          meta: {},
        },
        { status: 400 },
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json(
        {
          ok: false,
          data: null,
          error: "invalid_amount",
          meta: {},
        },
        { status: 400 },
      );
    }

    const appended = await appendLedgerRow({
      userId,
      userName,
      relatedSessionId: "",
      amount,
    });

    return Response.json({
      ok: true,
      data: {
        userId,
        userName,
        type: "topup",
        amount,
        createdAt: appended.createdAt,
        relatedSessionId: relatedSessionId || null,
        ledgerId: appended.ledgerId,
        requestId: appended.requestId,
      },
      error: null,
      meta: {
        updates: appended.updates,
      },
    });
  } catch (error) {
    console.error("POST /api/ledger/topup error:", error);

    return Response.json(
      {
        ok: false,
        data: null,
        error: "topup_failed",
        meta: {
          message: String(error?.message ?? error),
        },
      },
      { status: 500 },
    );
  }
}
