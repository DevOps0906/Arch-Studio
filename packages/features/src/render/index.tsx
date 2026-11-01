// `/projects/:id/render` AI 렌더(03장 3.9절, 2.5절). 소유: AR-06-056. 로그인 필수, 권리 ai_render. 호출은 useApi()(멱등 키 필수).
// - 시점: 모델러 공개 파일(modeler/capture)의 열람 전용 뷰포트에서 깊이·윤곽 PNG 2장만 만든다(원본 모델·도면 전송 0).
// - 흐름: uploads/sign(render_input) ×2 → 서명 URL PUT ×2 → POST /api/ai/render(표준만) → GET /api/jobs/{id} 폴링(시간 기반 가짜 진행률 없음).
// - 고품질·업스케일·이 PC에 저장은 준비 중(비활성). 자유 문장 프롬프트 입력란은 두지 않는다(프리셋만).
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { Badge, Banner, Button, CreditCost, Field, Progress, Select } from "@arch-studio/ui";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { isApiError } from "../api-client/index.ts";
import { RenderCaptureError, RenderView, type RenderInputPngs, type RenderViewHandle } from "../modeler/capture/index.tsx";
import { DENY_TEXT, EmptyBlock, ErrorState, LoadingState, LockedState, PageHeader, useApi, useCapabilities, useEntitlement, useOnline, useProject, useSession } from "../shell/index.ts";
import {
  DEFAULT_PRESET,
  EXPIRED_TEXT,
  JOB_POLL_DEADLINE_MS,
  UNSUPPORTED_HERE_TEXT,
  attemptFor,
  attemptKey,
  keepAttempt,
  nextPollDelay,
  type Attempt,
  MATERIAL_OPTIONS,
  RENDER_HQ_CREDITS,
  RENDER_STD_CREDITS,
  SEASON_OPTIONS,
  TIME_OPTIONS,
  UPSCALE_CREDITS,
  isPreset,
  isTerminal,
  jobPhase,
  parseJob,
  parseRun,
  parseTicket,
  renderBody,
  renderErrorText,
  uploadSignBody,
  type JobPhase,
  type Preset,
  type PresetOption,
  type RunStarted,
} from "./model.ts";

const DEFAULT_ERROR = "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요. 문제가 계속되면 고객지원에 문의하세요.";

class UploadError extends Error {}

function errorText(e: unknown): string {
  if (isApiError(e)) return renderErrorText(e.code, e.userMessage);
  if (e instanceof RenderCaptureError) return renderErrorText(e.reason === "too_large" ? "capture_too_large" : "capture_size", DEFAULT_ERROR);
  if (e instanceof UploadError) return renderErrorText("upload_failed", DEFAULT_ERROR);
  return DEFAULT_ERROR;
}

export function Screen() {
  const { load, reload } = useProject();
  if (load.status === "loading") return <LoadingState label="렌더 화면을 여는 중" />;
  if (load.status !== "ready") return <ErrorState title="프로젝트를 불러오지 못했습니다" onRetry={reload} />;
  return <RenderScreen key={load.record.id} record={load.record} />;
}

function PresetSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: readonly PresetOption[]; disabled: boolean; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function RenderScreen({ record }: { record: ProjectRecord }) {
  const api = useApi();
  const online = useOnline();
  const { state } = useSession();
  const decision = useEntitlement("ai_render");
  const allowed = decision?.allowed === true;
  const viewRef = useRef<RenderViewHandle>(null);
  const [capture, setCapture] = useState<RenderInputPngs | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunStarted | null>(null);
  const [phase, setPhase] = useState<JobPhase | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollKey, setPollKey] = useState(0);
  const busy = useRef(false);
  // 같은 캡처·프리셋 재시도는 같은 request_id·업로드 경로(이중 차감 방지). 성공·확정 거절에서만 버린다.
  const attempt = useRef<Attempt | null>(null);
  const [captureSeq, setCaptureSeq] = useState(0);
  // 설치형은 업로드·결과 받기 어댑터가 없어 실패 닫힘(capability로만 판별, 플랫폼 이름 검사 금지).
  const { by } = useCapabilities();
  const unsupportedHere = by("localProjects", true, false);
  const describeId = useId();
  const balance = state.kind === "ready" ? state.session.credit_balance : null;
  const running = submitting || (run !== null && !pollError && (phase === null || !isTerminal(phase)));
  const canSubmit = allowed && !unsupportedHere && online && capture !== null && isPreset(preset) && !running;
  const qualityName = useId();

  // 캡처 미리보기(윤곽 PNG, blob URL은 CSP img-src 허용).
  useEffect(() => {
    if (!capture) return;
    const url = URL.createObjectURL(new Blob([capture.edge as unknown as BlobPart], { type: "image/png" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [capture]);

  // 잡 상태 폴링(Realtime 구독 전 대체 경로). 끝난 상태면 멈춘다.
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
        const next = jobPhase(job, run.credits || RENDER_STD_CREDITS);
        setPhase(next);
        if (isTerminal(next)) return;
        const delay = nextPollDelay(n++);
        if (Date.now() - startedAt + delay > JOB_POLL_DEADLINE_MS) setPollError(true);
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
  }, [run, api, pollKey]);

  async function takeCapture() {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const shot = await viewRef.current?.capture();
      if (!shot) setError(renderErrorText("capture_size", DEFAULT_ERROR));
      else {
        setCapture(shot);
        setCaptureSeq((v) => v + 1);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCapturing(false);
    }
  }

  async function upload(png: Uint8Array): Promise<string> {
    const ticket = await api.request({ method: "POST", path: "/api/uploads/sign", body: await uploadSignBody(png), idempotencyKey: api.newIdempotencyKey(), parse: parseTicket });
    let ok = false;
    try {
      const res = await fetch(ticket.signed_upload_url, { method: "PUT", headers: { "content-type": "image/png", "x-upsert": "false" }, body: png as unknown as BodyInit });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) throw new UploadError();
    return ticket.path;
  }

  async function submit() {
    if (!canSubmit || !capture || busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setError(null);
    setRun(null);
    setPhase(null);
    let a = attemptFor(attempt.current, attemptKey(captureSeq, preset), () => api.newIdempotencyKey());
    attempt.current = a;
    try {
      const depthPath = a.depthPath ?? (await upload(capture.depth));
      a = attempt.current = { ...a, depthPath };
      const edgePath = a.edgePath ?? (await upload(capture.edge));
      a = attempt.current = { ...a, edgePath };
      const started = await api.request({
        method: "POST",
        path: "/api/ai/render",
        body: renderBody(a.requestId, record.id, preset, depthPath, edgePath),
        idempotencyKey: a.requestId,
        parse: parseRun,
      });
      attempt.current = null;
      setRun(started);
    } catch (e) {
      if (!keepAttempt(e)) attempt.current = null;
      setError(errorText(e));
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }

  const setP = (k: keyof Preset) => (v: string) => setPreset((p) => ({ ...p, [k]: v }));
  const disabledReason = decision === undefined ? "권리 확인 중입니다" : !allowed ? "AI 렌더를 쓸 수 있는 상태가 아닙니다" : unsupportedHere ? UNSUPPORTED_HERE_TEXT : !online ? "인터넷 연결 후 씁니다" : capture === null ? "먼저 현재 시점을 캡처하세요" : null;

  return (
    <div className="flex min-w-0 flex-col gap-gap">
      <PageHeader title="렌더" description="모델러 시점으로 AI 렌더 이미지를 만듭니다. 결과는 클라우드에 90일 보관됩니다." />
      {decision && !allowed ? (
        <LockedState
          title="AI 렌더를 쓸 수 없습니다"
          reason={`${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 라이선스 화면에서 상태를 확인하세요.`}
          action={
            <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
              라이선스 보기
            </Link>
          }
        />
      ) : null}
      {unsupportedHere ? <Banner tone="info" title="이 환경에서는 아직 지원하지 않음">{UNSUPPORTED_HERE_TEXT}</Banner> : null}
      {!online ? <Banner tone="warn" title="오프라인">인터넷 연결 후 씁니다. 모델·판정·도면은 그대로 됩니다.</Banner> : null}
      <div className="grid min-w-0 grid-cols-1 gap-gap md:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad" aria-labelledby="render-view">
          <h2 id="render-view" className="text-h2 font-semibold">시점</h2>
          <p className="text-caption text-fg-2">뷰포트를 돌려 시점을 맞춘 뒤 "현재 시점 쓰기"를 누르세요.</p>
          <RenderView designModel={record.designModel} handleRef={viewRef} />
          <div className="flex flex-wrap items-center gap-gap">
            <Button onClick={() => void takeCapture()} loading={capturing} disabled={running}>
              현재 시점 쓰기
            </Button>
            {capture ? (
              <Badge tone="ok" icon="circle-check">
                캡처됨 {capture.width}×{capture.height}
              </Badge>
            ) : null}
          </div>
          {previewUrl && capture ? <img src={previewUrl} alt="보낼 윤곽 이미지 미리보기" className="w-full rounded-control border border-line bg-surface" /> : null}
          <Banner tone="info" title="보내는 것">
            뷰포트 깊이·윤곽 이미지뿐입니다. 도면·3D 원본은 보내지 않습니다.
          </Banner>
        </section>
        <section className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad" aria-labelledby="render-preset">
          <h2 id="render-preset" className="text-h2 font-semibold">프리셋</h2>
          <div className="grid grid-cols-1 gap-gap xl:grid-cols-3">
            <PresetSelect label="재질" value={preset.material} options={MATERIAL_OPTIONS} disabled={running} onChange={setP("material")} />
            <PresetSelect label="시간대" value={preset.time_of_day} options={TIME_OPTIONS} disabled={running} onChange={setP("time_of_day")} />
            <PresetSelect label="계절" value={preset.season} options={SEASON_OPTIONS} disabled={running} onChange={setP("season")} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium text-fg">품질</legend>
            <label className="flex items-center gap-2 text-body text-fg">
              <input type="radio" name={qualityName} value="standard" checked readOnly className="focus-ring accent-accent" />
              표준 1024px · {RENDER_STD_CREDITS} 크레딧
            </label>
            <label className="flex items-center gap-2 text-body text-fg-3">
              <input type="radio" name={qualityName} value="high" disabled className="accent-accent" />
              고품질 2K · {RENDER_HQ_CREDITS} 크레딧
              <Badge tone="neutral">준비 중</Badge>
            </label>
          </fieldset>
          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            <Button variant="primary" onClick={() => void submit()} loading={submitting} disabled={!canSubmit} aria-describedby={disabledReason && !running ? describeId : undefined}>
              렌더 만들기
            </Button>
            {balance !== null ? <CreditCost cost={RENDER_STD_CREDITS} balance={balance} /> : <span className="text-caption text-fg-2">표준 {RENDER_STD_CREDITS} 크레딧</span>}
          </div>
          {disabledReason && !running ? <p id={describeId} className="text-caption text-fg-2">{disabledReason}</p> : null}
          {error ? <ErrorState title="렌더를 시작하지 못했습니다" description={error} /> : null}
        </section>
      </div>
      <section className="flex min-w-0 flex-col gap-gap" aria-labelledby="render-result" aria-live="polite">
        <h2 id="render-result" className="text-h2 font-semibold">진행·결과</h2>
        <ResultArea phase={phase} started={run !== null} submitting={submitting} pollError={pollError} onRetryPoll={() => setPollKey((k) => k + 1)} />
      </section>
    </div>
  );
}

function ResultArea({ phase, started, submitting, pollError, onRetryPoll }: { phase: JobPhase | null; started: boolean; submitting: boolean; pollError: boolean; onRetryPoll: () => void }) {
  if (pollError) return <ErrorState title="진행 상태를 확인하지 못했습니다" description="렌더가 서버에서 아직 진행 중이거나 환불을 처리하고 있습니다. 실패하면 크레딧은 자동으로 돌려드립니다. 잠시 뒤 상태를 다시 확인하세요." action={<Button onClick={onRetryPoll}>상태 다시 확인</Button>} />;
  if (submitting) return <Progress label="캡처 이미지를 올리는 중" />;
  if (!phase) {
    if (started) return <Progress label="대기 중" />;
    return <EmptyBlock icon="inbox" title="렌더가 없습니다" description="모델러 시점으로 첫 렌더를 만들어 보세요. 표준 3 크레딧입니다." />;
  }
  if (phase.kind === "running" || phase.kind === "refunding") {
    return (
      <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
        <Badge tone={phase.kind === "refunding" ? "warn" : "info"} icon={phase.kind === "refunding" ? "triangle-alert" : "sparkles"}>
          {phase.label}
        </Badge>
        <Progress label="렌더 진행" value={phase.progress} />
      </div>
    );
  }
  if (phase.kind === "refunded") {
    return (
      <Banner tone="danger" title="렌더 실패" action={<Badge tone="ok" icon="coins">환불됨</Badge>}>
        {phase.text}
      </Banner>
    );
  }
  if (phase.kind === "expired") return <Banner tone="info" title="보관 기간 만료">{EXPIRED_TEXT}</Banner>;
  const r = phase.result;
  return (
    <figure className="flex flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <img src={r.output_url} alt="AI 렌더 결과" className="w-full rounded-control border border-line" />
      <figcaption className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <Badge tone="warn" icon="sparkles">
          AI 렌더(실제 시공과 다를 수 있음)
        </Badge>
        {r.width && r.height ? <span className="text-caption text-fg-2 tabular-nums">{r.width}×{r.height}</span> : null}
      </figcaption>
      <div className="flex flex-wrap gap-gap">
        <Button disabled title="준비 중">
          이 PC에 저장(준비 중)
        </Button>
        <Button disabled title="준비 중">
          업스케일 {UPSCALE_CREDITS} 크레딧(준비 중)
        </Button>
      </div>
    </figure>
  );
}
