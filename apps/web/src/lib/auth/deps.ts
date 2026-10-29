// 인증 Route Handler 실제 배선(서버 전용). 사용자 JWT·쿠키 클라이언트만 쓴다(service_role 없음: session_context·
// bootstrap_app_for_org·write_audit·set_ai_cross_border_ack 모두 authenticated EXECUTE + 함수 안 역할 검사).
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../env/public.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { getAuthConfig, isMockAuthAllowed, type AuthConfig } from "./config.ts";
import { unsupportedTermsStore } from "./consent.ts";
import type { DevLoginDeps } from "./dev-login-route.ts";
import { ARCH_APP_ID, type FinishLoginDeps } from "./finish-login.ts";
import type { FinishRouteDeps } from "./finish-route.ts";
import { coreSchema } from "./schema.ts";
import { signOutWeb } from "./web-session.ts";

export const WEB_ONBOARDING_PATH = "/login?step=terms";
export const DESKTOP_ONBOARDING_PATH = "/onboarding";


class RpcError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    super("rpc error");
    this.code = typeof code === "string" ? code : "unknown";
  }
}

function finishDepsFor(
  client: () => Promise<SupabaseClient>,
  config: AuthConfig,
  getUser: (c: SupabaseClient) => ReturnType<SupabaseClient["auth"]["getUser"]>,
  onboardingPath: string,
): FinishLoginDeps {
  const core = async () => (await client()).schema(coreSchema());
  return {
    config,
    async getUser() {
      const { data, error } = await getUser(await client());
      if (error || !data.user) return null;
      const provider = data.user.app_metadata?.provider;
      return { id: data.user.id, provider: typeof provider === "string" ? provider : null };
    },
    async sessionContext() {
      const { data, error } = await (await core()).rpc("session_context", { p_app: ARCH_APP_ID });
      if (error) throw new RpcError(error.code);
      return data;
    },
    async bootstrapApp() {
      const { error } = await (await core()).rpc("bootstrap_app_for_org", { p_app_id: ARCH_APP_ID });
      if (error) throw new RpcError(error.code);
    },
    async audit(orgId, userId, meta) {
      const { error } = await (await core()).rpc("write_audit", {
        p_org_id: orgId,
        p_action: "auth.login",
        p_target_type: "user",
        p_target_id: userId,
        p_metadata: meta,
      });
      if (error) throw new RpcError(error.code);
    },
    terms: unsupportedTermsStore,
    onboardingPath,
  };
}

/** 사용자 JWT 클라이언트(세션 저장 없음). 토큰은 이 객체 안에만 있고 로그·응답에 나가지 않는다. */
function bearerClient(token: string): SupabaseClient {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function finishRouteDeps(): FinishRouteDeps {
  return {
    config: () => getAuthConfig(),
    forToken(token, config) {
      const client = bearerClient(token);
      return finishDepsFor(async () => client, config, (c) => c.auth.getUser(token), DESKTOP_ONBOARDING_PATH);
    },
  };
}

export function devLoginDeps(): DevLoginDeps {
  let cookieClient: Promise<SupabaseClient> | undefined;
  const client = () => (cookieClient ??= createSupabaseServerClient() as unknown as Promise<SupabaseClient>);
  // signIn이 방금 발급한 access token(요청 처리 동안 메모리에만). finishLogin은 이 토큰의 Bearer 클라이언트로 돈다.
  let issued: string | null = null;
  return {
    mockAllowed: () => isMockAuthAllowed(),
    config: () => getAuthConfig(),
    seedPassword: () => process.env.DEV_SEED_PASSWORD ?? "",
    async signIn(email, password) {
      const c = await client();
      // 쿠키 클라이언트로 로그인 → @supabase/ssr이 새 세션 쿠키를 응답에 쓴다(기존 쿠키 덮어씀).
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      issued = !error && data.session ? data.session.access_token : null;
      return issued !== null;
    },
    async signOut() {
      issued = null;
      await signOutWeb();
    },
    finishDeps(config) {
      const token = issued ?? "";
      const bearer = bearerClient(token);
      // getUser(token)은 Auth 서버에서 토큰을 다시 검증한다.
      return finishDepsFor(async () => bearer, config, (c) => c.auth.getUser(token), WEB_ONBOARDING_PATH);
    },
  };
}
