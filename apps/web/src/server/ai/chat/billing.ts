// 법규 질의 채팅 크레딧(정수). 1턴 1크레딧 선차감(01_PRD.md 4.5절, 04_API.md 2.2절 `/api/ai/chat`).
// 확정 차감은 Dify 경로로 출처가 붙은 답변을 전달했을 때만. 출처 없음(no_source)·폴백(answer-direct)·실패는 전액 환불(0크레딧).
// 멱등 키: 차감 `chat:<org_id>:<request_id>`, 환불 `chat:<org_id>:<request_id>:refund`(조직 범위, 이중 환불 없음).
// 같은 키의 기존 원장이 돌아오면(재전송·재사용) Dify·FastAPI를 부르지 않고 409(service.ts reserveFresh, 053과 같은 nonce 대조).
// server-only를 import하지 않는다(node --test 대상).
import { CHAT_TURN_CREDITS } from "../pricing.ts";

export const CHAT_TURN_COST = CHAT_TURN_CREDITS.credits;

export type ChatRoute = "dify" | "direct";

/** 이번 턴의 확정 크레딧. Dify 경로이고 출처가 있을 때만 1, 나머지 0. */
export function chatChargeFor(route: ChatRoute, noSource: boolean): number {
  return route === "dify" && !noSource ? CHAT_TURN_COST : 0;
}

export function chatIdempotencyKey(orgId: string, requestId: string): string {
  return `chat:${orgId}:${requestId}`;
}

export function chatRefundKey(orgId: string, requestId: string): string {
  return `chat:${orgId}:${requestId}:refund`;
}
