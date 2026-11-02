// 클라우드 법규 검토 실패 닫힘 스위치(웹·워커 공유 env 이름과 해석). 켜짐 = ARCH_AI_REVIEW_ENABLED가 정확히 "true"일 때만(기본 off).
// 워커 핸들러 등록(B2)도 같은 이름·같은 판정을 쓴다. server-only를 import하지 않는다(node --test 대상).

export const REVIEW_ENABLED_ENV = "ARCH_AI_REVIEW_ENABLED";

export function isReviewEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[REVIEW_ENABLED_ENV] === "true";
}
