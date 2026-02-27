"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./CustomerList.module.css";

function normalizeText(v) {
  return String(v ?? "").trim().toLowerCase();
}

function formatWon(n) {
  const num = Number(n ?? 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
}

async function fetchCustomers() {

  const res = await fetch("/api/customers/list", { cache: "no-store" });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: j.error || "unknown_error" };
  }

  const data = await res.json();
  return { ok: true, data };
}

export default function AdminCustomersPage() {
  // UI state: 검색/필터/정렬
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [sortKey, setSortKey] = useState("createdDesc"); // createdDesc | nameAsc | rateDesc

  // ✅ API state
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setLoadError("");

      const result = await fetchCustomers();

      if (!alive) return;

      if (!result.ok) {
        setCustomers([]);
        setLoadError(`${result.error} (${result.status})`);
        setLoading(false);
        return;
      }

      setCustomers(Array.isArray(result.data?.customers) ? result.data.customers : []);
      setLoading(false);
    }

    run();

    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeText(query);

    let rows = customers.filter((c) => {
      const matchQuery =
        !q || normalizeText(c.name).includes(q) || normalizeText(c.userId).includes(q);

      const matchStatus = statusFilter === "all" ? true : c.status === statusFilter;

      return matchQuery && matchStatus;
    });

    if (sortKey === "createdDesc") {
      rows = rows
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    }

    if (sortKey === "nameAsc") {
      rows = rows.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    if (sortKey === "rateDesc") {
      rows = rows.slice().sort((a, b) => Number(b.hourlyRate || 0) - Number(a.hourlyRate || 0));
    }

    return rows;
  }, [customers, query, statusFilter, sortKey]);

  const total = customers.length;
  const showing = filtered.length;

  const page = 1;
  const totalPages = 1;

  return (
    <div className={styles.wrapper}>
      <div className={styles.headerRow}>
        <div className={styles.titleWrap}>
          <h1 className={styles.title}>고객 목록</h1>
          <p className={styles.description}>Google Sheets 기반 고객 목록입니다.</p>
        </div>

        <Link href="/admin/customers/new" className={styles.primaryAction}>
          + 신규 고객 등록
        </Link>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.controls}>
          <input
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 userId로 검색"
            aria-label="고객 검색"
          />

          <select
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="상태 필터"
          >
            <option value="all">상태: 전체</option>
            <option value="active">상태: active</option>
            <option value="inactive">상태: inactive</option>
          </select>

          <select
            className={styles.select}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            aria-label="정렬"
          >
            <option value="createdDesc">정렬: 최신 등록</option>
            <option value="nameAsc">정렬: 이름 오름차순</option>
            <option value="rateDesc">정렬: 시급 높은 순</option>
          </select>
        </div>

        <div className={styles.meta}>
          <span>
            전체 <span className={styles.metaStrong}>{total}</span>
          </span>
          <span>
            표시 <span className={styles.metaStrong}>{showing}</span>
          </span>
        </div>
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>불러오는 중…</div>
            <div className={styles.emptyHint}>고객 목록을 가져오고 있어요.</div>
          </div>
        ) : loadError ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>불러오기 실패</div>
            <div className={styles.emptyHint}>{loadError}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>조건에 맞는 고객이 없어요</div>
            <div className={styles.emptyHint}>검색어를 줄이거나 상태 필터를 바꿔보세요.</div>
          </div>
        ) : (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th>고객</th>
                <th>userId</th>
                <th className={styles.right}>시급(원)</th>
                <th>상태</th>
                <th>등록일</th>
              </tr>
            </thead>

            <tbody className={styles.tbody}>
              {filtered.map((c) => {
                const detailHref = `/admin/customers/detail/${encodeURIComponent(c.userId)}`;

                return (
                  <tr key={c.userId}>
                    <td>
                      <Link href={detailHref} className={styles.rowLink}>
                        {c.name || "-"}
                      </Link>
                      <span className={styles.subText}>상세 보기로 이동</span>
                    </td>

                    <td className={styles.mono}>{c.userId}</td>

                    <td className={`${styles.right} ${styles.mono}`}>{formatWon(c.hourlyRate)}</td>

                    <td>
                      <span
                        className={[
                          styles.badge,
                          c.status === "active" ? styles.badgeActive : styles.badgeInactive,
                        ].join(" ")}
                      >
                        {c.status || "active"}
                      </span>
                    </td>

                    <td className={styles.mono}>{c.createdAt || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className={styles.footer}>
          <div className={styles.meta}>
            페이지 <span className={styles.metaStrong}>{page}</span> / {totalPages}
          </div>

          <div className={styles.pager}>
            <button className={styles.pagerBtn} disabled>
              이전
            </button>
            <button className={styles.pagerBtn} disabled>
              다음
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}