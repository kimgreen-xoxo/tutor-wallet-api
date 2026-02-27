import { google } from "googleapis";

/**
 * ✅ 고객 생성 API
 * - Users 시트에 새 고객 row를 추가한다.
 * - userId는 기존 Users.userId 중 가장 큰 번호 + 1로 발급한다. (U0001, U0002...)
 * - shortUrl은 NEXT_PUBLIC_BASE_URL + "/c/" + userId 로 저장한다.
 * - 최소 보안: x-admin-key 헤더가 ADMIN_API_KEY와 일치해야만 허용한다.
 */

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
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function makeHeaderIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    map[toStr(h)] = i;
  });
  return map;
}

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

async function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
  const key = JSON.parse(raw.replace(/\r?\n/g, "\\n"));

  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });

  await jwt.authorize();
  return google.sheets({ version: "v4", auth: jwt });
}

function isAdmin(req) {
  const expected = mustEnv("ADMIN_API_KEY");
  const got = req.headers.get("x-admin-key");
  return got && got === expected;
}

export async function POST(req) {
  try {
    // ✅ 최소 보안 (로그인 없으니 헤더 키로 보호)
    if (!isAdmin(req)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = toStr(body.name);
    const hourlyRate = toNum(body.hourlyRate);

    if (!name) {
      return Response.json({ error: "invalid_name" }, { status: 400 });
    }

    if (
      !Number.isFinite(hourlyRate) ||
      hourlyRate <= 0 ||
      hourlyRate > 1_000_000
    ) {
      return Response.json({ error: "invalid_hourly_rate" }, { status: 400 });
    }

    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const baseUrl = toStr(mustEnv("NEXT_PUBLIC_BASE_URL")).replace(/\/+$/, "");

    const sheets = await getSheetsClient();

    // ✅ Users 전체 읽어서 next userId 계산 + 헤더 인덱스 파악
    const usersRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Users!A:Z",
    });

    const users = usersRes.data.values || [];
    if (users.length < 1) {
      return Response.json({ error: "users_sheet_empty" }, { status: 500 });
    }

    const header = users[0];
    const idx = makeHeaderIndexMap(header);

    // ✅ 필수 컬럼 확인
    const USER_ID = idx.userId;
    const NAME = idx.name;
    const HOURLY_RATE = idx.hourlyRate;
    const SHORT_URL = idx.shortUrl;

    if ([USER_ID, NAME, HOURLY_RATE, SHORT_URL].some((n) => n == null)) {
      return Response.json(
        {
          error: "users_header_mismatch",
          needed: ["userId", "name", "hourlyRate", "shortUrl"],
        },
        { status: 500 },
      );
    }

    const userId = issueNextUserIdFromUsers(users, USER_ID);
    const shortUrl = `${baseUrl}/c/${encodeURIComponent(userId)}`;

    // ✅ 새 row 만들기 (헤더 길이만큼 맞추고 필요한 칸만 채움)
    const newRow = Array(header.length).fill("");
    newRow[USER_ID] = userId;
    newRow[NAME] = name;
    newRow[HOURLY_RATE] = hourlyRate;
    newRow[SHORT_URL] = shortUrl;

    // ✅ Users에 append
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Users!A:Z",
      valueInputOption: "RAW",
      requestBody: {
        values: [newRow],
      },
    });

    return Response.json({
      success: true,
      user: { userId, name, hourlyRate, shortUrl },
    });
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "server_error", message: String(e?.message || e) },
      { status: 500 },
    );
  }
}
