// 법규 질의 채팅 크레딧(정수). 1턴 1크레딧 선차감(01_PRD.md 4.5절, 04_API.md 2.2절 `/api/ai/chat`).
// 출처가 붙은 답을 전달하면 경로(Dify·answer-direct 폴백)와 무관하게 1크레딧 확정. 출처 없음(no_source)·실패·중단만 전액 환불(0크레딧).
// (06_AGENT_PLAN "폴백 상태 턴 0"은 라이선스 폴백 상태 조직의 일일 턴 0이다 — service.ts checkDailyLimit.)
// 멱등 키: 차감 `chat:<org_id>:<request_id>`, 환불 `chat:<org_id>:<request_id>:refund`(조직 범위, 이중 환불 없음).
// 같은 키의 기존 원장이 돌아오면(재전송·재사용) Dify·FastAPI를 부르지 않고 409(service.ts reserveFresh, 053과 같은 nonce 대조).
// server-only를 import하지 않는다(node --test 대상).
import { CHAT_TURN_CREDITS } from "../pricing.ts";

export const CHAT_TURN_COST = CHAT_TURN_CREDITS.credits;

export type ChatRoute = "dify" | "direct";

/** 이번 턴의 확정 크레딧. 출처가 있으면 1, 없으면 0(경로 무관). */
export function chatChargeFor(noSource: boolean): number {
  return noSource ? 0 : CHAT_TURN_COST;
}

export function chatIdempotencyKey(orgId: string, requestId: string): string {
  return `chat:${orgId}:${requestId}`;
}

export function chatRefundKey(orgId: string, requestId: string): string {
  return `chat:${orgId}:${requestId}:refund`;
}
