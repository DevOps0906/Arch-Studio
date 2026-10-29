// 설치형 런타임 조립(AR-06-004b): 070 어댑터 + 005·008 인증 세션 + 007 API 설정 + 017 엔진 호스트 → features AppProviders.
// 플랫폼 판정은 shell-bridge createPlatformAdapters 한 곳(Tauri 웹뷰 밖이면 NOT_SUPPORTED → main.tsx가 안내 화면).
// 로그인 방법(Google·이메일)은 Stage B(AR-06-062)가 채운다: 지금은 null → 화면이 "준비 중"으로 비활성.
import type { AuthPort, EngineHost, ShellRuntime } from "@arch-studio/features/shell";
import { createArchSupabaseClient, createPlatformAdapters } from "@arch-studio/shell-bridge";
import { createDesktopAuthSession, loadDevMockAuth } from "@arch-studio/shell-bridge/auth";

export function createDesktopRuntime(engine: EngineHost | null): ShellRuntime {
  const adapters = createPlatformAdapters();
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  let auth: AuthPort;
  if (url && anonKey) {
    const supabase = createArchSupabaseClient({ url, anonKey, secrets: adapters.secrets });
    const session = createDesktopAuthSession({ bridge: adapters, supabase });
    auth = {
      getAccessToken: () => session.getAccessToken(),
      signOut: () => session.signOut(),
      hasSession: async () => (await session.getAccessToken()) !== null,
      signInWithPassword: null,
      signInWithGoogle: null,
      // 판정 함수만 넘긴다(개발 빌드 + mock 단계 + loopback일 때만 모듈이 열린다, 008).
      loadDevMock: () => loadDevMockAuth({ supabase, supabaseUrl: url }),
    };
  } else {
    // 서버 설정이 없는 빌드: 로그인 불가. 로그아웃은 그래도 키체인을 지운다.
    auth = {
      getAccessToken: async () => null,
      signOut: () => adapters.clearSecrets(),
      hasSession: async () => false,
      signInWithPassword: null,
      signInWithGoogle: null,
    };
  }
  return { adapters, auth, api: { baseUrl: import.meta.env.VITE_API_BASE_URL ?? "" }, engine };
}
