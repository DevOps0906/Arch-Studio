// 컴파일 타임 검사(tsc --noEmit이 돌린다; 실행되지 않는다). @ts-expect-error가 사라지면 typecheck가 실패한다.
import type { ApiClient } from "./types.ts";

declare const api: ApiClient;
const key = "00000000-0000-4000-8000-000000000000";

// 정상 호출
void api.request({ method: "GET", path: "/api/entitlement" });
void api.request({ method: "POST", path: "/api/ai/review", idempotencyKey: key, body: { request_id: key, project_ref: key } });

// 서버가 정하는 값은 본문에 못 싣는다.
// @ts-expect-error org_id 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: { org_id: "o" } });
// @ts-expect-error amount 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: { amount: 1000 } });
// @ts-expect-error credits 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: { credits: 3 } });
// @ts-expect-error price 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: { price: 1 } });
// @ts-expect-error 중첩 객체 안에서도 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: { preset: { orgId: "o" } } });

declare const viaVariable: { credits: number };
// @ts-expect-error 변수로 우회해도 금지
void api.request({ method: "POST", path: "/x", idempotencyKey: key, body: viaVariable });

// 변경 요청은 멱등 키 필수.
// @ts-expect-error idempotencyKey 누락
void api.request({ method: "POST", path: "/x", body: { a: 1 } });
// @ts-expect-error DELETE도 필수
void api.request({ method: "DELETE", path: "/x" });
// @ts-expect-error GET은 멱등 키를 갖지 않는다
void api.request({ method: "GET", path: "/x", idempotencyKey: key });
