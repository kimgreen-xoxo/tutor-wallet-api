/**
 * POST /api/ledger/charge
 * 역할:
 * 1) 요청(userId, minutes, hourlyRate) 검증
 * 2) 차감 금액 계산
 * 3) Ledger 시트에 charge 행 추가
 */

import { google } from "googleapis";

/** 숫자 안전 변환 */
function toNum(value) {
  const number = Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

/** 필수 환경변수 체크 */
function mustEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

/** 서비스 계정 파싱 */
function getServiceAccount() {
  const raw = mustEnv("GOOGLE_SERVICE_ACCOUNT_KEY");

  try {
    const parsed = JSON.parse(raw);

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_KEY");
    }

    return parsed;
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON parse failed");
  }
}

/** 간단한 ID 생성 */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Ledger 시트 append */
async function appendLedgerRow({
  userId,
  userName,
  minutes,
  hourlyRate,
  relatedSessionId,
}) {
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

  // 역할: 분당 단가 계산
  const perMinuteRate = hourlyRate / 60;

  // 역할: 실제 차감 금액 계산 후 음수로 저장
  const amount = -Math.floor(perMinuteRate * minutes);

  const values = [[
    userId,
    userName,
    "charge",
    amount,
    `${minutes}분 차감`,
    createdAt,
    relatedSessionId || "",
    ledgerId,
    requestId,
  ]];

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
    amount,
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
    const minutes = toNum(body.minutes);
    const hourlyRate = toNum(body.hourlyRate);

    if (!userId) {
      return Response.json(
        { ok: false, data: null, error: "invalid_userId", meta: {} },
        { status: 400 },
      );
    }

    if (!minutes || minutes <= 0) {
      return Response.json(
        { ok: false, data: null, error: "invalid_minutes", meta: {} },
        { status: 400 },
      );
    }

    if (!hourlyRate || hourlyRate <= 0) {
      return Response.json(
        { ok: false, data: null, error: "invalid_hourlyRate", meta: {} },
        { status: 400 },
      );
    }

    const appended = await appendLedgerRow({
      userId,
      userName,
      minutes,
      hourlyRate,
      relatedSessionId,
    });

    return Response.json({
      ok: true,
      data: {
        userId,
        userName,
        type: "charge",
        minutes,
        amount: appended.amount,
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
    console.error("POST /api/ledger/charge error:", error);

    return Response.json(
      {
        ok: false,
        data: null,
        error: "charge_failed",
        meta: {
          message: String(error?.message ?? error),
        },
      },
      { status: 500 },
    );
  }
}