import Link from "next/link";
import { headers } from "next/headers";
import styles from "./CustomerDetail.module.css";

function toStr(v) {
  return String(v ?? "").trim();
}

function toNum(v) {
  const n = Number(String(v ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatWon(v) {
  return toNum(v).toLocaleString();
}

function typeLabel(type) {
  const t = toStr(type).toLowerCase();
  if (t === "topup") return "충전";
  if (t === "charge") return "차감";
  return t || "-";
}

function displayAmount(type, amount) {
  const n = toNum(amount);
  if (toStr(type).toLowerCase() === "charge")
    return `-${Math.abs(n).toLocaleString()}원`;
  return `+${Math.abs(n).toLocaleString()}원`;
}

async function fetchAdminCustomer(userId) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  // NOTE: admin 전용 상세 API
  const url = `${proto}://${host}/api/customers/detail?u=${encodeURIComponent(userId)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  return { ok: res.ok, status: res.status, data };
}

export default async function AdminCustomerDetailPage({ params }) {
  const { userId } = await params;
  const safeUserId = String(userId ?? "").trim();

  if (!safeUserId) {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>고객 상세</h1>
        <p>userId가 비어있습니다.</p>
        <Link href="/admin/customers/list" className={styles.backLink}>
          ← 목록으로
        </Link>
      </div>
    );
  }

  const result = await fetchAdminCustomer(userId);

  if (!result.ok) {
    return (
      <div className={styles.wrapper}>
        <h1 className={styles.title}>고객 상세</h1>
        <p>
          조회 실패: <b>{result.data?.error || "unknown_error"}</b> (
          {result.status})
        </p>
        <Link href="/admin/customers/list" className={styles.backLink}>
          ← 목록으로
        </Link>
      </div>
    );
  }

  // NOTE:
  // - API가 ledger 전체를 주면 ledger 사용
  // - 아직 recent(3개)만 주면 recent를 일단 ledger처럼 보여줌(임시)
  const name = result.data?.name || "-";
  const balance = result.data?.balance ?? 0;
  const hourlyRate = result.data?.hourlyRate ?? 0;

  const ledger = Array.isArray(result.data?.ledger)
    ? result.data.ledger
    : Array.isArray(result.data?.recent)
      ? result.data.recent
      : [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>고객 상세</h1>
          <div className={styles.subTitle}>
            <b>{name}</b>
          </div>
        </div>

        <Link href="/admin/customers/list" className={styles.backLink}>
          ← 목록으로
        </Link>
      </div>

      <div className={styles.card}>
        <div className={styles.summaryRow}>
          <div className={styles.summaryBlock}>
            <div className={styles.summaryLabel}>현재 잔액</div>
            <div className={styles.summaryValue}>
              {Number(balance).toLocaleString()}원
            </div>
          </div>

          <div className={styles.summaryBlock}>
            <div className={styles.summaryLabel}>시급</div>
            <div className={styles.summaryValue}>
              {Number(hourlyRate).toLocaleString()}원
            </div>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.sectionHeader}>
          전체 거래 내역 ({ledger.length})
        </div>

        {ledger.length === 0 ? (
          <div className={styles.empty}>내역이 없습니다.</div>
        ) : (
          <div className={styles.ledgerList}>
            {ledger.map((x, idx) => (
              <div key={`${x.createdAt}-${idx}`} className={styles.ledgerRow}>
                <div className={styles.ledgerLeft}>
                  <div className={styles.type}>{typeLabel(x.type)}</div>
                  <div className={styles.date}>{x.createdAt || "-"}</div>
                </div>

                <div className={styles.amount}>
                  {displayAmount(x.type, x.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
