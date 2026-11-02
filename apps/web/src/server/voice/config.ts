// 받아쓰기(STT) 과금 경로 실패 닫힘 스위치. 켜짐 = ARCH_VOICE_STT_ENABLED가 정확히 "true"일 때만(기본 off).
// server-only를 import하지 않는다(node --test 대상).

export const VOICE_STT_ENABLED_ENV = "ARCH_VOICE_STT_ENABLED";

export function isVoiceSttEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[VOICE_STT_ENABLED_ENV] === "true";
}
