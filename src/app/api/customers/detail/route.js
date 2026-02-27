import { google } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
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

function normalizeStatus(raw) {
  const s = toStr(raw).toLowerCase();
  if (!s) return "active";
  if (["inactive", "disabled", "blocked", "false", "0", "no"].includes(s)) return "inactive";
  return "active";
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

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const userId = toStr(url.searchParams.get("u"));

    // 옵션: limit=recent(기본은 all)
    const limit = toStr(url.searchParams.get("limit")) || "all"; // all | recent

    if (!userId) {
      return Response.json({ error: "missing_user_id" }, { status: 400 });
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // ✅ Admin 상세는 Users + Ledger까지만 있어도 됨
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["Users!A:Z", "Ledger!A:Z"],
    });

    const [usersRes, ledgerRes] = data.valueRanges || [];
    const users = usersRes?.values || [];
    const ledger = ledgerRes?.values || [];

    if (users.length < 2) return Response.json({ error: "users_empty" }, { status: 500 });
    if (ledger.length < 2) return Response.json({ error: "ledger_empty" }, { status: 500 });

    // --- Users: userId, name, hourlyRate, (status)
    const uHeader = headerIndexMap(users[0]);
    const U_USER_ID = uHeader.userId;
    const U_NAME = uHeader.name;
    const U_HOURLY_RATE = uHeader.hourlyRate;
    const U_STATUS = uHeader.status; // 선택

    if (U_USER_ID == null || U_NAME == null || U_HOURLY_RATE == null) {
      return Response.json(
        { error: "users_header_mismatch", needed: ["userId", "name", "hourlyRate"] },
        { status: 500 }
      );
    }

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

    if (!name) return Response.json({ error: "user_not_found" }, { status: 404 });
    if (status !== "active") return Response.json({ error: "user_inactive" }, { status: 403 });

    // --- Ledger: userId, type, amount, createdAt
    const lHeader = headerIndexMap(ledger[0]);
    const L_USER_ID = lHeader.userId;
    const L_TYPE = lHeader.type;
    const L_AMOUNT = lHeader.amount;
    const L_CREATED_AT = lHeader.createdAt;

    if (L_USER_ID == null || L_TYPE == null || L_AMOUNT == null || L_CREATED_AT == null) {
      return Response.json(
        { error: "ledger_header_mismatch", needed: ["userId", "type", "amount", "createdAt"] },
        { status: 500 }
      );
    }

    // ✅ 전체 거래내역 + 잔액 계산
    const all = [];
    let balance = 0;

    for (let i = 1; i < ledger.length; i++) {
      if (toStr(ledger[i][L_USER_ID]) !== userId) continue;

      const type = toStr(ledger[i][L_TYPE]).toLowerCase();
      const amount = toNum(ledger[i][L_AMOUNT]);
      const createdAt = toStr(ledger[i][L_CREATED_AT]);

      // amount는 시트에 저장된 값 그대로 더함(장부가 단일 진실)
      balance += amount;

      all.push({ type, amount, createdAt });
    }

    // 최신순 정렬(문자열 날짜 포맷이 yyyy-mm-dd면 잘 동작)
    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const ledgerOut = limit === "recent" ? all.slice(0, 3) : all;

    // 남은 시간(예상)
    const perMinuteRate = hourlyRate > 0 ? hourlyRate / 60 : 0;
    const remainingMin =
      perMinuteRate > 0 ? Math.max(0, Math.floor(balance / perMinuteRate)) : 0;

    return Response.json({
      userId,
      name,
      hourlyRate,
      balance,
      remainingMin,
      ledger: ledgerOut, // ✅ Admin은 ledger 전체
    });
  } catch (err) {
    return Response.json(
      { error: "server_error", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}