// 데스크톱 개발 빌드 전용 Mock 로그인(Stage A, 02_ARCHITECTURE.md 9.1절 "개발 빌드만: 로컬 시드 계정 signInWithPassword").
// 이 파일은 mode.ts의 loadDevMockAuth()가 개발 빌드에서만 동적 import한다 → 릴리스 번들에 없다(위험 #14).
// 비밀번호는 번들·저장소에 넣지 않는다: 개발자가 화면에서 입력하고, 세션 토큰만 SecureStore(키체인)에 저장된다.
// 페르소나 목록은 scripts/dev/personas.arch.json과 같다(auth.test.ts가 검사).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DevMockOptions } from "./mode.ts";

export const DEV_PERSONAS = [
  { key: "owner", label: "소유자(체험 중)" },
  { key: "admin", label: "관리자(owner 조직)" },
  { key: "member", label: "구성원(owner 조직)" },
  { key: "viewer", label: "열람자(owner 조직)" },
  { key: "outsider", label: "다른 조직 사용자" },
  { key: "no_app", label: "앱 메타데이터 없이 가입" },
  { key: "suspended", label: "정지된 계정" },
  { key: "ops", label: "운영자" },
  { key: "trial_expired", label: "체험 만료(라이선스 없음)" },
  { key: "perpetual", label: "영구 + 업데이트 유효" },
  { key: "perpetual_fallback", label: "영구 + 업데이트 만료(폴백)" },
  { key: "sub_active", label: "월 구독 활성" },
  { key: "sub_expired", label: "월 구독 만료(라이선스 없음)" },
] as const;

export type DevPersonaKey = (typeof DEV_PERSONAS)[number]["key"];

export type DevSignInResult = { ok: true; userId: string } | { ok: false; code: "not_local" | "invalid_persona" | "no_password" | "login_failed" };

export interface DevMockAuth {
  readonly personas: typeof DEV_PERSONAS;
  /** 시드 계정으로 실제 로그인. 실패 사유는 코드만(Auth 오류 원문·이메일 미포함). */
  signInPersona(key: string, password: string): Promise<DevSignInResult>;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const KEYS: ReadonlySet<string> = new Set(DEV_PERSONAS.map((p) => p.key));

export function createDevMockAuth(options: DevMockOptions): DevMockAuth {
  const supabase: SupabaseClient = options.supabase;
  return {
    personas: DEV_PERSONAS,
    async signInPersona(key, password) {
      if (!isLoopback(options.supabaseUrl)) return { ok: false, code: "not_local" };
      if (!KEYS.has(key)) return { ok: false, code: "invalid_persona" };
      if (typeof password !== "string" || password.length === 0) return { ok: false, code: "no_password" };
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: `${key}@dev.test`, password });
        if (error || !data.session || !data.user) return { ok: false, code: "login_failed" };
        return { ok: true, userId: data.user.id };
      } catch {
        return { ok: false, code: "login_failed" };
      }
    },
  };
}
