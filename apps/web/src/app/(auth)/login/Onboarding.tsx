import Link from "next/link";
import { Banner, Button, Checkbox } from "@arch-studio/ui";
import { canSetCrossBorder } from "../../../lib/auth/consent.ts";
import type { ClientSession } from "../../../lib/auth/session.ts";
import { acceptTermsAction, crossBorderAction } from "./actions.ts";

// 웹 첫 로그인 온보딩(`/login?step=…`, 03장 1.3절·3.2절). 데스크톱 `/onboarding`과 단계·문구가 같다(시리얼 입력은 설치형 전용).
export type OnboardingStep = "terms" | "ai" | "start";

const STEPS: readonly { id: OnboardingStep; label: string }[] = [
  { id: "terms", label: "약관" },
  { id: "ai", label: "AI 국외 이전" },
  { id: "start", label: "시작" },
];

function StepNav({ current }: { current: OnboardingStep }) {
  return (
    <ol aria-label="온보딩 단계" className="flex flex-wrap gap-2 text-caption">
      {STEPS.map((s, i) => (
        <li
          key={s.id}
          aria-current={s.id === current ? "step" : undefined}
          className={s.id === current ? "rounded-control bg-accent px-2 py-1 text-accent-fg" : "rounded-control border border-line px-2 py-1 text-fg-2"}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

function TermsStep({ error }: { error: string | null }) {
  return (
    <form action={acceptTermsAction} className="flex flex-col gap-4">
      <p className="text-body text-fg-2">계속하려면 아래 약관에 모두 동의해야 합니다. 문서 버전: 초안(법무 검토 전).</p>
      {error === "terms_required" ? (
        <Banner tone="danger" title="필수 약관에 모두 동의해야 다음으로 갈 수 있습니다." />
      ) : null}
      <Checkbox name="terms" required label={<span>이용약관 동의(필수) · <Link className="underline" href="/legal/terms">보기</Link></span>} />
      <Checkbox
        name="license_terms"
        required
        label={<span>라이선스 약관 동의(필수: 영구 사용권, PC 수, 리버스 엔지니어링 금지, 서비스 종료 시 마지막 빌드 배포)</span>}
      />
      <Checkbox name="privacy" required label={<span>개인정보 처리 동의(필수) · <Link className="underline" href="/legal/privacy">보기</Link></span>} />
      <div>
        <Button type="submit" variant="primary">
          다음
        </Button>
      </div>
    </form>
  );
}

function AiStep({ session, error }: { session: ClientSession; error: string | null }) {
  const canSet = canSetCrossBorder(session.org?.role);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-body">
        <p>
          AI 기능의 일부 입력은 국외(상용 AI 제공자)로 전송될 수 있습니다: 렌더 입력 이미지, 법규 질의, 제안서 서술 입력, 대화형 입력 문장.
        </p>
        <p className="text-fg-2">보내지 않는 것: 도면·3D 원본, 건축주 연락처, 상담 녹음.</p>
      </div>
      {error === "cross_border" ? <Banner tone="danger" title="동의 상태를 저장하지 못했습니다. 다시 시도하세요." /> : null}
      {canSet ? (
        <form action={crossBorderAction} className="flex flex-wrap gap-2">
          <Button type="submit" name="ack" value="yes" variant="primary">
            동의(선택)
          </Button>
          <Button type="submit" name="ack" value="no">
            동의하지 않음
          </Button>
        </form>
      ) : (
        <>
          <Banner tone="info" title="국외 이전 동의는 조직 관리자(owner·admin)가 설정합니다." />
          <div>
            <Link href="/login?step=start" className="focus-ring rounded-control text-body underline">
              다음
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StartStep({ session, trialEndsAt, aiDeclined }: { session: ClientSession; trialEndsAt: string | null; aiDeclined: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {aiDeclined ? <Banner tone="info" title="동의 전에는 오픈소스 경로만 씁니다." /> : null}
      <dl className="grid grid-cols-1 gap-2 text-body md:grid-cols-2">
        <div className="rounded-control border border-line p-pad">
          <dt className="text-caption text-fg-2">플랜</dt>
          <dd className="font-semibold">{session.plan_code ?? "권한 없음"}</dd>
        </div>
        <div className="rounded-control border border-line p-pad">
          <dt className="text-caption text-fg-2">크레딧 잔액</dt>
          <dd className="font-semibold">{session.credit_balance}</dd>
        </div>
        <div className="rounded-control border border-line p-pad md:col-span-2">
          <dt className="text-caption text-fg-2">체험 종료</dt>
          <dd className="font-semibold">{trialEndsAt ? trialEndsAt.slice(0, 10) : "해당 없음"}</dd>
        </div>
      </dl>
      <p className="text-body text-fg-2">시리얼 입력은 설치형 앱에서 합니다(기기 활성화).</p>
      <div>
        {/* 웹 스튜디오(app.) 진입은 071·072가 만든다. 그 전까지는 첫 화면으로. */}
        <Link href="/" className="focus-ring inline-flex h-control items-center rounded-control bg-accent px-4 text-body text-accent-fg">
          14일 체험 시작
        </Link>
      </div>
    </div>
  );
}

export function Onboarding(props: {
  step: OnboardingStep;
  session: ClientSession;
  error: string | null;
  trialEndsAt: string | null;
  aiDeclined: boolean;
}) {
  return (
    <section aria-labelledby="onb-title" className="flex flex-col gap-6">
      <h1 id="onb-title" className="text-h1 font-semibold">
        시작하기
      </h1>
      <StepNav current={props.step} />
      {props.step === "terms" ? <TermsStep error={props.error} /> : null}
      {props.step === "ai" ? <AiStep session={props.session} error={props.error} /> : null}
      {props.step === "start" ? <StartStep session={props.session} trialEndsAt={props.trialEndsAt} aiDeclined={props.aiDeclined} /> : null}
    </section>
  );
}
