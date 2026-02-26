import { google } from "googleapis";

export function GET() {
  return Response.json({ ok: true, message: "topup route alive" });
}

export async function POST(req) {
  try {
    const { userId, amount, requestId } = await req.json();

    if (!userId || typeof amount !== "number") {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }

    if (!requestId || typeof requestId !== "string") {
      return Response.json({ error: "missing_request_id" }, { status: 400 });
    }

    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > 1_000_000
    ) {
      return Response.json({ error: "invalid_amount" }, { status: 400 });
    }

    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

    const jwtClient = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    await jwtClient.authorize();

    const sheets = google.sheets({ version: "v4", auth: jwtClient });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "Ledger!A:H",
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            `L${Date.now()}`, // A ledgerId
            userId, // B userId
            "topup", // C type
            amount, // D amount
            "", // E relatedSessionId
            "충전", // F memo
            new Date().toISOString(), // G createdAt
            requestId,
          ],
        ],
      },
    });

    return Response.json({ success: true });
  } catch (e) {
    console.error(e);
    return Response.json(
      { error: "failed", message: String(e?.message || e) },
      { status: 500 },
    );
  }
}
