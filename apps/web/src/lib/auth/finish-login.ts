// finishLogin: 로그인 직후 공통 처리(AUTH_ROADMAP.md 3.2절 2~6번, 04_API.md `POST /api/auth/finish`).
// Mock(`/api/dev/login`)·데스크톱(`/api/auth/finish`)·Stage B 콜백(062)이 모두 이 함수를 거친다.
// 의존성 주입(테스트는 목). 상태를 바꾸는 호출은 bootstrap_app_for_org(DB 멱등) 1회와 감사 1행뿐이다.
import type { AuthConfig, LoginProvider } from "./config.ts";
import type { TermsConsentStore } from "./consent.ts";
import { authLog, errorCodeOf } from "./log.ts";
import { DEFAULT_NEXT, safeNextPath } from "./next-path.ts";
import { parseSessionContext, toClientSession, type ClientSession, type SessionContext } from "./session.ts";

export const ARCH_APP_ID = "arch";

/** 토큰을 서버에서 검증한 사용자(getUser 결과). provider는 app_metadata.provider. */
export interface VerifiedUser {
  readonly id: string;
  readonly provider: string | null;
}

export interface FinishLoginDeps {
  readonly config: AuthConfig;
  /** 서버 검증 사용자. 토큰 없음·무효면 null. */
  getUser(): Promise<VerifiedUser | null>;
  /** rpc session_context({ p_app: 'arch' }) — 개인 조직 기준(p_org 없음). */
  sessionContext(): Promise<unknown>;
  /** rpc bootstrap_app_for_org({ p_app_id: 'arch' }) — org는 DB가 personal_org_id로 정한다. */
  bootstrapApp(): Promise<void>;
  /** rpc write_audit(org, 'auth.login', 'user', uid, null, null, { provider, first_login }). */
  audit(orgId: string, userId: string, meta: { provider: LoginProvider; first_login: boolean }): Promise<void>;
  readonly terms: TermsConsentStore;
  /** 온보딩 경로: 웹 `/login?step=terms`(03장 1.3절), 데스크톱 `/onboarding`. */
  readonly onboardingPath: string;
}

export interface FinishLoginInput {
  readonly provider: LoginProvider;
  readonly next?: string | null;
}

export type FinishLoginResult =
  | { kind: "ok"; next: string; session: ClientSession; firstLogin: boolean; needsOnboarding: boolean }
  | { kind: "unauthorized" }
  | { kind: "no_profile" }
  | { kind: "forbidden"; reason: "provider" | "pending" | "suspended" | "inactive" };

async function readContext(deps: FinishLoginDeps): Promise<SessionContext | null> {
  return parseSessionContext(await deps.sessionContext());
}

/** 계정 상태 분기. active가 아니면 거부 사유. bootstrap 전·후 두 번 적용한다(approval 정책 앱은 bootstrap이 pending으로 바꾼다). */
function statusRejection(ctx: SessionContext): FinishLoginResult | null {
  if (ctx.status === "pending") return { kind: "forbidden", reason: "pending" };
  if (ctx.status === "suspended") return { kind: "forbidden", reason: "suspended" };
  if (ctx.status !== "active") return { kind: "forbidden", reason: "inactive" };
  return null;
}

export async function finishLogin(deps: FinishLoginDeps, input: FinishLoginInput): Promise<FinishLoginResult> {
  const user = await deps.getUser();
  if (!user) return { kind: "unauthorized" };

  // 1) 제공자: 단계가 허용하고, 본문 주장과 토큰 사용자의 실제 제공자가 같아야 한다.
  if (!deps.config.providers.includes(input.provider) || user.provider !== input.provider) {
    return { kind: "forbidden", reason: "provider" };
  }

  // 2) session_context 1회
  let ctx = await readContext(deps);
  if (!ctx) return { kind: "no_profile" };
  if (ctx.user_id !== user.id) return { kind: "unauthorized" };

  // 4) 상태(3번보다 먼저: 정지 계정에 부트스트랩하지 않는다)
  const rejected = statusRejection(ctx);
  if (rejected) return rejected;

  // 3) open 앱: entitled=false이고 개인 조직 owner면 bootstrap 1회 후 다시 조회(DB 멱등: signup:<org>:arch).
  let firstLogin = false;
  if (!ctx.entitled && ctx.org?.role === "owner") {
    await deps.bootstrapApp();
    const again = await readContext(deps);
    if (!again || again.user_id !== user.id) return { kind: "no_profile" };
    // bootstrap이 상태를 바꿀 수 있다(approval 정책 앱 → pending). 다시 읽은 값으로 상태 분기를 한 번 더 한다.
    const rejectedAgain = statusRejection(again);
    if (rejectedAgain) return rejectedAgain;
    firstLogin = again.entitled;
    ctx = again;
  }

  // 6) 감사(실패해도 로그인은 진행, 코드만 로그)
  if (ctx.org) {
    try {
      await deps.audit(ctx.org.id, ctx.user_id, { provider: input.provider, first_login: firstLogin });
    } catch (error) {
      authLog.warn("auth.audit_failed", { route: "auth_finish", code: errorCodeOf(error) });
    }
  }

  // 5) 이동 경로: 약관 동의 전이면 온보딩, 아니면 검사한 next
  const accepted = await deps.terms.hasAcceptedCurrent(ctx.user_id);
  const next = accepted ? safeNextPath(input.next, DEFAULT_NEXT) : deps.onboardingPath;
  return { kind: "ok", next, session: toClientSession(ctx), firstLogin, needsOnboarding: !accepted };
}
