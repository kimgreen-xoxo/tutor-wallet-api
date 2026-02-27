import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

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

function normalizeStatus(raw) {
  const s = toStr(raw).toLowerCase();
  // status 컬럼을 쓰는 경우를 대비해 넉넉히 처리
  // - 비활성으로 보는 케이스: inactive/disabled/blocked/false/0/no
  if (!s) return "active";
  if (["inactive", "disabled", "blocked", "false", "0", "no"].includes(s)) return "inactive";
  return "active";
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const userId = toStr(url.searchParams.get("u"));

    if (!userId) {
      return Response.json({ error: "missing_user_id" }, { status: 400 });
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // ✅ 필요한 시트만 읽음
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["Users!A:Z", "Wallet!A:Z", "Ledger!A:Z"],
    });

    const [usersRes, walletRes, ledgerRes] = data.valueRanges || [];
    const users = usersRes?.values || [];
    const wallet = walletRes?.values || [];
    const ledger = ledgerRes?.values || [];

    if (users.length < 2) {
      return Response.json({ error: "users_empty" }, { status: 500 });
    }
    if (ledger.length < 2) {
      return Response.json({ error: "ledger_empty" }, { status: 500 });
    }

    // --- Users: userId, name, hourlyRate, (status)
    const uHeader = headerIndexMap(users[0]);

    const U_USER_ID = uHeader.userId;
    const U_NAME = uHeader.name;
    const U_HOURLY_RATE = uHeader.hourlyRate; // ✅ 김과장 시트 헤더와 맞춤
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
        if (U_STATUS != null) {
          status = normalizeStatus(users[i][U_STATUS]);
        }
        break;
      }
    }

    if (!name) {
      return Response.json({ error: "user_not_found" }, { status: 404 });
    }

    if (status !== "active") {
      return Response.json({ error: "user_inactive" }, { status: 403 });
    }

    // --- Wallet: userId, balance (있으면 사용, 없으면 ledger 합산으로 계산)
    let balance = 0;

    if (wallet.length >= 2) {
      const wHeader = headerIndexMap(wallet[0]);
      const W_USER_ID = wHeader.userId;
      const W_BALANCE = wHeader.balance;

      if (W_USER_ID != null && W_BALANCE != null) {
        for (let i = 1; i < wallet.length; i++) {
          if (toStr(wallet[i][W_USER_ID]) === userId) {
            balance = toNum(wallet[i][W_BALANCE]);
            break;
          }
        }
      }
    }

    // Wallet이 없거나 값이 0인데도 ledger가 있는 경우 대비: ledger 합산으로 재계산(보수적)
    // (Wallet이 있어도 실제가 다르면 안 되니까 "옵션"인데, 데모에서는 안전하게 계산해버리는 편이 낫다)
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

    // ✅ 최근 거래 3개: 충전(topup) / 차감(charge)만
    const recent = [];
    let computedBalance = 0;

    for (let i = 1; i < ledger.length; i++) {
      if (toStr(ledger[i][L_USER_ID]) !== userId) continue;

      const type = toStr(ledger[i][L_TYPE]).toLowerCase();
      const amount = toNum(ledger[i][L_AMOUNT]);
      computedBalance += amount;

      // recent는 최신순으로 뽑기 위해 뒤에서 따로 순회
    }

    // computedBalance를 최종 잔액으로 사용(장부가 단일 진실)
    balance = computedBalance;

    for (let i = ledger.length - 1; i >= 1; i--) {
      if (toStr(ledger[i][L_USER_ID]) !== userId) continue;

      const type = toStr(ledger[i][L_TYPE]).toLowerCase();
      if (type !== "topup" && type !== "charge") continue;

      const amount = toNum(ledger[i][L_AMOUNT]);
      const createdAt = toStr(ledger[i][L_CREATED_AT]);

      recent.push({ type, amount, createdAt });

      if (recent.length >= 3) break;
    }

    // ✅ 남은 시간(예상): 잔액이 음수면 0분
    // - perMinuteRate는 소수 가능
    const perMinuteRate = hourlyRate > 0 ? hourlyRate / 60 : 0;
    const remainingMin =
      perMinuteRate > 0 ? Math.max(0, Math.floor(balance / perMinuteRate)) : 0;

    return Response.json({
      userId,
      name,
      hourlyRate,
      balance,
      perMinuteRate,
      remainingMin,
      recent,
    });
  } catch (err) {
    return Response.json(
      { error: "server_error", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}