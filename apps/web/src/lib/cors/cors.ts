// API 공용 CORS(AR-06-071 결정 8). proxy.ts가 /api/* 모든 요청에 쓴다. 순수 모듈(next 미의존, node --test 대상).
// - 허용 출처 = 웹 스튜디오 1(STUDIO_ORIGIN) + 설치형(DESKTOP_CORS_ORIGINS, 쉼표 구분). 와일드카드·"null" 출처는 받지 않는다.
// - 인증은 Bearer만이라 Access-Control-Allow-Credentials를 보내지 않는다(쿠키 세션은 같은 출처 W 화면 전용).
// - 응답 상태와 무관하게(401·402·429·500·404·405 포함) 허용 출처면 ACAO를 싣고, 출처와 무관하게 항상 `Vary: Origin`.

export const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
/** 스튜디오 api-client·웹 어댑터가 보내는 헤더(features api-client, voice/transcribe). */
export const CORS_ALLOW_HEADERS = "authorization, content-type, accept, idempotency-key, x-request-id";
/** 클라이언트가 읽는 응답 헤더(api-client parseRetryAfter). */
export const CORS_EXPOSE_HEADERS = "retry-after";
export const CORS_MAX_AGE_SECONDS = "600";

/** 출처 문자열 → 정규화된 origin. 경로·쿼리·와일드카드·http(로컬 외)·형식 오류는 null. */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin === "null" || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "tauri.localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/** env → 허용 출처 집합. 잘못된 항목은 버린다(허용을 넓히지 않는 쪽으로 실패). */
export function allowedOrigins(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  const raw = [env.STUDIO_ORIGIN ?? "", ...(env.DESKTOP_CORS_ORIGINS ?? "").split(",")];
  const out = new Set<string>();
  for (const item of raw) {
    const origin = normalizeOrigin(item);
    if (origin) out.add(origin);
  }
  return out;
}

const isAllowed = (origin: string | null, allowed: ReadonlySet<string>): origin is string =>
  origin !== null && allowed.has(origin);

/** 응답 헤더에 CORS를 싣는다(상태 무관). 허용 출처가 아니면 Vary만. */
export function applyCorsHeaders(headers: Headers, origin: string | null, allowed: ReadonlySet<string>): void {
  headers.append("vary", "Origin");
  if (!isAllowed(origin, allowed)) return;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", CORS_EXPOSE_HEADERS);
  headers.delete("access-control-allow-credentials");
}

/** OPTIONS preflight 응답. 허용 출처면 204 + 허용 목록, 아니면 403(ACAO 없음). 본문 없음. */
export function preflightResponse(origin: string | null, allowed: ReadonlySet<string>): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (!isAllowed(origin, allowed)) {
    headers.set("vary", "Origin");
    return new Response(null, { status: 403, headers });
  }
  applyCorsHeaders(headers, origin, allowed);
  headers.append("vary", "Access-Control-Request-Method");
  headers.append("vary", "Access-Control-Request-Headers");
  headers.set("access-control-allow-methods", CORS_ALLOW_METHODS);
  headers.set("access-control-allow-headers", CORS_ALLOW_HEADERS);
  headers.set("access-control-max-age", CORS_MAX_AGE_SECONDS);
  return new Response(null, { status: 204, headers });
}

/** CORS 대상 경로(API만). 마케팅·계정 화면은 같은 출처라 열지 않는다. */
export function isCorsPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** preflight 여부: OPTIONS + Access-Control-Request-Method. */
export function isPreflight(req: Request): boolean {
  return req.method === "OPTIONS" && req.headers.has("access-control-request-method");
}
