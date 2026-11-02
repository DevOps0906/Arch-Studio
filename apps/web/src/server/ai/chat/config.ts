// 법규 질의 채팅 과금 경로 실패 닫힘 스위치. 켜짐 = ARCH_AI_CHAT_ENABLED가 정확히 "true"일 때만(기본 off).
// server-only를 import하지 않는다(node --test 대상).

export const AI_CHAT_ENABLED_ENV = "ARCH_AI_CHAT_ENABLED";

export function isChatEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[AI_CHAT_ENABLED_ENV] === "true";
}
