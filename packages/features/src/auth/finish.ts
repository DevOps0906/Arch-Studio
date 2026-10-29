// features/auth: 로그인 직후 `POST /api/auth/finish` 호출(02_ARCHITECTURE.md 9.2절 5단계). 토큰은 api-client의 주입된
// getAccessToken(shell-bridge createDesktopAuthSession)만 쓰고 본문에는 제공자만 보낸다(토큰·code·org_id 없음).
import type { ApiClient } from "../api-client/index.ts";

export type FinishProvider = "google" | "email" | "kakao" | "naver";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface FinishSession {
  readonly user_id: string;
  readonly display_name: string | null;
  readonly status: string;
  readonly org: { readonly id: string; readonly role: OrgRole } | null;
  readonly plan_code: string | null;
  readonly entitled: boolean;
  readonly credit_balance: number;
}

export interface FinishResult {
  readonly next: string;
  readonly needsOnboarding: boolean;
  readonly session: FinishSession;
}

const ROLES = new Set(["owner", "admin", "member", "viewer"]);

/** 응답 data 검증(api-client parse 훅). 모양이 틀리면 throw → invalid_response. */
export function parseFinishData(data: unknown): FinishResult {
  const d = data as { next?: unknown; needs_onboarding?: unknown; session?: Record<string, unknown> } | null;
  const s = d?.session;
  if (!d || typeof d.next !== "string" || !d.next.startsWith("/") || d.next.startsWith("//") || typeof d.needs_onboarding !== "boolean" || !s) {
    throw new Error("invalid");
  }
  const org = s.org as { id?: unknown; role?: unknown } | null;
  if (typeof s.user_id !== "string" || typeof s.entitled !== "boolean" || typeof s.status !== "string") throw new Error("invalid");
  if (typeof s.credit_balance !== "number" || !Number.isSafeInteger(s.credit_balance)) throw new Error("invalid");
  if (org !== null && (typeof org?.id !== "string" || typeof org.role !== "string" || !ROLES.has(org.role))) throw new Error("invalid");
  return {
    next: d.next,
    needsOnboarding: d.needs_onboarding,
    session: {
      user_id: s.user_id,
      display_name: typeof s.display_name === "string" ? s.display_name : null,
      status: s.status,
      org: org ? { id: org.id as string, role: org.role as OrgRole } : null,
      plan_code: typeof s.plan_code === "string" ? s.plan_code : null,
      entitled: s.entitled,
      credit_balance: s.credit_balance,
    },
  };
}

/**
 * finishLogin 호출. 같은 로그인 시도 안의 재전송은 같은 멱등 키를 쓴다(서버 쪽 bootstrap은 DB 멱등이라 재전송해도 크레딧 1회).
 * 오류는 api-client의 ApiError(code: unauthenticated·provider·no_profile 등)로 올라온다.
 */
export async function requestFinishLogin(api: ApiClient, provider: FinishProvider, idempotencyKey: string): Promise<FinishResult> {
  return api.request({ method: "POST", path: "/api/auth/finish", body: { provider }, idempotencyKey, parse: parseFinishData });
}
