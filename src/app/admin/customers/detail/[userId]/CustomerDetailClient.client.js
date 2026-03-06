"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./CustomerDetail.module.css";
import TopupModal from "./components/TopupModal/TopupModal";
import ChargeModal from "./components/Charge/ChargeModal";

/** 역할: 안전 문자열 변환 */
function toStr(v) {
  return String(v ?? "").trim();
}

/** 역할: 콤마 포함 숫자 문자열도 number로 변환 (실패 시 0) */
function toNum(v) {
  const n = Number(String(v ?? "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 역할: 원화 표기(천단위 콤마) */
function formatWon(v) {
  return toNum(v).toLocaleString("ko-KR");
}

/** 역할: 거래 타입 라벨 */
function typeLabel(type) {
  const t = toStr(type).toLowerCase();
  if (t === "topup") return "충전";
  if (t === "charge") return "차감";
  return t || "-";
}

/** 역할: 거래 금액 표시 규칙(차감 - / 충전 +) */
function displayAmount(type, amount) {
  const n = toNum(amount);
  if (toStr(type).toLowerCase() === "charge")
    return `-${Math.abs(n).toLocaleString("ko-KR")}원`;
  return `+${Math.abs(n).toLocaleString("ko-KR")}원`;
}

/** 역할: createdAt을 "시간만" 보여주기 */
function formatTimeOnly(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function CustomerDetailClient({ customer }) {
  const router = useRouter();

  // 역할: 충전 모달 열림/닫힘 상태
  const [openTopup, setOpenTopup] = useState(false);
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const name = customer?.name || "-";
  const balance = customer?.balance ?? 0;
  const hourlyRate = customer?.hourlyRate ?? 0;

  const ledger = Array.isArray(customer?.ledger)
    ? customer.ledger
    : Array.isArray(customer?.recent)
      ? customer.recent
      : [];

  return (
    <div className={styles.wrapper}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>{name}</h1>
          <div className={styles.subTitle}></div>
        </div>

        <div className={styles.headerActionsRow}>
          <button
            className={styles.button}
            type="button"
            onClick={() => setOpenTopup(true)}
          >
            요금 충전
          </button>
          <button type="button" onClick={() => setIsChargeOpen(true)}>
            차감
          </button>
          <Link href="/admin/customers/list" className={styles.backLink}>
            ← 목록으로
          </Link>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.summaryRow}>
          <div className={styles.summaryBlock}>
            <div className={styles.summaryLabel}>현재 잔액</div>
            <div className={styles.summaryValue}>{formatWon(balance)}원</div>
          </div>

          <div className={styles.summaryBlock}>
            <div className={styles.summaryLabel}>시급</div>
            <div className={styles.summaryValue}>{formatWon(hourlyRate)}원</div>
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
              <div
                key={`${x.createdAt || "no-date"}-${idx}`}
                className={styles.ledgerRow}
              >
                <div className={styles.ledgerLeft}>
                  <div className={styles.type}>{typeLabel(x.type)}</div>
                  <div className={styles.date}>
                    {formatTimeOnly(x.createdAt)}
                  </div>
                </div>
                <div className={styles.amount}>
                  {displayAmount(x.type, x.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TopupModal
        open={openTopup}
        onClose={() => setOpenTopup(false)}
        userId={customer?.userId}
        userName={customer?.name}
        onSuccess={() => router.refresh()} // 역할: 충전 성공 후 서버 fetch 다시 실행
      />
      <ChargeModal
        open={isChargeOpen}
        onClose={() => setIsChargeOpen(false)}
        userId={customer.userId}
        userName={customer.name}
        hourlyRate={customer.hourlyRate}
        onSuccess={() => {}}
      />
    </div>
  );
}
