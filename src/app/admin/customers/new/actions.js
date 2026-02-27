"use server";

export async function createUser(prevState, formData) {

  try {
    const name = formData.get("name");
    const hourlyRate = Number(formData.get("hourlyRate"));

    const res = await fetch("http://localhost:3000/api/customers/new", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": process.env.ADMIN_API_KEY || "",
      },
      body: JSON.stringify({ name, hourlyRate }),
      cache: "no-store",
    });

    const raw = await res.text();

    if (!res.ok) {
      return { message: `❌ 생성 실패 (status ${res.status}) ${raw}` };
    }

    // 성공 응답에서 userId 뽑기
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    const userId = data?.user?.userId;
    return { message: userId ? `✅ 생성 완료 (ID: ${userId})` : "✅ 생성 완료" };
  } catch (e) {
    return { message: `❌ 서버 오류 발생: ${String(e?.message || e)}` };
  }
}