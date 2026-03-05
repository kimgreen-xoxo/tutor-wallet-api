"use server";

import { headers } from "next/headers";

/** 역할: 폼에서 받은 hourlyRate 문자열("50,000")을 숫자(50000)로 안전 변환 */
function parseHourlyRate(formData) {
  const rawRate = String(formData.get("hourlyRate") ?? "");
  const n = Number(rawRate.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export async function createUser(prevState, formData) {
  try {
    const name = String(formData.get("name") ?? "").trim();
    const hourlyRate = parseHourlyRate(formData);
    const phone = String(formData.get("phone") ?? "").trim();
    const lessonSummary = String(formData.get("lessonSummary") ?? "").trim();

    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const url = `${proto}://${host}/api/customers/new`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": process.env.ADMIN_API_KEY || "",
      },
      body: JSON.stringify({ name, hourlyRate, phone, lessonSummary }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      return { ok: false, userId: null, message: `❌ 생성 실패 (status ${res.status})` };
    }

    if (!json.ok) {
      const code = json?.error?.code || "unknown_error";
      const msg = json?.error?.message || "";
      return { ok: false, userId: null, message: `❌ 생성 실패: ${code}${msg ? ` - ${msg}` : ""}` };
    }

    const userId = json?.data?.userId || null;
    return { ok: true, userId, message: userId ? `✅ 생성 완료` : "✅ 생성 완료" };
  } catch (e) {
    return { ok: false, userId: null, message: `❌ 서버 오류: ${String(e?.message || e)}` };
  }
}