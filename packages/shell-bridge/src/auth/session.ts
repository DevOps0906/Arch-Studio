// 데스크톱 세션 경계(02_ARCHITECTURE.md 9.2절): 토큰 읽기(api-client의 getAccessToken 주입용)와 로그아웃.
// 로그아웃은 supabase signOut 성공 여부와 무관하게 bridge.clearSecrets()를 항상 부른다(005 메모, 계획 공격 A9).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NativeBridge } from "../bridge.ts";

export interface DesktopAuthSession {
  /** 현재 access token. 세션 없음·읽기 실패면 null(api-client가 unauthenticated로 처리). */
  getAccessToken(): Promise<string | null>;
  /** 로그아웃: 서버 세션 종료 시도 → 결과와 무관하게 키체인 허용 키 전부 삭제. */
  signOut(): Promise<void>;
}

export function createDesktopAuthSession(options: { bridge: NativeBridge; supabase: SupabaseClient }): DesktopAuthSession {
  const { bridge, supabase } = options;
  return {
    async getAccessToken() {
      try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    },
    async signOut() {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // 네트워크 실패 등: 아래에서 로컬 비밀은 반드시 지운다.
      } finally {
        await bridge.clearSecrets();
      }
    },
  };
}
