// STT 정산 식(웹 apps/web/src/server/voice/billing.ts와 같은 식·같은 키. 바꾸면 함께 바꾼다).
// 분당 1, 0.01초 단위로 자른 뒤 분 단위 올림. 실제 길이가 신고보다 길어도 선차감보다 더 받지 않는다.
export const STT_CREDITS_PER_MINUTE = 1;

export function sttCreditsFor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("invalid duration");
  return Math.ceil(Math.round(seconds * 100) / 6000) * STT_CREDITS_PER_MINUTE;
}

export function settleStt(reserved: number, actualSeconds: number): { charged: number; refund: number } {
  const charged = Math.min(sttCreditsFor(actualSeconds), reserved);
  return { charged, refund: reserved - charged };
}

export function voiceSettleKey(orgId: string, requestId: string): string {
  return `voice:${orgId}:${requestId}:settle`;
}
