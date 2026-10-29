"use server";
// 로그인·온보딩 서버 액션(Next가 Origin을 검사한다). 동의 저장은 lib/auth/web-session.ts·consent.ts.
import { redirect } from "next/navigation";
import { allTermsChecked, TERMS_DOCS, unsupportedTermsStore } from "../../../lib/auth/consent.ts";
import { authLog } from "../../../lib/auth/log.ts";
import { getWebSession, setCrossBorderAck, signOutWeb } from "../../../lib/auth/web-session.ts";

export async function signOutAction(): Promise<void> {
  await signOutWeb();
  redirect("/login");
}

/** 1단계 약관: 필수 3종 체크 확인. 저장소가 아직 없어(consent.ts) 기록은 실패로 남고 다음 단계로 간다. */
export async function acceptTermsAction(form: FormData): Promise<void> {
  const session = await getWebSession();
  if (!session) redirect("/login");
  const checked = new Set(TERMS_DOCS.filter((d) => form.get(d) === "on"));
  if (!allTermsChecked(checked)) redirect("/login?step=terms&error=terms_required");
  const saved = await unsupportedTermsStore.record(session.user_id, [...checked]);
  if (!saved) authLog.warn("auth.onboarding", { route: "onboarding", code: "terms_store_unsupported" });
  redirect("/login?step=ai");
}

/** 2단계 AI 국외 이전(선택, owner·admin). 미동의도 진행(오픈소스 경로만). */
export async function crossBorderAction(form: FormData): Promise<void> {
  const session = await getWebSession();
  if (!session) redirect("/login");
  const ack = form.get("ack") === "yes";
  const ok = await setCrossBorderAck(session, ack);
  redirect(ok ? `/login?step=start${ack ? "" : "&ai=declined"}` : "/login?step=ai&error=cross_border");
}
