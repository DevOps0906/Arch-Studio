// 매스 제안 데모 미리보기 종류(예시 데이터 없음 — 릴리스 번들에 들어가도 되는 가벼운 파일).
// `?state=suggest-empty|suggest-loading|suggest-error|suggest-ready|suggest-pass|suggest-short`. 예시 데이터는 preview.ts(개발 서버에서만 동적 로드).
export type SuggestPreviewKind = "empty" | "loading" | "error" | "ready" | "pass" | "short";
export const SUGGEST_PREVIEW_KINDS: readonly SuggestPreviewKind[] = ["empty", "loading", "error", "ready", "pass", "short"];

/** `?state=` 값 → 종류. 아니면 null. */
export function suggestPreviewKind(state: string | null): SuggestPreviewKind | null {
  if (!state?.startsWith("suggest-")) return null;
  return SUGGEST_PREVIEW_KINDS.find((k) => `suggest-${k}` === state) ?? null;
}
