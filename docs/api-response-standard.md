# Tutor Wallet API Response Standard v1

이 문서는 Tutor Wallet의 모든 API가 따르는 공통 응답 스키마와 규칙을 정의한다.  
프론트엔드와 백엔드 간의 계약(Contract)을 명확히 하고, 일관된 에러 처리와 확장성을 보장하는 것이 목적이다.

---

## 1. 공통 응답 구조

모든 API는 반드시 아래 중 하나의 구조로 응답한다.

### ✅ Success Response

{
  "ok": true,
  "data": {},
  "meta": {}
}

설명:
- ok: 항상 true
- data: 실제 응답 데이터 (object | array | null)
- meta: 부가 정보 (없으면 빈 객체)

---

### ❌ Error Response

{
  "ok": false,
  "error": {
    "code": "string",
    "message": "string",
    "detail": {}
  }
}

설명:
- ok: 항상 false
- error.code: 프론트 분기용 (machine-friendly)
- error.message: 사용자 표시용 메시지
- error.detail: 선택적 디버깅 정보

---

## 2. Status Code 규칙

200  OK                  정상 응답  
201  Created             리소스 생성 성공  
400  Bad Request         파라미터 누락/형식 오류  
401  Unauthorized        x-admin-key 없음/불일치  
403  Forbidden           접근 금지 (예: inactive user)  
404  Not Found           대상 없음  
409  Conflict            중복 requestId 등 충돌  
429  Too Many Requests   요청 과다 (향후 확장)  
500  Internal Server Error  예기치 못한 서버 오류  

모든 4xx/5xx 응답은 반드시 Error Response 구조를 따른다.

---

## 3. Pagination 규칙 (List API 전용)

Request Query:
- limit (number, optional, 기본 20)
- cursor (string, optional)

Response 예시:

{
  "ok": true,
  "data": [],
  "meta": {
    "page": {
      "limit": 20,
      "nextCursor": "string-or-null",
      "hasNext": true
    }
  }
}

---

## 4. meta 공통 규칙

meta는 선택적이며 다음 필드를 포함할 수 있다:

- ts (string): ISO timestamp
- count (number): 반환된 항목 수
- requestId (string): 추적용 ID
- page (object): 페이지네이션 정보

예시:

{
  "ok": true,
  "data": {},
  "meta": {
    "ts": "2026-02-28T10:00:00+09:00",
    "count": 3
  }
}

---

## 5. 예시

### 성공 예시

{
  "ok": true,
  "data": {
    "userId": "U0002",
    "balance": 30000
  },
  "meta": {
    "ts": "2026-02-28T10:00:00+09:00"
  }
}

### 실패 예시

{
  "ok": false,
  "error": {
    "code": "missing_user_id",
    "message": "Query param 'u' (userId) is required.",
    "detail": {}
  }
}

---

## 6. 설계 원칙

1. 모든 API는 ok 필드를 반드시 포함한다.
2. 성공과 실패는 절대 같은 구조를 공유하지 않는다.
3. 문자열 기반 error만 반환하는 형태는 금지한다.
4. 프론트는 오직 ok 값만 보고 1차 분기한다.
5. 확장은 meta를 통해 수행한다. (data 구조는 깨지지 않도록 유지)

---

이 문서는 Tutor Wallet API v1의 기준이며,
모든 신규 API는 이 스키마를 따라야 한다.