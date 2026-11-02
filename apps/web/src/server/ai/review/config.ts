// 클라우드 법규 검토 실패 닫힘 스위치(웹·워커 공유 env 이름과 해석, AR-06-051).
// 켜짐 = ARCH_AI_REVIEW_ENABLED가 정확히 "true" **이고** 그래프 서버 주소(ARCH_AI_API_URL, https 또는 개발용 http://127.0.0.1·localhost)가 있음.
// 워커(workers/arch-jobs/src/handlers/review/config.ts loadReviewConfig)와 같은 규칙이다: 웹이 스위치만 보고 차감·enqueue하면
// 워커가 핸들러를 등록하지 않은 환경에서 잡이 queued로 방치된다. 같은 입력 표로 양쪽을 검사한다(REVIEW_CONFIG_CASES).
// server-only를 import하지 않는다(node --test 대상).

export const REVIEW_ENABLED_ENV = "ARCH_AI_REVIEW_ENABLED";
export const REVIEW_API_URL_ENV = "ARCH_AI_API_URL";

const LOCAL_HTTP = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;

/** 그래프 서버 주소. 형식이 틀리면 null. */
export function reviewApiUrlOf(env: Readonly<Record<string, string | undefined>>): string | null {
  const raw = env[REVIEW_API_URL_ENV] ?? "";
  if (!(raw.startsWith("https://") || LOCAL_HTTP.test(raw))) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

export function isReviewEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[REVIEW_ENABLED_ENV] === "true" && reviewApiUrlOf(env) !== null;
}
