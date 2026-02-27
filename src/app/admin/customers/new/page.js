import styles from "./NewCustomerForm.module.css";
import NewCustomerForm from "./NewCustomerForm";

export default function NewCustomerFormPage() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.kicker}>Tutor Wallet Admin</div>
        <h1 className={styles.title}>신규 고객</h1>

        <NewCustomerForm />
      </div>
    </div>
  );
}