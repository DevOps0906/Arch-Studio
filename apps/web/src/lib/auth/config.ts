// 인증 단계 판정(AUTH_ROADMAP.md 2.4·3.1·3.3절). `AUTH_MODE`를 읽는 곳은 인증 경로(lib/auth, shell-bridge/auth, features/auth)뿐이다.
// 기능 코드는 `if (mock)` 분기를 하지 않는다: AUTH_MODE도, 판정 함수(isMockAuthAllowed)도 읽지 않는다.
// 판정 함수를 쓰는 곳은 로그인 화면((auth)/layout·login/page)·/api/dev/login·lib/auth뿐(eslint `authMode`·`authJudge` 묶음 + boundary.test.ts).
// 순수 모듈(server-only 미사용): env는 인자로 받는다. 기본값은 process.env이고 요청마다 다시 읽는다(캐시 없음).

export type AuthMode = "mock" | "live";
export type LoginProvider = "google" | "kakao" | "naver" | "email";
export const LOGIN_PROVIDERS: readonly LoginProvider[] = ["google", "kakao", "naver", "email"];

export type AuthEnv = Readonly<Record<string, string | undefined>>;

export interface AuthConfig {
  readonly mode: AuthMode;
  /** finishLogin이 허용하는 제공자. mock = email(시드 계정 비밀번호 로그인)만. */
  readonly providers: readonly LoginProvider[];
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** URL 호스트가 loopback인지. 파싱 실패는 거짓(기본 닫힘). */
export function isLoopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return LOOPBACK.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

const DEPLOY_MARKERS = ["VERCEL", "VERCEL_ENV", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"] as const;

/**
 * Mock 로그인 허용 판정(유일한 판정 함수). 모두 참일 때만 참이다(기본 닫힘).
 * 1) AUTH_MODE === 'mock'  2) NEXT_PUBLIC_SUPABASE_URL(필수)·SUPABASE_URL(있으면)이 loopback
 * 3) APP_URL이 있으면 loopback  4) 배포 플랫폼 표지(VERCEL·VERCEL_ENV·RAILWAY_*) 없음  5) DEV_SEED_PASSWORD 있음
 * 7) NODE_ENV !== 'production' — 프로덕션 빌드(`next start`, 자체 호스팅 포함)는 loopback·비배포여도 Mock을 열지 않는다(보안 리뷰).
 * 6) `process.env.NEXT_PUBLIC_SUPABASE_URL`을 글자 그대로 읽은 값(`builtSupabaseUrl`)도 loopback — 번들러가 이 표현을 빌드 값으로
 *    치환하는 번들(클라이언트 등)에서 실행 env와 빌드 값이 갈라지는 경우를 막는 이중 확인. 값이 없으면(undefined) 건너뛴다.
 *    확인(2026-10-29, Next 16 서버 번들): 서버에서는 치환되지 않고 실행 env를 읽는다 → 1)과 같은 값.
 */
export function isMockAuthAllowed(
  env: AuthEnv = process.env,
  builtSupabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  if (env.AUTH_MODE?.trim() !== "mock") return false;
  if (builtSupabaseUrl !== undefined && !isLoopbackUrl(builtSupabaseUrl)) return false;
  if (!isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL)) return false;
  if (env.SUPABASE_URL !== undefined && env.SUPABASE_URL !== "" && !isLoopbackUrl(env.SUPABASE_URL)) return false;
  if (env.APP_URL !== undefined && env.APP_URL !== "" && !isLoopbackUrl(env.APP_URL)) return false;
  if (DEPLOY_MARKERS.some((name) => (env[name] ?? "").trim() !== "")) return false;
  if (!env.DEV_SEED_PASSWORD) return false;
  if (env.NODE_ENV?.trim() === "production") return false;
  return true;
}

export class AuthConfigError extends Error {
  readonly code = "auth_config";
  constructor(reason: string) {
    super(`인증 설정 오류: ${reason}`);
    this.name = "AuthConfigError";
  }
}

function parseProviders(raw: string | undefined): LoginProvider[] {
  const items = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = items.filter((p) => !(LOGIN_PROVIDERS as readonly string[]).includes(p));
  if (unknown.length > 0) throw new AuthConfigError("AUTH_PROVIDERS에 알 수 없는 제공자");
  return [...new Set(items as LoginProvider[])];
}

/**
 * 현재 단계 설정. AUTH_MODE 미설정 = live. 잘못된 조합은 throw(조용히 live로 바꾸지 않는다):
 * - mock인데 isMockAuthAllowed 거짓(원격·배포) → throw
 * - live인데 제공자 0개 → throw
 */
export function getAuthConfig(env: AuthEnv = process.env): AuthConfig {
  const raw = env.AUTH_MODE?.trim() || "live";
  if (raw !== "mock" && raw !== "live") throw new AuthConfigError("AUTH_MODE는 mock 또는 live");
  if (raw === "mock") {
    if (!isMockAuthAllowed(env)) throw new AuthConfigError("mock 모드는 로컬 Supabase·비배포 환경에서만");
    return { mode: "mock", providers: ["email"] };
  }
  const providers = parseProviders(env.AUTH_PROVIDERS);
  if (providers.length === 0) throw new AuthConfigError("live 모드에는 AUTH_PROVIDERS가 1개 이상 필요");
  return { mode: "live", providers };
}

/**
 * 빌드 가드(AUTH_ROADMAP 2.4·B-4): `AUTH_MODE=mock`인데 배포 플랫폼 표지(VERCEL·VERCEL_ENV·RAILWAY_*)가 있으면 throw → 빌드 실패.
 * next.config.ts가 빌드 시작 때 부른다(next.config는 AUTH_MODE를 직접 읽지 않는다 = 경계 규칙 유지).
 * 런타임 판정(isMockAuthAllowed)과 별개의 앞단 방어: 배포 빌드에 mock 설정이 섞이면 산출물 자체를 만들지 않는다.
 */
export function assertBuildAuthMode(env: AuthEnv = process.env): void {
  if (env.AUTH_MODE?.trim() !== "mock") return;
  const marker = DEPLOY_MARKERS.find((name) => (env[name] ?? "").trim() !== "");
  if (marker) throw new AuthConfigError(`AUTH_MODE=mock은 배포 빌드(${marker})에서 쓸 수 없다`);
}

/** 기동 시 한 번 부르는 검사(instrumentation 연결은 요청 줄, tasks/logs/AR-06-008.md). */
export function assertAuthConfigOnBoot(env: AuthEnv = process.env): void {
  getAuthConfig(env);
}
