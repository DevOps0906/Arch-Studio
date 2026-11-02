// `/projects/:id/review` 클라우드 법규 검토(03장 3.11절). 소유: AR-06-055. 권리 cloud_review(폴백·만료는 잠금 안내, AR012).
// 흐름: 보내는 것 목록 → "검토 요청"(15크레딧, request_id 멱등) → GET /api/jobs/{id} 폴링(서버 보고 단계만) → 결과.
// 결과: 항목별 판정(수치는 엔진 값 칸에서만), AI 해석 문장(출처 칩, "해석 · 수치 아님"), "확인 필요 사항"(사용자가 확인 표시).
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { Badge, Banner, Button, Checkbox, CreditCost, Icon, RuleCitation, Spinner, cn } from "@arch-studio/ui";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isApiError } from "../api-client/index.ts";
import { DENY_TEXT, EmptyBlock, ErrorState, LoadingState, LockedState, PageHeader, useApi, useEntitlement, useOnline, useProject, useSession } from "../shell/index.ts";
import {
  REVIEW_CREDITS,
  REVIEW_PATH,
  REVIEW_POLL_DEADLINE_MS,
  REVIEW_SENDS,
  REVIEW_STEPS,
  VERDICT_VIEW,
  isLockError,
  keepsReviewRequestId,
  nextPollDelay,
  parseJob,
  parseRun,
  reviewBody,
  reviewPhase,
  reviewView,
  startErrorText,
  type ReviewPhase,
  type ReviewSource,
  type RunStarted,
  type SentenceView,
} from "./model.ts";

const DISCLAIMER = "AI 검토는 법적 판정이 아닙니다. 판정 수치는 로컬 규칙 엔진 값이며, 해석 문장은 근거 조항과 함께 참고용으로만 보여 줍니다.";

export function Screen() {
  const { load, reload } = useProject();
  if (load.status === "loading") return <LoadingState label="검토 화면을 여는 중" />;
  if (load.status !== "ready") return <ErrorState title="프로젝트를 불러오지 못했습니다" onRetry={reload} />;
  return <ReviewScreen key={load.record.id} record={load.record} />;
}

function LicenseLink() {
  return (
    <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
      라이선스 보기
    </Link>
  );
}

function Sources({ sources, packVersion }: { sources: readonly ReviewSource[]; packVersion: string }) {
  return (
    <span className="flex flex-wrap gap-1">
      {sources.map((s) => (
        <RuleCitation key={s.id} article={`${s.law} ${s.article}`} effectiveDate={s.effective_from} packVersion={packVersion} />
      ))}
    </span>
  );
}

function Interpretation({ s, packVersion }: { s: SentenceView; packVersion: string }) {
  return (
    <li className="flex flex-col gap-1">
      <p className="text-body text-fg">
        <span className="mr-1.5 inline-flex align-middle">
          <Badge icon="sparkles">해석 · 수치 아님</Badge>
        </span>
        {s.text}
      </p>
      <Sources sources={s.sources} packVersion={packVersion} />
    </li>
  );
}

function Result({ phase }: { phase: Extract<ReviewPhase, { kind: "succeeded" }> }) {
  const view = reviewView(phase.review);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const done = view.needsCheck.filter((n) => checked.has(n.id)).length;
  return (
    <div className="flex flex-col gap-gap">
      <Banner tone="info" title="법적 판정이 아닙니다">
        {DISCLAIMER}
      </Banner>
      <section aria-labelledby="review-items" className="flex flex-col gap-2">
        <h2 id="review-items" className="text-h2 font-semibold text-fg">
          항목별 판정
        </h2>
        {view.items.length === 0 ? (
          <EmptyBlock icon="inbox" title="판정 항목이 없습니다" description="규칙 팩에 이 모델로 판정할 항목이 없습니다." />
        ) : (
          <ul className="grid grid-cols-1 gap-gap xl:grid-cols-2">
            {view.items.map((it) => {
              const v = VERDICT_VIEW[it.verdict];
              return (
                <li key={it.key} className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-body font-semibold text-fg">{it.label}</h3>
                    <Badge tone={v.tone} icon={v.icon}>
                      <span className="font-mono">{it.verdict}</span>
                      {v.label}
                    </Badge>
                  </div>
                  {it.value ? (
                    <dl className="grid grid-cols-2 gap-2 rounded-control bg-raised p-2">
                      <div>
                        <dt className="text-caption text-fg-2">산정값(엔진)</dt>
                        <dd className="text-num font-semibold tabular-nums text-fg">
                          {it.value.actual} <span className="text-caption text-fg-2">{it.value.unit}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-caption text-fg-2">한도값</dt>
                        <dd className="text-num font-semibold tabular-nums text-fg">
                          {it.value.limit} <span className="text-caption text-fg-2">{it.value.unit}</span>
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  {it.sentences.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {it.sentences.map((s, i) => (
                        <Interpretation key={i} s={s} packVersion={view.rulePackVersion} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="review-needs" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="review-needs" className="flex items-center gap-2 text-h2 font-semibold text-fg">
            <Icon name="triangle-alert" className="size-5 text-warn" />
            확인 필요 사항
          </h2>
          {view.needsCheck.length > 0 ? (
            <span className="text-caption tabular-nums text-fg-2" aria-live="polite">
              {done}/{view.needsCheck.length} 확인함
            </span>
          ) : null}
        </div>
        {view.needsCheck.length === 0 ? (
          <p className="text-body text-fg-2">확인 필요 사항이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-gap">
            {view.needsCheck.map((n) => (
              <li key={n.id} className={cn("flex flex-col gap-1.5 rounded-control border border-line p-2", checked.has(n.id) && "bg-raised")}>
                <p className="text-body text-fg">{n.text}</p>
                <Sources sources={n.sources} packVersion={view.rulePackVersion} />
                <Checkbox
                  label="확인했습니다"
                  checked={checked.has(n.id)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(n.id);
                      else next.delete(n.id);
                      return next;
                    });
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {view.hidden > 0 ? (
        <p className="flex items-center gap-1 text-caption text-fg-3">
          <Icon name="info" className="size-3.5" />
          출처가 없거나 수치가 섞인 해석 문장은 표시하지 않았습니다.
        </p>
      ) : null}
    </div>
  );
}

function ReviewScreen({ record }: { record: ProjectRecord }) {
  const api = useApi();
  const online = useOnline();
  const { state } = useSession();
  const decision = useEntitlement("cloud_review");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [run, setRun] = useState<RunStarted | null>(null);
  const [phase, setPhase] = useState<ReviewPhase | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  // 결과를 모르는 실패 뒤 다시 누르면 같은 request_id(서버 start_ai_run이 기존 실행을 돌려준다 → 이중 차감 없음).
  const requestId = useRef<string | null>(null);
  const balance = state.kind === "ready" ? state.session.credit_balance : null;
  const modelOk = reviewBody(record.designModel, record.id, "00000000-0000-4000-8000-000000000000") !== null;
  const running = submitting || (run !== null && !pollError && (phase === null || phase.kind === "running"));

  useEffect(() => {
    if (!run) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let n = 0;
    const tick = async () => {
      try {
        const job = await api.request({ method: "GET", path: `/api/jobs/${run.job_id}`, parse: parseJob, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        const next = reviewPhase(job);
        setPhase(next);
        if (next.kind !== "running") return;
        const delay = nextPollDelay(n++);
        if (Date.now() - startedAt + delay > REVIEW_POLL_DEADLINE_MS) setPollError(true);
        else timer = setTimeout(() => void tick(), delay);
      } catch {
        if (!ctrl.signal.aborted) setPollError(true);
      }
    };
    setPollError(false);
    void tick();
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, run, pollKey]);

  if (decision && !decision.allowed) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="검토" />
        <LockedState
          title="클라우드 법규 검토를 쓸 수 없습니다"
          reason={`${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 로컬 판정은 그대로 됩니다. 라이선스 화면에서 상태를 확인하세요.`}
          action={<LicenseLink />}
        />
      </div>
    );
  }
  if (locked) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="검토" />
        <LockedState title="클라우드 법규 검토를 쓸 수 없습니다" reason={locked} action={<LicenseLink />} />
      </div>
    );
  }

  const submit = async (): Promise<void> => {
    if (running) return;
    const id = requestId.current ?? api.newIdempotencyKey();
    requestId.current = id;
    const body = reviewBody(record.designModel, record.id, id);
    if (!body) return;
    setSubmitting(true);
    setError(null);
    setPhase(null);
    try {
      const started = await api.request({ method: "POST", path: REVIEW_PATH, body, idempotencyKey: id, idempotencyHeader: false, autoRetry: false, parse: parseRun });
      requestId.current = null;
      setRun(started);
    } catch (e) {
      if (isApiError(e)) {
        if (!keepsReviewRequestId(e)) requestId.current = null;
        if (isLockError(e)) setLocked(startErrorText(e));
        else setError(startErrorText(e));
      } else {
        setError("검토를 요청하지 못했습니다. 잠시 뒤 다시 시도하세요.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const restart = (): void => {
    setRun(null);
    setPhase(null);
    setPollError(false);
  };

  return (
    <div className="flex flex-col gap-gap overflow-y-auto">
      <PageHeader title="검토" description="현재 모델의 판정을 서버가 같은 규칙으로 다시 계산하고, 근거 조항과 해석을 붙여 돌려줍니다." />

      {phase?.kind !== "succeeded" ? (
        <section aria-labelledby="review-request" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
          <h2 id="review-request" className="text-h2 font-semibold text-fg">
            보내는 것
          </h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-fg-2">
            {REVIEW_SENDS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="flex items-center gap-1 text-caption text-fg-2">
            <Icon name="lock" className="size-3.5" />
            도면·3D 원본은 보내지 않습니다.
          </p>
          {!modelOk ? (
            <Banner tone="warn" title="이 모델로는 검토를 요청할 수 없습니다">
              대지와 규칙 팩(지자체·신청일)을 먼저 정하세요.
            </Banner>
          ) : null}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            {balance !== null ? <CreditCost cost={REVIEW_CREDITS} balance={balance} /> : <span className="text-caption text-fg-2">실행 시 {REVIEW_CREDITS} 크레딧 차감</span>}
            <Button variant="primary" icon="send" loading={submitting} disabled={!online || !modelOk || running} onClick={() => void submit()}>
              검토 요청
            </Button>
          </div>
          {!online ? <p className="text-caption text-warn">오프라인입니다. 연결되면 요청할 수 있습니다.</p> : null}
        </section>
      ) : null}

      {error ? <ErrorState title="검토를 요청하지 못했습니다" description={error} onRetry={online && modelOk ? () => void submit() : undefined} /> : null}

      {run && phase?.kind !== "succeeded" && phase?.kind !== "failed" && !pollError ? (
        <section role="status" aria-live="polite" aria-labelledby="review-progress" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
          <h2 id="review-progress" className="flex items-center gap-2 text-h2 font-semibold text-fg">
            <Spinner />
            검토 중
          </h2>
          <ol className="flex flex-col gap-1 md:flex-row md:gap-gap">
            {REVIEW_STEPS.map((label, i) => {
              const step = phase?.kind === "running" ? phase.step : 0;
              const state = i < step ? "done" : i === step ? "now" : "next";
              return (
                <li key={label} aria-current={state === "now" ? "step" : undefined} className={cn("flex items-center gap-1.5 text-body", state === "next" ? "text-fg-3" : "text-fg")}>
                  <Icon name={state === "done" ? "circle-check" : state === "now" ? "chevron-right" : "square"} className={cn("size-4", state === "done" && "text-ok")} />
                  {label}
                </li>
              );
            })}
          </ol>
          <p className="text-caption text-fg-2">보통 3분 안에 끝납니다. 10분을 넘으면 실패로 처리하고 크레딧을 환불합니다.</p>
        </section>
      ) : null}

      {pollError ? (
        <ErrorState
          title="검토 상태를 확인하지 못했습니다"
          description="요청은 접수되었습니다. 연결을 확인한 뒤 상태를 다시 확인하세요(다시 요청하지 않아도 됩니다)."
          action={
            <Button size="sm" onClick={() => setPollKey((k) => k + 1)}>
              상태 다시 확인
            </Button>
          }
        />
      ) : null}

      {phase?.kind === "failed" ? (
        <ErrorState
          title="검토에 실패했습니다"
          description={phase.message}
          action={
            <Button size="sm" onClick={restart}>
              새로 요청하기
            </Button>
          }
        />
      ) : null}

      {phase?.kind === "succeeded" ? (
        <>
          <Result phase={phase} />
          <div>
            <Button variant="ghost" icon="send" onClick={restart}>
              다시 검토 요청
            </Button>
          </div>
        </>
      ) : null}

      {!run && !error && !submitting ? (
        <EmptyBlock icon="inbox" title="검토 결과가 없습니다" description="현재 모델로 클라우드 법규 검토를 요청하면 근거 조항과 함께 결과를 보여 줍니다." />
      ) : null}
    </div>
  );
}
