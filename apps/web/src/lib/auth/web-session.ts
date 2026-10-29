// 웹 쿠키 세션 읽기·온보딩 동의 처리(서버 전용). 로그인 화면·온보딩 단계·서버 액션이 쓴다.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "../../server/env.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";
import { canSetCrossBorder } from "./consent.ts";
import { archSchema, coreSchema } from "./schema.ts";
import { ARCH_APP_ID } from "./finish-login.ts";
import { authLog, errorCodeOf } from "./log.ts";
import { parseSessionContext, toClientSession, type ClientSession } from "./session.ts";

async function client(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/** 현재 쿠키 세션의 session_context('arch'). 없거나 해석 불가면 null. getUser()로 토큰을 서버 검증한 뒤에만 조회한다. */
export async function getWebSession(): Promise<ClientSession | null> {
  try {
    const c = await client();
    const { data, error } = await c.auth.getUser();
    if (error || !data.user) return null;
    const res = await c.schema(coreSchema()).rpc("session_context", { p_app: ARCH_APP_ID });
    if (res.error) return null;
    const ctx = parseSessionContext(res.data);
    return ctx && ctx.user_id === data.user.id ? toClientSession(ctx) : null;
  } catch {
    return null;
  }
}

/** 체험 종료일(org_features.trial_ends_at). 실패하면 null. */
export async function getTrialEndsAt(orgId: string): Promise<string | null> {
  try {
    const c = await client();
    const { data, error } = await c.schema(archSchema()).rpc("org_features", { p_org: orgId });
    if (error || !data || typeof data !== "object") return null;
    const v = (data as { trial_ends_at?: unknown }).trial_ends_at;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** 국외 이전 동의 저장(core.set_ai_cross_border_ack, owner·admin). 성공 여부만. */
export async function setCrossBorderAck(session: ClientSession, ack: boolean): Promise<boolean> {
  if (!session.org || !canSetCrossBorder(session.org.role)) return false;
  try {
    const c = await client();
    const { error } = await c.schema(coreSchema()).rpc("set_ai_cross_border_ack", {
      p_org_id: session.org.id,
      p_ack: ack,
      p_notice_version: ack ? serverEnv().AI_CROSS_BORDER_NOTICE_VERSION : null,
    });
    if (error) {
      authLog.warn("auth.onboarding", { route: "onboarding", code: errorCodeOf(error) });
      return false;
    }
    return true;
  } catch (error) {
    authLog.warn("auth.onboarding", { route: "onboarding", code: errorCodeOf(error) });
    return false;
  }
}

/** 웹 로그아웃: 쿠키 세션 삭제(서버 signOut 실패와 무관하게 로컬 쿠키는 지운다). */
export async function signOutWeb(): Promise<void> {
  const c = await client();
  await c.auth.signOut({ scope: "local" }).catch(() => undefined);
  // supabase-js는 네트워크 오류 등에서 세션 삭제를 건너뛸 수 있다 → Supabase 세션 쿠키(sb-*)를 직접 지운다.
  const store = await cookies();
  for (const { name } of store.getAll()) if (name.startsWith("sb-")) store.delete(name);
}
