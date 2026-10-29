import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banner } from "@arch-studio/ui";
import { isMockAuthAllowed } from "../../../lib/auth/config.ts";
import { safeNextPath } from "../../../lib/auth/next-path.ts";
import { getTrialEndsAt, getWebSession } from "../../../lib/auth/web-session.ts";
import { MockPanel } from "./MockPanel.tsx";
import { Onboarding, type OnboardingStep } from "./Onboarding.tsx";

// /login(03장 1.2절): A 개발용 패널, B·C 제공자 버튼(062·063·064). 웹 첫 로그인 온보딩은 같은 경로의 ?step=terms|ai|start(03장 1.3절).
export const metadata: Metadata = { title: "로그인 | Arch Studio", robots: { index: false } };
export const dynamic = "force-dynamic";

// 03장 3.1절 오류 표 + 이 작업의 Mock 오류.
const ERROR_TEXT: Record<string, string> = {
  login: "로그인하지 못했습니다. 다시 시도하세요.",
  callback: "로그인을 끝내지 못했습니다. 다시 시도하세요.",
  state: "로그인 요청이 만료되었습니다. 처음부터 다시 시작하세요.",
  provider: "이 앱에서 쓰지 않는 로그인 방법입니다. Google 또는 이메일로 로그인하세요.",
  no_profile: "계정 정보를 만들지 못했습니다. 다시 로그인하세요.",
  suspended: "사용할 수 없는 계정 상태입니다.",
  inactive: "사용할 수 없는 계정 상태입니다.",
  pending: "가입 승인을 기다리는 계정입니다.",
  request: "요청을 처리하지 못했습니다. 다시 시도하세요.",
};

const STEPS = new Set<OnboardingStep>(["terms", "ai", "start"]);

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const step = one(sp.step);
  const error = one(sp.error);
  const session = await getWebSession();

  if (step && STEPS.has(step as OnboardingStep)) {
    if (!session) redirect("/login");
    const trialEndsAt = step === "start" && session.org ? await getTrialEndsAt(session.org.id) : null;
    return (
      <Onboarding step={step as OnboardingStep} session={session} error={error} trialEndsAt={trialEndsAt} aiDeclined={one(sp.ai) === "declined"} />
    );
  }

  const nextRaw = one(sp.next);
  const next = nextRaw ? safeNextPath(nextRaw) : null;
  const mock = isMockAuthAllowed();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-h1 font-semibold">로그인</h1>
      {error ? <Banner tone="danger" title={ERROR_TEXT[error] ?? ERROR_TEXT.request!} /> : null}
      {mock ? (
        <MockPanel session={session} next={next} />
      ) : (
        // Stage B(062) 전까지 실제 제공자 버튼이 없다(AUTH_ROADMAP 2.1: A단계에는 제공자 버튼을 렌더하지 않는다).
        <Banner tone="info" title="로그인 준비 중입니다.">
          Google·이메일 로그인은 공개 베타 전에 열립니다.
        </Banner>
      )}
    </main>
  );
}
