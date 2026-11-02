// arch.review 실패 닫힘 설정. 웹(apps/web/src/server/ai/review/config.ts isReviewEnabled)과 같은 이름·같은 해석(표 REVIEW_CONFIG_CASES).
// 켜짐 = ARCH_AI_REVIEW_ENABLED가 정확히 "true" **이고** 그래프 서버 주소 ARCH_AI_API_URL(https, 개발은 http://127.0.0.1·localhost)이 있음.
// 꺼져 있으면 핸들러를 등록하지 않는다 → arch.review 큐를 claim하지 않는다(웹도 같은 조건으로 접수·차감을 막는다).
export const REVIEW_ENABLED_ENV = "ARCH_AI_REVIEW_ENABLED";
export const REVIEW_API_URL_ENV = "ARCH_AI_API_URL";

export interface ReviewConfig {
  enabled: boolean;
  /** null = 주소 없음·형식 오류(핸들러 미등록). */
  apiUrl: string | null;
}

const LOCAL_HTTP = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/|$)/;

export function loadReviewConfig(env: Readonly<Record<string, string | undefined>>): ReviewConfig {
  const raw = env[REVIEW_API_URL_ENV] ?? "";
  let apiUrl: string | null = null;
  if (raw.startsWith("https://") || LOCAL_HTTP.test(raw)) {
    try {
      apiUrl = new URL(raw).toString();
    } catch {
      apiUrl = null;
    }
  }
  return { enabled: env[REVIEW_ENABLED_ENV] === "true", apiUrl };
}
