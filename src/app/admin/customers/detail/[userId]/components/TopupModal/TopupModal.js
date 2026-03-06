"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./TopupModal.module.css";

/**
 * 역할: 금액 입력 모달 UI + 충전 API 호출
 * - 열기/닫기 상태는 부모(page.js)에서 제어
 * - 충전 성공하면 부모에게 onSuccess()로 알려서 detail 새로고침 유도
 */
export default function TopupModal({
  open,
  onClose,
  userId,
  userName,
  onSuccess,
}) {
  // 역할: 모달 입력값(천단위 콤마 표시)
  const [amountInput, setAmountInput] = useState("");

  // 역할: 요청 상태(중복 클릭 방지)
  const [pending, setPending] = useState(false);

  // 역할: 에러 메시지 표시
  const [error, setError] = useState("");

  // 역할: 모달이 열릴 때마다 입력/에러 초기화
  useEffect(() => {
    if (!open) return;
    setAmountInput("");
    setError("");
    setPending(false);
  }, [open]);

  // 역할: ESC로 닫기
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // 역할: 화면 표시용 포맷(숫자만 남기고 콤마)
  function formatNumberWithComma(value) {
    const onlyNum = String(value ?? "").replace(/[^\d]/g, "");
    if (!onlyNum) return "";
    return Number(onlyNum).toLocaleString("ko-KR");
  }

  // 역할: 서버로 보낼 number(콤마 제거 후 정수 변환)
  const amountNumber = useMemo(() => {
    const raw = String(amountInput ?? "").replace(/,/g, "");
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }, [amountInput]);

  // 역할: idempotency(중복 요청 방지용) requestId 생성
  function makeRequestId() {
    const rand = Math.random().toString(16).slice(2, 6);
    return `topup_${userId}_${Date.now()}_${rand}`;
  }

  // 역할: 충전 API 호출
  async function submitTopup() {
    setError("");

    if (!userId) {
      setError("userId가 없습니다.");
      return;
    }

    // ✅ amount 검증
    if (
      !Number.isInteger(amountNumber) ||
      amountNumber <= 0 ||
      amountNumber > 1_000_000
    ) {
      setError("충전 금액은 1 ~ 1,000,000 사이의 정수여야 합니다.");
      return;
    }

    const requestId = makeRequestId();

    try {
      setPending(true);

      // NOTE: 같은 프로젝트 내부 API라 상대경로로 호출
      const res = await fetch("/api/ledger/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          userId,
          userName,
          amount: amountNumber,
          relatedSessionId: "",
        }),
      });

      const json = await res.json().catch(() => ({}));

      // 표준 스키마면 ok 체크, 아니면 res.ok fallback
      const ok = Boolean((json && json.ok === true) || res.ok);

      if (!ok) {
        const code = json?.error?.code || json?.error || "topup_failed";
        const msg =
          json?.error?.message || json?.message || "충전에 실패했습니다.";
        setError(`${code}: ${msg}`);
        return;
      }

      // ✅ 성공 처리
      onSuccess?.();
      onClose?.();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>요금 충전</div>
          <button
            className={styles.modalClose}
            type="button"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.modalHint}>
            <b>{userName || "-"}</b>
          </div>

          <label className={styles.label}>
            충전 금액
            <input
              className={styles.input}
              inputMode="numeric"
              value={amountInput}
              onChange={(e) =>
                setAmountInput(formatNumberWithComma(e.target.value))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) {
                  submitTopup();
                }
              }}
              autoFocus
            />
          </label>

          {error ? <div className={styles.modalError}>❌ {error}</div> : null}
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onClose}
            disabled={pending}
          >
            취소
          </button>
          <button
            className={styles.button}
            type="button"
            onClick={submitTopup}
            disabled={pending}
          >
            {pending ? "처리 중..." : "충전하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
