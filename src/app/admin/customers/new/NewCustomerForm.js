"use client";

import React from "react";
import { useFormState, useFormStatus } from "react-dom";
import styles from "./NewCustomerForm.module.css";
import { createUser } from "./actions";

const INITIAL_STATE = { message: null };

export default function AdminUsersForm() {
  const [state, formAction] = useFormState(createUser, INITIAL_STATE);

  return (
    <>
      <form action={formAction} className={styles.form}>
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

        <SubmitButton />
      </form>

      {state?.message && <p className={styles.resultHint}>{state.message}</p>}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className={styles.button} type="submit" disabled={pending}>
      {pending ? "생성 중..." : "생성"}
    </button>
  );
}