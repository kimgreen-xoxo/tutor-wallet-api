"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../TopupModal/TopupModal.module.css"; // 역할: 기존 모달 스타일 재사용

/** 어떤 값이 와도 숫자만 남기기 */
function onlyNumber(value) {
  return String(value ?? "").replace(/[^\d]/g, "");
}

/** 숫자 콤마 포맷 */
function formatNumberWithComma(value) {
  const only = onlyNumber(value);

  if (!only) {
    return "";
  }

  return Number(only).toLocaleString("ko-KR");
}

/** 분 입력값을 숫자로 변환 */
function toMinutes(value) {
  const num = Number(onlyNumber(value));
  return Number.isFinite(num) ? num : 0;
}

/** 원화 표시 */
function formatWon(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

export default function ChargeModal({
  open,
  onClose,
  userId,
  userName,
  hourlyRate,
  onSuccess,
}) {
  const router = useRouter();
  const [minutesInput, setMinutesInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // 역할: 모달 닫혀있으면 렌더 안 함
  
  const minutes = toMinutes(minutesInput);
  const chargeAmount = Math.floor((Number(hourlyRate || 0) / 60) * minutes);
  
  async function submitCharge() {
    // 역할: 중복 요청 방지
    if (pending) {
      return;
    }
    
    if (!minutes || minutes <= 0) {
      setError("차감 시간을 입력해주세요.");
      return;
    }
    
    try {
      setPending(true);
      setError("");
      
      const response = await fetch("/api/ledger/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          userId,
          userName: userName || "",
          minutes,
          hourlyRate: Number(hourlyRate || 0),
          relatedSessionId: "",
        }),
      });
      
      const result = await response.json();
      
      if (!response.ok || !result.ok) {
        throw new Error(result?.meta?.message || result?.error || "charge_failed");
      }
      
      router.refresh();
      
      if (onSuccess) {
        onSuccess(result);
      }
      
      onClose();
      setMinutesInput("");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setPending(false);
    }
  }
  
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
      
      if (event.key === "Enter" && !pending) {
        submitCharge();
      }
    }
    
    window.addEventListener("keydown", handleKeyDown);
    
    if (!open) {
      return;
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pending, minutesInput, hourlyRate]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h3 className={styles.title}>수업 차감</h3>

        <p className={styles.description}>
          {userName} 님에게서 수업 시간을 차감합니다.
        </p>

        <label className={styles.label}>
          차감 시간(분)
          <input
            className={styles.input}
            inputMode="numeric"
            value={minutesInput}
            onChange={(event) => {
              setMinutesInput(formatNumberWithComma(event.target.value));
            }}
            autoFocus
          />
        </label>

        <div className={styles.summary}>
          <p>입력 시간: {minutes || 0}분</p>
          <p>차감 금액: {formatWon(chargeAmount)}</p>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <div className={styles.buttonGroup}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onClose}
            disabled={pending}
          >
            닫기
          </button>

          <button
            className={styles.button}
            type="button"
            onClick={submitCharge}
            disabled={pending}
          >
            {pending ? "처리 중..." : "차감하기"}
          </button>
        </div>
      </div>
    </div>
  );
}