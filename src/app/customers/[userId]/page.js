import styles from "./CustomerPage.module.css";
import { headers } from "next/headers";

function formatRemaining(remainingMin) {
  const m = Number(remainingMin) || 0;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h}시간 ${r}분`;
  }
  return `${m}분`;
}

function typeLabel(type) {
  const t = String(type || "").toLowerCase();
  if (t === "topup") return "충전";
  if (t === "charge") return "차감";
  return "-";
}

function displayAmount(type, amount) {
  const n = Number(amount || 0);

  // ✅ 고객 UI 정책: 충전/차감으로만 표시, 차감은 항상 마이너스
  if (String(type).toLowerCase() === "charge") {
    return `-${Math.abs(n).toLocaleString()}원`;
  }
  return `+${Math.abs(n).toLocaleString()}원`;
}

async function fetchCustomer(userId) {
  const h = await headers();

  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  const url = `${proto}://${host}/api/customer?u=${encodeURIComponent(userId)}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: j.error || "unknown_error" };
  }

  const data = await res.json();
  return { ok: true, data };
}

export default async function CustomerPage({ params }) {
  const { userId } = await params;
  const result = await fetchCustomer(userId);

  if (!result.ok) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.kicker}>조회 실패</div>
          <div className={styles.name}>
            {result.error} ({result.status})
          </div>
        </div>
      </div>
    );
  }

  const { name, balance, hourlyRate, remainingMin, recent } = result.data;

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.kicker}>수업 이용 현황</div>
        <div className={styles.name}>{name}</div>

        <div className={styles.summaryBox}>
          <div className={styles.summaryLabel}>현재 잔액</div>
          <div className={styles.balance}>
            {Number(balance || 0).toLocaleString()}원
          </div>

          <div className={styles.meta}>
            남은 시간(예상):{" "}
            <b className={styles.metaStrong}>{formatRemaining(remainingMin)}</b>
            <span style={{ color: "#9ca3af" }}>
              {" "}
              (시급 {Number(hourlyRate || 0).toLocaleString()}원)
            </span>
          </div>
        </div>

        <div className={styles.sectionTitle}>최근 거래 3건</div>

        <div className={styles.list}>
          {(!recent || recent.length === 0) && (
            <div className={styles.empty}>내역이 없습니다.</div>
          )}

          {recent?.map((x, idx) => (
            <div key={`${x.type}-${x.createdAt}-${idx}`} className={styles.row}>
              <div>
                <div className={styles.rowLeftTitle}>{typeLabel(x.type)}</div>
                <div className={styles.rowLeftSub}>{x.createdAt || "-"}</div>
              </div>
              <div className={styles.amount}>
                {displayAmount(x.type, x.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
