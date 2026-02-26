import { redirect } from "next/navigation";
import styles from "./AdminUsers.module.css";

async function createUser(formData) {
  "use server";

  try {
    console.log("==== createUser START ====");

    const name = formData.get("name");
    const hourlyRate = Number(formData.get("hourlyRate"));

    console.log("name:", name);
    console.log("hourlyRate:", hourlyRate);

    // 환경변수 확인 (값은 출력하지 말고 길이만 확인)
    const keyLength = String(process.env.ADMIN_API_KEY || "").length;
    console.log("ADMIN_API_KEY length:", keyLength);

    const res = await fetch("http://localhost:3000/api/admin/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": process.env.ADMIN_API_KEY || "",
      },
      body: JSON.stringify({
        name,
        hourlyRate,
      }),
      cache: "no-store",
    });

    console.log("API status:", res.status);

    const raw = await res.text();
    console.log("API raw response:", raw);

    if (!res.ok) {
      throw new Error("API call failed");
    }

    console.log("==== createUser SUCCESS ====");

    // 원하면 여기서 redirect 켜기
    // redirect("/admin/users");
  } catch (err) {
    console.error("==== createUser ERROR ====");
    console.error(err);
    throw err;
  }
}

export default function AdminUsersPage() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.kicker}>Tutor Wallet Admin</div>
        <h1 className={styles.title}>수강생 등록</h1>

        <form action={createUser} className={styles.form}>
          <label className={styles.label}>
            이름
            <input className={styles.input} name="name" required />
          </label>

          <label className={styles.label}>
            시급
            <input
              className={styles.input}
              name="hourlyRate"
              type="number"
              required
            />
          </label>

          <button className={styles.button} type="submit">
            생성
          </button>
        </form>

        <p className={styles.resultHint}>
          생성 버튼을 누르면 Users 시트에 row가 추가됩니다.
        </p>
      </div>
    </div>
  );
}