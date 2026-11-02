// STT 크레딧 계산(정수). 분당 1, 실제 길이로 정산(01_PRD.md 4.5절, 04_API.md 1장 "환불"·2.2절 `/api/voice/stt`).
// 선차감 = 상한 길이(받아쓰기 60초) 또는 신고 길이(상담) 기준, 정산 = 제공자가 잰 실제 길이 기준. 실제가 더 길어도 선차감보다 더 받지 않는다.
// 멱등 키: 차감 `voice:<request_id>`, 정산 환불 `voice:<request_id>:settle`(같은 요청 재전송·재시도에 추가 차감·이중 환불 없음).
// 워커(workers/arch-jobs/src/handlers/stt/billing.ts)에 같은 식이 있다. 바꾸면 함께 바꾼다.
// server-only를 import하지 않는다(node --test 대상).
import { STT_CREDITS_PER_MINUTE } from "../ai/pricing.ts";

export const DICTATION_MAX_SECONDS = 60;
export const CONSULT_MAX_SECONDS = 7200;
/** 컨테이너 길이 반올림 허용치(초). 받아쓰기 61초까지는 60초로 본다. */
export const DURATION_TOLERANCE_S = 1;

/** 초 → 크레딧. 0.01초 단위(voice_jobs.duration_seconds numeric(10,2))로 자른 뒤 분 단위 올림. 0초는 0. */
export function sttCreditsFor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("invalid duration");
  const centis = Math.round(seconds * 100);
  return Math.ceil(centis / 6000) * STT_CREDITS_PER_MINUTE.credits;
}

/** 선차감(reserved)과 실제 길이 → 확정 차감과 돌려줄 크레딧. */
export function settleStt(reserved: number, actualSeconds: number): { charged: number; refund: number } {
  const charged = Math.min(sttCreditsFor(actualSeconds), reserved);
  return { charged, refund: reserved - charged };
}

export function voiceIdempotencyKey(requestId: string): string {
  return `voice:${requestId}`;
}

export function voiceSettleKey(requestId: string): string {
  return `voice:${requestId}:settle`;
}
