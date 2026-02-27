import styles from "./AdminUsers.module.css";
import AdminUsersForm from "./AdminUsersForm.client";

export default function AdminUsersPage() {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.kicker}>Tutor Wallet Admin</div>
        <h1 className={styles.title}>신규 고객</h1>

        <AdminUsersForm />
      </div>
    </div>
  );
}