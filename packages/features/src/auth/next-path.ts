// 로그인 뒤 이동 경로 검사(AUTH_ROADMAP.md 3.2절 5번, B-2). 같은 출처의 상대 경로만, 아니면 기본 경로.
// 이 파일은 apps/web/src/lib/auth/next-path.ts와 packages/features/src/auth/next-path.ts에 글자 그대로 같은 내용으로 있다
// (패키지 경계상 서로 import할 수 없음). 한쪽을 고치면 다른 쪽도 같이 고친다 — boundary.test.ts가 동일성을 검사한다.

export const DEFAULT_NEXT = "/projects";
const BASE = "http://next-path.invalid";
const MAX_LEN = 512;
/** 이중·삼중 인코딩(%252e 등)을 벗기는 최대 횟수. 이 뒤에도 바뀌면 거부. */
const MAX_DECODE = 4;
const FORBIDDEN_CHARS = /[\\@\u0000-\u001f\u007f]/;

/** WHATWG URL(브라우저·Node 공통 전역). features 패키지는 DOM·Node 타입이 없어 필요한 모양만 적는다(두 패키지 동일 파일 유지). */
interface ParsedUrl {
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}
const UrlCtor = (globalThis as unknown as { URL: new (input: string, base: string) => ParsedUrl }).URL;

/** 퍼센트 인코딩을 더 바뀌지 않을 때까지 벗기고 NFKC로 정규화(전각 `．`·`／`·`＼` → `.`·`/`·`\`). 실패는 null. */
function deepDecode(value: string): string | null {
  let cur = value;
  for (let i = 0; i <= MAX_DECODE; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      return null;
    }
    if (next === cur) return cur.normalize("NFKC");
    cur = next;
  }
  return null;
}

/** 검사 대상 문자열(원문 또는 해독본) 하나가 위험한 모양인지. */
function looksUnsafe(value: string): boolean {
  return value.startsWith("//") || value.startsWith("/\\") || FORBIDDEN_CHARS.test(value) || value.includes("://");
}

/**
 * `/`로 시작하고 `//`·`/\`·`@`·`\`·제어문자·스킴·점 세그먼트(`.`·`..`, 인코딩·전각 포함)가 없을 때만 그 경로.
 * 결과는 항상 `/`로 시작하고 `//`·`/\`로 시작하지 않는 같은 출처 상대 경로이며, 결과를 다시 넣으면 같은 값이 나온다(멱등).
 */
export function safeNextPath(next: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof next !== "string" || next.length === 0 || next.length > MAX_LEN) return fallback;
  if (!next.startsWith("/") || looksUnsafe(next)) return fallback;
  const decoded = deepDecode(next);
  // 인코딩·전각으로 숨긴 `//`·`\`·`@`·제어문자(예: /%2F%2Fevil.com, /%5Cevil.com, /／／evil.com)
  if (decoded === null || looksUnsafe(decoded)) return fallback;
  // 점 세그먼트: new URL이 접으면 `/.//evil.com` → `//evil.com`이 된다. 경로 부분의 세그먼트를 하나씩 해독해 검사한다.
  const rawPath = next.split(/[?#]/, 1)[0] ?? "";
  for (const segment of rawPath.split("/")) {
    const seg = deepDecode(segment);
    if (seg === null || seg === "." || seg === "..") return fallback;
  }
  let result: string;
  try {
    const url = new UrlCtor(next, BASE);
    if (url.origin !== BASE) return fallback;
    result = `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
  // 정규화 "뒤"의 결과를 다시 검사한다(검사와 반환값이 갈라지지 않게).
  if (!result.startsWith("/") || result.startsWith("//") || result.startsWith("/\\")) return fallback;
  if (new UrlCtor(result, BASE).origin !== BASE) return fallback;
  return result;
}
