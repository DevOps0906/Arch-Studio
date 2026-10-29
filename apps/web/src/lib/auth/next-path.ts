// 로그인 뒤 이동 경로 검사(AUTH_ROADMAP.md 3.2절 5번, B-2). 같은 출처의 상대 경로만, 아니면 기본 경로.

export const DEFAULT_NEXT = "/projects";
const BASE = "http://next-path.invalid";
const MAX_LEN = 512;

/** `/`로 시작하고 `//`·`/\`·`@`·`\`·제어문자·스킴이 없을 때만 그 경로. 결과는 항상 `/`로 시작하는 상대 경로. */
export function safeNextPath(next: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_LEN) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\\@\u0000-\u001f\u007f]/.test(next) || next.includes("://")) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  // 인코딩으로 숨긴 `//`·`\`·`@`(예: /%2F%2Fevil.com)
  if (decoded.startsWith("//") || /[\\@\u0000-\u001f\u007f]/.test(decoded) || decoded.includes("://")) return fallback;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
