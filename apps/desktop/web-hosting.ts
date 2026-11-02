// 웹 스튜디오 정적 호스트 설정(AR-06-071 결정 7). 순수 모듈: vite.config.ts(웹 빌드)와 테스트·검사 스크립트가 쓴다.
// - CSP는 빌드 env(VITE_API_BASE_URL·VITE_SUPABASE_URL) 출처로 만든다. 스크립트는 'self' + 'wasm-unsafe-eval'만('unsafe-eval'·'unsafe-inline' 금지).
// - 호스트는 Vercel. 헤더가 빌드 env에 따라 달라 vercel.json(빌드 전에 읽힘)이 아니라 Build Output API v3 config.json으로 낸다.
//   모든 경로(정적 파일·워커 스크립트·SPA 폴백 index.html)에 같은 보안 헤더, .wasm은 application/wasm.
// - COOP는 보내지 않는다: 웹 OAuth가 팝업 → opener postMessage라(결정 6) same-origin COOP면 opener가 끊긴다.
//   COEP도 없음: SharedArrayBuffer를 쓰지 않는다(엔진·도면 워커는 메시지 복사, manifold-3d 단일 스레드).

/** Vite 웹 빌드 mode 이름. 설치형은 production(기본). */
export const WEB_BUILD_MODE = "web";
/** 웹 빌드 산출물(설치형 dist/와 분리. 저장소 스캔들이 건너뛰는 build/ 아래). */
export const WEB_OUT_DIR = "build/web";
/** 호스트 설정 산출물(Build Output API config.json과 같은 내용). */
export const WEB_HOSTING_CONFIG = "build/web-hosting.json";

export interface WebBuildEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
}

/** 원격 출처: https만, 개발용 localhost·127.0.0.1만 http. 경로·쿼리는 버리고 origin만. */
export function remoteOrigin(name: string, raw: string | undefined): string {
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new Error(`웹 빌드에는 ${name}(https 출처)가 필요하다.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`${name}는 https 출처여야 한다(개발용 localhost만 http).`);
  }
  return url.origin;
}

/** CSP 지시문(순서 고정 → 같은 env면 같은 문자열). */
export function webCspDirectives(env: WebBuildEnv): ReadonlyArray<readonly [string, string]> {
  const api = remoteOrigin("VITE_API_BASE_URL", env.VITE_API_BASE_URL);
  const supabase = remoteOrigin("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL);
  const uniq = (...xs: string[]) => [...new Set(xs)].join(" ");
  return [
    ["default-src", "'self'"],
    ["script-src", "'self' 'wasm-unsafe-eval'"],
    ["worker-src", "'self'"],
    ["style-src", "'self'"],
    ["img-src", uniq("'self'", "data:", "blob:", api, supabase)],
    ["font-src", "'self'"],
    // Realtime(wss)은 쓰지 않는다. 서명 URL 업·다운로드는 Supabase Storage 출처.
    ["connect-src", uniq("'self'", api, supabase)],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
}

export function webCsp(env: WebBuildEnv): string {
  return webCspDirectives(env)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

/** CSP 문자열 → 지시문별 소스 목록. */
export function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name.toLowerCase(), values);
  }
  return out;
}

/** 정책 검사: 스크립트 unsafe-eval·unsafe-inline 없음, 필수 지시문, connect-src ⊇ env 출처. 위반 목록(빈 배열 = 통과). */
export function cspViolations(csp: string, env: WebBuildEnv): string[] {
  const d = parseCsp(csp);
  const bad: string[] = [];
  for (const name of ["script-src", "default-src", "worker-src"]) {
    const v = d.get(name) ?? [];
    if (v.includes("'unsafe-eval'")) bad.push(`${name}에 'unsafe-eval'`);
    if (v.includes("'unsafe-inline'")) bad.push(`${name}에 'unsafe-inline'`);
    if (v.some((s) => s === "*" || s === "data:" || s === "blob:" || /^https?:$/.test(s))) bad.push(`${name}가 넓다`);
  }
  if ((d.get("style-src") ?? []).includes("'unsafe-inline'")) bad.push("style-src에 'unsafe-inline'");
  const expect: Record<string, string> = { "object-src": "'none'", "base-uri": "'self'", "frame-ancestors": "'none'" };
  for (const [k, v] of Object.entries(expect)) if ((d.get(k) ?? []).join(" ") !== v) bad.push(`${k} ${v} 아님`);
  if (!(d.get("script-src") ?? []).includes("'wasm-unsafe-eval'")) bad.push("script-src에 'wasm-unsafe-eval' 없음(엔진 WASM)");
  const connect = d.get("connect-src") ?? [];
  for (const [name, raw] of [
    ["VITE_API_BASE_URL", env.VITE_API_BASE_URL],
    ["VITE_SUPABASE_URL", env.VITE_SUPABASE_URL],
  ] as const) {
    let origin: string;
    try {
      origin = remoteOrigin(name, raw);
    } catch (e) {
      bad.push((e as Error).message);
      continue;
    }
    if (!connect.includes(origin)) bad.push(`connect-src에 ${name} 출처(${origin}) 없음`);
  }
  return bad;
}

/** 모든 응답 공통 보안 헤더(CSP 포함). */
export function webSecurityHeaders(env: WebBuildEnv): Record<string, string> {
  return {
    "Content-Security-Policy": webCsp(env),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    // 받아쓰기(voice)만 마이크를 쓴다.
    "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  };
}

/**
 * Vercel Build Output API v3 config.json. 순서: 헤더(continue) → 파일 시스템 → SPA 폴백(/assets/ 아래 없는 파일은 404).
 * 헤더 라우트가 폴백보다 먼저라 폴백 index.html에도 같은 헤더가 붙는다.
 */
export function vercelOutputConfig(env: WebBuildEnv): { version: 3; routes: Record<string, unknown>[] } {
  return {
    version: 3,
    routes: [
      { src: "^/(.*)$", headers: webSecurityHeaders(env), continue: true },
      { src: "^/assets/(.+)\\.wasm$", headers: { "Content-Type": "application/wasm" }, continue: true },
      { src: "^/assets/(.*)$", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
      { src: "^/index\\.html$", headers: { "Cache-Control": "no-store" }, continue: true },
      { handle: "filesystem" },
      { src: "^/(?!assets/).*$", dest: "/index.html", headers: { "Cache-Control": "no-store" } },
    ],
  };
}
