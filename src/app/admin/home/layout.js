import Link from "next/link";
import styles from "./HomeLayout.module.css";

export default function AdminLayout({ children }) {
  return (
    <div className={styles.wrapper}>
      <aside className={styles.sidebar}>
        <div className={styles.title}>Admin</div>

        <nav className={styles.nav}>
          <Link href="/admin/customerList" className={styles.link}>
            고객 목록
          </Link>
          <Link href="/admin/newCustomer" className={styles.link}>
            신규 고객 등록
          </Link>
        </nav>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  );
}