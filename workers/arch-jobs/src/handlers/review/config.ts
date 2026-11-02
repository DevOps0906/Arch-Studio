// arch.review 실패 닫힘 스위치. 정확히 "true"이고 FastAPI 주소·웹 주소·워커 키가 모두 있을 때만 핸들러를 등록한다
// (꺼져 있으면 arch.review 큐를 claim하지 않는다 → 집었다가 실패·환불시키지 않음). 웹 라우트의 스위치와 같은 이름.
export const REVIEW_ENABLED_ENV = "ARCH_AI_REVIEW_ENABLED";
export const REVIEW_API_URL_ENV = "ARCH_API_URL";

export interface ReviewConfig {
  enabled: boolean;
  apiUrl: string | null;
}

export function loadReviewConfig(env: Readonly<Record<string, string | undefined>>): ReviewConfig {
  const apiUrl = env[REVIEW_API_URL_ENV] || null;
  const ready = !!apiUrl && !!env["ARCH_WEB_URL"] && !!env["ARCH_WORKER_INTERNAL_KEY"];
  return { enabled: env[REVIEW_ENABLED_ENV] === "true" && ready, apiUrl };
}
