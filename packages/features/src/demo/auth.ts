// 데모 인증·API(개발 전용). 백엔드 없이 로그인 → finish → 셸까지 가도록 AuthPort와 FetchLike를 흉내 낸다.
// 실제 토큰·시드 계정·비밀번호는 없다(가짜 토큰 문자열만, 아무 이메일·비밀번호나 통과). Mock 로그인(008)과는 별개다.
import type { FetchLike, FetchResponseLike } from "../api-client/index.ts";
import type { AuthPort } from "../shell/types.ts";

export interface DemoAuthOptions {
  /** 처음부터 로그인돼 있는가(`?demo-session=none`이면 false). */
  readonly signedIn: boolean;
  /** finish가 needs_onboarding=true를 주는가(`?demo-onboarding=1`). */
  readonly needsOnboarding: boolean;
  /** 조직 역할(온보딩 AI 단계는 owner·admin만). */
  readonly role?: "owner" | "admin" | "member" | "viewer";
}

const DEMO_TOKEN = "demo-access-token";

export function createDemoAuth(options: DemoAuthOptions): { auth: AuthPort; fetch: FetchLike } {
  let signedIn = options.signedIn;
  const ok = async () => {
    signedIn = true;
    return { ok: true as const };
  };
  const auth: AuthPort = {
    getAccessToken: async () => (signedIn ? DEMO_TOKEN : null),
    signOut: async () => {
      signedIn = false;
    },
    hasSession: async () => signedIn,
    signInWithPassword: async () => ok(),
    signInWithGoogle: async () => ok(),
  };

  const respond = (status: number, body: unknown): FetchResponseLike => ({
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });

  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url, "http://demo.local").pathname;
    if (init.headers.Authorization !== `Bearer ${DEMO_TOKEN}`) return respond(401, { ok: false, error: { code: "unauthenticated", message: "" } });
    if (init.method === "POST" && path === "/api/auth/finish") {
      return respond(200, {
        ok: true,
        data: {
          next: options.needsOnboarding ? "/onboarding" : "/projects",
          needs_onboarding: options.needsOnboarding,
          session: {
            user_id: "00000000-0000-4000-8000-00000000d3e0",
            display_name: "데모 사용자",
            status: "active",
            org: { id: "00000000-0000-4000-8000-00000000d3e1", role: options.role ?? "owner" },
            plan_code: "trial",
            entitled: true,
            credit_balance: 30,
          },
        },
      });
    }
    return respond(404, { ok: false, error: { code: "not_found", message: "데모 모드에 없는 API입니다." } });
  };

  return { auth, fetch };
}
