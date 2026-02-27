import { google } from "googleapis";

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
  // NOTE: service-account key JSON을 env 문자열로 넣어둔 구조 그대로 사용
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

export async function GET() {
  try {
    const spreadsheetId = mustEnv("SPREADSHEET_ID");
    const sheets = await getSheetsClient();

    // NOTE: 고객 목록은 Users 시트만 있으면 됨
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: ["Users!A:Z"],
    });

    const usersRes = data.valueRanges?.[0];
    const rows = usersRes?.values || [];

    // NOTE: 헤더만 있거나 비어있으면 에러
    if (rows.length < 2) {
      return Response.json({ error: "users_empty" }, { status: 500 });
    }

    const header = headerIndexMap(rows[0]);

    // NOTE: 필수 컬럼(김과장 시트 기준)
    const IDX_USER_ID = header.userId;
    const IDX_NAME = header.name;
    const IDX_RATE = header.hourlyRate;

    // NOTE: 선택 컬럼(있으면 사용)
    const IDX_STATUS = header.status;
    const IDX_CREATED_AT = header.createdAt;

    if (IDX_USER_ID == null || IDX_NAME == null || IDX_RATE == null) {
      return Response.json(
        { error: "users_header_mismatch", needed: ["userId", "name", "hourlyRate"] },
        { status: 500 }
      );
    }

    // NOTE: 고객 목록 데이터 만들기
    const customers = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];

      const userId = toStr(r[IDX_USER_ID]);
      if (!userId) continue;

      const name = toStr(r[IDX_NAME]);
      const hourlyRate = toNum(r[IDX_RATE]);

      const status = IDX_STATUS != null ? normalizeStatus(r[IDX_STATUS]) : "active";
      const createdAt = IDX_CREATED_AT != null ? toStr(r[IDX_CREATED_AT]) : "";

      customers.push({ userId, name, hourlyRate, status, createdAt });
    }

    return Response.json({ customers });
  } catch (err) {
    return Response.json(
      { error: "server_error", message: String(err?.message || err) },
      { status: 500 }
    );
  }
}