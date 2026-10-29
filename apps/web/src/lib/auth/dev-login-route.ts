// POST /api/dev/login 본체(Stage A, AUTH_ROADMAP.md 2.1·2.4절). 판정이 거짓이면 모든 메서드 404(존재를 숨긴다).
// 순서: 판정 → 메서드 → 출처(CSRF) → 본문(JSON 또는 폼, 2KB) → 페르소나 허용 목록 → signInWithPassword(서버 env 비밀번호) → finishLogin.
// 폼 요청(로그인 화면 Mock 패널, 클라이언트 JS 없음)은 303 이동, JSON 요청(E2E globalSetup)은 { next }.
import type { AuthConfig } from "./config.ts";
import { finishLogin, type FinishLoginDeps } from "./finish-login.ts";
import { AuthHttpError, authError, bodyKind, authOk, hiddenNotFound, isSameOriginRequest, readAuthBody, type AuthErrorCode } from "./http.ts";
import { authLog, errorCodeOf } from "./log.ts";
import { isMockPersonaKey, mockPersonaEmail } from "./personas.ts";

export interface DevLoginDeps {
  /** isMockAuthAllowed()(요청마다 판정). */
  mockAllowed(): boolean;
  config(): AuthConfig;
  seedPassword(): string;
  /** 쿠키 세션 클라이언트로 signInWithPassword. 성공 여부만(오류 원문은 버린다). */
  signIn(email: string, password: string): Promise<boolean>;
  /** 실패 시 쿠키 세션 정리. */
  signOut(): Promise<void>;
  /** 방금 만든 쿠키 세션 기준 finishLogin 의존성. */
  finishDeps(config: AuthConfig): FinishLoginDeps;
}

function redirect(path: string, status = 303): Response {
  // 상대 경로만(safeNextPath·고정 경로). 외부 origin으로 보내지 않는다.
  return new Response(null, { status, headers: { location: path, "cache-control": "no-store" } });
}

function failForm(code: AuthErrorCode): Response {
  return redirect(`/login?error=${code === "login_failed" ? "login" : "request"}`);
}

/** POST 이외 메서드: 판정이 거짓이면 404, 참이면 405. */
export function handleDevLoginOtherMethod(deps: Pick<DevLoginDeps, "mockAllowed">): Response {
  if (!deps.mockAllowed()) return hiddenNotFound();
  return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}

export async function handleDevLogin(req: Request, deps: DevLoginDeps): Promise<Response> {
  if (!deps.mockAllowed()) return hiddenNotFound();
  if (req.method !== "POST") return handleDevLoginOtherMethod(deps);
  if (!isSameOriginRequest(req)) {
    authLog.warn("auth.dev_login", { route: "dev_login", code: "forbidden_origin", status: 403 });
    return authError("forbidden_origin");
  }
  const asForm = bodyKind(req) === "form";
  try {
    const body = await readAuthBody(req, true);
    const persona = body.value.persona;
    const next = typeof body.value.next === "string" ? body.value.next : null;
    const extra = Object.keys(body.value).filter((k) => k !== "persona" && k !== "next");
    if (!isMockPersonaKey(persona) || extra.length > 0) {
      return asForm ? failForm("invalid_input") : authError("invalid_input");
    }
    const config = deps.config();
    // 새 토큰 발급(기존 쿠키 세션을 이어 쓰지 않는다 → 세션 고정 차단).
    const ok = await deps.signIn(mockPersonaEmail(persona), deps.seedPassword());
    if (!ok) {
      authLog.warn("auth.dev_login", { route: "dev_login", code: "login_failed", status: 401, persona });
      return asForm ? failForm("login_failed") : authError("login_failed");
    }
    const result = await finishLogin(deps.finishDeps(config), { provider: "email", next });
    if (result.kind !== "ok") {
      await deps.signOut();
      const code: AuthErrorCode = result.kind === "forbidden" ? result.reason : result.kind;
      authLog.warn("auth.dev_login", { route: "dev_login", code, persona });
      return asForm ? redirect(`/login?error=${code}`) : authError(code);
    }
    authLog.info("auth.dev_login", { route: "dev_login", status: 200, persona, first_login: result.firstLogin });
    return asForm ? redirect(result.next) : authOk({ next: result.next, needs_onboarding: result.needsOnboarding, session: result.session });
  } catch (error) {
    const code: AuthErrorCode = error instanceof AuthHttpError ? error.code : "internal";
    if (code === "internal") authLog.error("auth.dev_login", { route: "dev_login", code: errorCodeOf(error), status: 500 });
    return asForm ? failForm(code) : authError(code);
  }
}
