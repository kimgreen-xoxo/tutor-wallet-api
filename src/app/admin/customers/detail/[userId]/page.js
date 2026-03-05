import Link from "next/link";
import { headers } from "next/headers";
import styles from "./CustomerDetail.module.css";
import TopupMadal from "./components/TopupModal/TopupModal";

/** 역할: 어떤 값이 와도 안전한 문자열(공백 제거)로 변환 */
function toStr(v) {
  return String(v ?? "").trim();
}

/**
 * 역할: 서버 컴포넌트에서 Admin 고객 상세 API를 호출
 * - 현재 요청의 host/proto를 읽어서 절대 URL로 호출(로컬/배포 모두 대응)
 * - 표준 스키마: { ok, data, error, meta } 기반으로 결과를 정규화해서 반환
 */
async function fetchAdminCustomer(userId) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";

  const url = `${proto}://${host}/api/customers/detail?u=${encodeURIComponent(userId)}`;

  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));

  // 역할: HTTP 성공(res.ok) + API 스키마 성공(json.ok) 둘 다 true일 때만 성공으로 판정
  const ok = Boolean(res.ok && json?.ok);

  return {
    ok,
    status: res.status,
    data: ok ? json.data : null, // ✅ 성공 시 payload만 전달
    error: ok ? null : json?.error, // ✅ 실패 시 표준 에러 객체 전달
    meta: ok ? json?.meta ?? null : null,
  };
}

export default async function AdminCustomerDetailPage({ params }) {
  // NOTE: Next 16+ dynamic params는 await가 필요할 수 있음(현재 프로젝트 패턴 유지)
  const { userId } = await params;
  const safeUserId = toStr(userId);

  // ✅ 파라미터 방어
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

  // ✅ API 호출
  const result = await fetchAdminCustomer(safeUserId);

  // ✅ 실패 UI
  if (!result.ok) {
    return (
      
      <div className={styles.wrapper}>
        <h1 className={styles.title}>고객 상세</h1>

        <p>
          조회 실패: <b>{result.error?.code || "unknown_error"}</b> ({result.status})
        </p>
        <p>{result.error?.message || ""}</p>

        <Link href="/admin/customers/list" className={styles.backLink}>
          ← 목록으로
        </Link>
      </div>
    );
  }

  // ✅ 성공 시: Client 컴포넌트로 데이터 전달 (모달/버튼은 client에서 관리)
  return (
    <div className={styles.wrapper}>
      <TopupMadal customer={result.data} />
    </div>
  );
}