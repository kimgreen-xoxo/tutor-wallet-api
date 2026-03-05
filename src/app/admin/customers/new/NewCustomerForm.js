"use client";

import React, { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./NewCustomerForm.module.css";
import { createUser } from "./actions";

/**
 *  신규 고객 등록 폼(UI)
 * - 서버 액션(createUser)을 호출해 고객 생성
 * - 생성 성공 시 state.userId가 생김
 * - "고객 상세로 이동" 버튼은 state.userId가 생기기 전엔 disabled
 */
const INITIAL_STATE = {
  ok: false,
  message: null,
  userId: null,
};


/** 숫자 문자열에서 숫자만 추출 후 천단위 콤마로 포맷 */
function formatNumberWithComma(value) {
  const onlyNum = String(value ?? "").replace(/[^\d]/g, "");
  if (!onlyNum) return "";
  return Number(onlyNum).toLocaleString("ko-KR");
}

/** 전화번호 입력을 010-1234-5678 형태로 자동 하이픈 포맷 */
function formatPhone(value) {
  const onlyNum = String(value ?? "").replace(/[^\d]/g, "");
  if (onlyNum.length < 4) return onlyNum;
  if (onlyNum.length < 8) return `${onlyNum.slice(0, 3)}-${onlyNum.slice(3)}`;
  return `${onlyNum.slice(0, 3)}-${onlyNum.slice(3, 7)}-${onlyNum.slice(7, 11)}`;
}

export default function NewCustomerForm() {
  // 역할: form DOM을 직접 reset()하기 위한 ref
  const formRef = useRef(null);
  const router = useRouter();

  /** 서버 액션 결과 상태(state) + form action(formAction) + pending 상태 */
  const [state, formAction, pending] = useActionState(createUser, INITIAL_STATE);

  /** 입력 UX 개선을 위한 클라이언트 상태(표시용 포맷) */
  const [phoneInput, setPhoneInput] = useState("");
  const [hourlyRateInput, setHourlyRateInput] = useState("");

// 생성 성공 시 폼 입력값 초기화 (effect setState 경고 방지)
useEffect(() => {
  if (state?.ok && state?.userId) {
    // 역할: 같은 렌더 사이클에서 바로 setState 하지 않도록 다음 tick으로 미룸
    const t = setTimeout(() => {
      // 1) uncontrolled input(text/name/textarea 등) 초기화
      formRef.current?.reset();

      // 2) controlled input(시급/전화)도 초기화
      setHourlyRateInput("");
      setPhoneInput("");
    }, 0);

    return () => clearTimeout(t);
  }
}, [state?.ok, state?.userId]);

  return (
    <>
      <form ref={formRef} action={formAction} className={styles.form}>
        <label className={styles.label}>
          이름
          <input className={styles.input} name="name" required />
        </label>

        <label className={styles.label}>
          시급
          <input
            className={styles.input}
            name="hourlyRate"
            value={hourlyRateInput}
            onChange={(e) => setHourlyRateInput(formatNumberWithComma(e.target.value))}
            inputMode="numeric"
            required
          />
        </label>

        <label className={styles.label}>
          연락처
          <input
            className={styles.input}
            name="phone"
            value={phoneInput}
            onChange={(e) => setPhoneInput(formatPhone(e.target.value))}
            inputMode="numeric"
          />
        </label>

        <label className={styles.label}>
          수업내용
          <textarea
            className={styles.textarea}
            name="lessonSummary"
            placeholder="예) 중2 수학, 주 2회, 시험 대비"
            rows={3}
          />
        </label>

        <div className={styles.actionsRow}>
          <button className={styles.button} type="submit" disabled={pending}>
            {pending ? "생성 중..." : "생성"}
          </button>

          {/*  생성 성공 전에는 이동 불가(비활성), 성공 후 활성 */}
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={!state?.userId}
            onClick={() => router.push(`/admin/customers/detail/${state.userId}`)}
            title={!state?.userId ? "먼저 고객을 생성하세요" : "고객 상세로 이동"}
          >
            고객 상세로 이동
          </button>
        </div>
      </form>

      {/* 서버 액션 결과 메시지 표시 */}
      {state?.message && <p className={styles.resultHint}>{state.message}</p>}
    </>
  );
}