// POST /api/auth/finish 본체(04_API.md: D(Bearer, 교환 직후 1회)). 쿠키를 쓰지 않으므로 CSRF 대상이 아니고 CORS도 열지 않는다.
// 순서: 설정 → Bearer → 본문(zod strict, org_id 등 추가 필드 거부) → finishLogin → 응답. 토큰·code는 본문에 받지 않는다.
import { z } from "zod";
import { getAuthConfig, LOGIN_PROVIDERS, type AuthConfig, type LoginProvider } from "./config.ts";
import { finishLogin, type FinishLoginDeps } from "./finish-login.ts";
import { AuthHttpError, authError, authOk, readAuthBody } from "./http.ts";
import { authLog, errorCodeOf } from "./log.ts";

export const finishBodySchema = z
  .object({
    provider: z.enum(LOGIN_PROVIDERS as unknown as [LoginProvider, ...LoginProvider[]]),
    first_login_hint: z.boolean().optional(),
  })
  .strict();

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/;

export interface FinishRouteDeps {
  config(): AuthConfig;
  /** 검증 전 토큰으로 finishLogin 의존성을 만든다(사용자 클라이언트). */
  forToken(accessToken: string, config: AuthConfig): FinishLoginDeps;
}

export async function handleAuthFinish(req: Request, deps: FinishRouteDeps): Promise<Response> {
  let config: AuthConfig;
  try {
    config = deps.config();
  } catch {
    authLog.error("auth.finish", { route: "auth_finish", code: "auth_config", status: 500 });
    return authError("internal");
  }
  const token = BEARER.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return authError("unauthorized");
  try {
    const { value } = await readAuthBody(req, false);
    const parsed = finishBodySchema.safeParse(value);
    if (!parsed.success) return authError("invalid_input");
    const result = await finishLogin(deps.forToken(token, config), { provider: parsed.data.provider });
    switch (result.kind) {
      case "ok":
        authLog.info("auth.finish", { route: "auth_finish", status: 200, first_login: result.firstLogin, provider: parsed.data.provider });
        return authOk({ next: result.next, needs_onboarding: result.needsOnboarding, session: result.session });
      case "no_profile":
        authLog.warn("auth.finish", { route: "auth_finish", code: "no_profile", status: 401 });
        return authError("no_profile", { data: { next: "/login" } });
      case "unauthorized":
        return authError("unauthorized");
      case "forbidden":
        authLog.warn("auth.finish", { route: "auth_finish", code: result.reason, status: 403 });
        return authError(result.reason);
    }
  } catch (error) {
    if (error instanceof AuthHttpError) return authError(error.code);
    authLog.error("auth.finish", { route: "auth_finish", code: errorCodeOf(error), status: 500 });
    return authError("internal");
  }
}

export function defaultConfig(): AuthConfig {
  return getAuthConfig();
}
