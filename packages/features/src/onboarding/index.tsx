// `/onboarding`(03장 3.2절 I 3단계, 2.1절 5~7단계). 셸 밖 전체 화면. 소유: AR-06-004b(최소 동작) → AR-06-062(약관 저장 연결).
// 진행 규칙은 008 상태기계(authReducer)만 따른다. 미연결(후속): 약관 동의 기록 RPC(DB 요청, 008 로그),
// 국외 이전 `core.set_ai_cross_border_ack`, 체험 플랜 기기 활성화(`POST /api/license/activate` 플랜 모드). 지금은 화면 진행만 한다.
import { Banner, Button, Checkbox, formatInt } from "@arch-studio/ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { aiRouteHint } from "../auth/index.ts";
import { useSession } from "../shell/index.ts";

const TERMS = [
  { id: "service", label: "이용약관 동의(필수)" },
  { id: "license", label: "라이선스 약관 동의(필수): 영구 사용권, PC 수, 리버스 엔지니어링 금지, 서비스 종료 시 마지막 빌드 배포" },
  { id: "privacy", label: "개인정보 처리 동의(필수)" },
] as const;

const STEPS = ["약관", "AI", "시작"] as const;

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label="온보딩 단계" className="flex gap-2 text-caption">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={i === current ? "rounded-control bg-accent px-2 py-1 font-semibold text-accent-fg" : "rounded-control border border-line px-2 py-1 text-fg-2"}
        >
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

function TermsStep() {
  const { acceptTerms } = useSession();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const all = TERMS.every((t) => checked[t.id]);
  return (
    <div className="flex flex-col gap-gap">
      <h2 className="text-h2 font-semibold">약관 동의</h2>
      <p className="text-caption text-fg-3">약관 버전은 법무 확정 후 표시합니다.</p>
      <Checkbox label="모두 동의" checked={all} onChange={(e) => setChecked(Object.fromEntries(TERMS.map((t) => [t.id, e.target.checked])))} />
      <div className="flex flex-col gap-2 border-t border-line pt-gap">
        {TERMS.map((t) => (
          <Checkbox key={t.id} label={t.label} checked={checked[t.id] === true} onChange={(e) => setChecked((c) => ({ ...c, [t.id]: e.target.checked }))} />
        ))}
      </div>
      <Button variant="primary" disabled={!all} onClick={() => acceptTerms(all)}>
        다음
      </Button>
      {!all ? <p className="text-caption text-fg-3">필수 항목에 모두 동의해야 다음으로 갈 수 있습니다.</p> : null}
    </div>
  );
}

function AiStep() {
  const { setCrossBorder } = useSession();
  return (
    <div className="flex flex-col gap-gap">
      <h2 className="text-h2 font-semibold">AI 국외 이전 동의(선택)</h2>
      <div className="grid gap-gap md:grid-cols-2">
        <section className="rounded-panel border border-line bg-surface p-pad">
          <h3 className="text-body font-semibold">보내는 것</h3>
          <ul className="list-disc pl-5 text-body text-fg-2">
            <li>렌더 입력 이미지</li>
            <li>법규 질의</li>
            <li>제안서 서술 입력</li>
            <li>대화형 입력 문장</li>
          </ul>
        </section>
        <section className="rounded-panel border border-line bg-surface p-pad">
          <h3 className="text-body font-semibold">보내지 않는 것</h3>
          <ul className="list-disc pl-5 text-body text-fg-2">
            <li>도면·3D 원본</li>
            <li>건축주 연락처</li>
            <li>상담 녹음</li>
          </ul>
        </section>
      </div>
      <p className="text-body text-fg-2">동의하지 않으면 오픈소스 경로만 씁니다. 가격은 같습니다.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setCrossBorder(true)}>
          동의하고 다음
        </Button>
        <Button onClick={() => setCrossBorder(false)}>동의하지 않고 다음</Button>
      </div>
    </div>
  );
}

function StartStep() {
  const { state, start } = useSession();
  const navigate = useNavigate();
  if (state.kind !== "onboarding") return null;
  const route = aiRouteHint(state.progress);
  return (
    <div className="flex flex-col gap-gap">
      <h2 className="text-h2 font-semibold">시작 방식</h2>
      {route === "open_source_only" ? <Banner tone="info" title="국외 AI 사용에 동의하지 않아 오픈소스 경로로 처리합니다. 가격은 같습니다." /> : null}
      <p className="text-body text-fg-2">
        크레딧 잔액 <span className="text-num font-medium text-fg tabular-nums">{formatInt(state.session.credit_balance)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => start()}>
          14일 체험 시작
        </Button>
        <Button
          onClick={() => {
            start();
            navigate("/license", { replace: true });
          }}
        >
          시리얼 입력
        </Button>
      </div>
    </div>
  );
}

export function Screen() {
  const { state } = useSession();
  const step = state.kind === "onboarding" ? state.progress.step : "terms";
  const index = step === "terms" ? 0 : step === "ai" ? 1 : 2;
  return (
    <main className="flex min-h-dvh items-start justify-center bg-bg px-4 py-10 text-fg">
      <div className="flex w-full max-w-2xl flex-col gap-gap">
        <header className="flex flex-col gap-2">
          <h1 className="text-display font-semibold">시작하기</h1>
          <Steps current={index} />
        </header>
        <div className="rounded-panel border border-line bg-surface p-pad">
          {step === "terms" ? <TermsStep /> : step === "ai" ? <AiStep /> : <StartStep />}
        </div>
      </div>
    </main>
  );
}
