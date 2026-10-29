// 매스 자동 제안 패널(03장 3.5절 "매스 자동 제안", 여정 3·4단계). 순수 표시 컴포넌트: 상태·요청은 부모(index.tsx)가 준다.
// - 상태 4종: 빈(제안 전) · 로딩 · 오류 · 성공(비교 카드 3안). 성공 안의 변형: 목표 미달 · 법규 수치 미확인 · 오래된 결과.
// - 비교 카드의 건폐·용적·높이는 엔진 판정(judge) 결과를 판정 패널과 같은 표시 모델(buildRows)로 보여 줄 뿐, 여기서 계산하지 않는다.
//   연면적·층수·바닥 크기는 제안 엔진이 낸 값이라 "제안 산정"으로 표시한다.
// - 열람(체험·구독 만료)·좁은 화면(~767)·오래된 결과에서는 '적용'을 잠그고 이유를 보인다. 보기와 제안 받기는 된다(0 크레딧, 로컬 계산).
import { Banner, Button, EmptyState, Field, IconButton, Input, NumberInput } from "@arch-studio/ui";
import { useId, useRef, useState } from "react";
import { DISCLAIMER, StatusBadge, buildRows, countStatuses, type DisplayStatus, type RowView } from "../../judgment/index.ts";
import { LoadingState } from "../../shell/index.ts";
import type { Model } from "../state/commands.ts";
import { PlanPreview } from "./PlanPreview.tsx";
import { TARGET_LIMITS, defaultTargets, targetsIssue, type SuggestCandidateView, type SuggestTargets } from "./protocol.ts";
import { suggestInputKey, type SuggestState } from "./state.ts";

export const STALE_TEXT = "대지나 규칙이 바뀌어 결과가 오래되었습니다. 다시 제안 받으면 적용할 수 있습니다.";
export const LOADING_TEXT = "매스 후보를 찾는 중입니다(보통 3초 안).";
export const EMPTY_TITLE = "아직 제안이 없습니다";
export const EMPTY_DESCRIPTION = "목표 연면적과 층수를 확인하고 '제안 받기'를 누르면 건폐 최대·일조 여유·정형 평면 3안을 만듭니다.";
const CARD_KEYS = ["coverage", "far", "height"] as const;

function parseNumber(text: string): number | null | undefined {
  const t = text.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined; // undefined = 숫자가 아님
}

/** 카드 머리 배지: 대표 행 상태 중 가장 나쁜 것. */
export function cardStatus(rows: readonly RowView[]): DisplayStatus {
  const c = countStatuses(rows);
  if (c.fail > 0) return "fail";
  if (c.unverified > 0) return "unverified";
  if (c.warn > 0) return "warn";
  return "pass";
}

const n = (v: number) => v.toLocaleString("ko-KR");
const m = (mm: number) => (mm / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 2 });

function CandidateCard({ c, model, applyLockReason, applied, onApply, describeId }: { c: SuggestCandidateView; model: Model; applyLockReason: string | null; applied: boolean; onApply: () => void; describeId: string }) {
  const titleId = useId();
  const built = buildRows(c.judge);
  const rows = CARD_KEYS.map((k) => built.quant.find((r) => r.key === k)).filter((r): r is RowView => r !== undefined);
  const setbacks = built.quant.filter((r) => r.key === "setback");
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-raised p-pad">
      <header className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-h2 font-semibold text-fg">
          {c.title}
        </h3>
        <StatusBadge status={cardStatus([...rows, ...setbacks])} />
      </header>
      <PlanPreview
        site={model.site.boundary.outer}
        footprints={c.masses.map((x) => x.footprint.outer)}
        northAngleDeg={model.site.north_angle_deg}
        label={`${c.title} 바닥 미리보기: 폭 ${m(c.widthMm)}m, 깊이 ${m(c.depthMm)}m, 지상 ${c.floors}층`}
      />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption">
        <dt className="text-fg-2">지상 층수</dt>
        <dd className="text-right text-num tabular-nums text-fg">{c.floors}층</dd>
        <dt className="text-fg-2">연면적(제안 산정)</dt>
        <dd className="text-right text-num tabular-nums text-fg">{n(c.gfaM2)}㎡</dd>
        <dt className="text-fg-2">바닥 크기</dt>
        <dd className="text-right text-num tabular-nums text-fg">
          {m(c.widthMm)}×{m(c.depthMm)}m
        </dd>
        {c.spareFloors > 0 ? (
          <>
            <dt className="text-fg-2">엔벨로프 여유</dt>
            <dd className="text-right text-num tabular-nums text-fg">{c.spareFloors}층</dd>
          </>
        ) : null}
      </dl>
      <ul aria-label={`${c.title} 판정`} className="flex flex-col gap-1 border-t border-line pt-2">
        {[...rows, ...setbacks].map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <span className="text-caption font-medium text-fg">{r.label}</span>
            <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-caption text-fg-2">
              <span className="tabular-nums">{[r.valueText, r.limitText].filter(Boolean).join(" · ")}</span>
              <StatusBadge status={r.status} />
            </span>
          </li>
        ))}
      </ul>
      {c.reasons.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-caption text-fg-2">
          {c.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-col gap-1 pt-1">
        <Button variant="primary" icon={applied ? "check" : undefined} disabled={applyLockReason !== null} aria-describedby={applyLockReason ? describeId : undefined} onClick={onApply}>
          {applied ? "적용됨" : "이 안으로 적용"}
        </Button>
        {applied ? <p className="text-caption text-fg-2">적용했습니다. 실행 취소(Ctrl+Z) 한 번으로 이전 매스로 돌아갑니다.</p> : null}
      </div>
    </article>
  );
}

export interface SuggestPanelProps {
  readonly model: Model;
  readonly state: SuggestState;
  /** 제안 요청. 목표에 문제가 있으면 화면 문구, 없으면 null. */
  readonly onRequest: (t: SuggestTargets) => string | null;
  readonly onApply: (c: SuggestCandidateView) => void;
  readonly onClose: () => void;
  readonly editable: boolean;
  readonly lockReason: string | null;
}

export function SuggestPanel({ model, state, onRequest, onApply, onClose, editable, lockReason }: SuggestPanelProps) {
  const base = useId();
  const initial = useRef(defaultTargets(model)).current;
  const [gfa, setGfa] = useState(initial.target_gfa_m2 === null ? "" : String(initial.target_gfa_m2));
  const [floors, setFloors] = useState("");
  const [floorHeight, setFloorHeight] = useState(initial.floor_height_mm);
  const [use, setUse] = useState(initial.use);
  const [issue, setIssue] = useState<string | null>(null);
  const gfaId = `${base}-gfa`;
  const lockId = `${base}-lock`;
  const busy = state.phase === "loading";
  const view = state.view;
  const stale = view !== null && state.inputKey !== suggestInputKey(model);

  const submit = () => {
    const g = parseNumber(gfa);
    const f = parseNumber(floors);
    if (g === undefined) return setIssue("목표 연면적은 숫자로 넣으세요.");
    if (f === undefined) return setIssue("목표 층수는 숫자로 넣으세요.");
    const t: SuggestTargets = { target_gfa_m2: g, floors: f, floor_height_mm: floorHeight, use };
    setIssue(targetsIssue(t) ?? onRequest(t));
  };

  const applyLock = !editable ? (lockReason ?? "편집할 수 없는 상태입니다.") : stale ? STALE_TEXT : busy ? "새 제안을 계산하는 중입니다." : null;
  const notice = (code: string) => view?.notices.find((x) => x.code === code);
  const unmet = notice("TARGET_NOT_MET");
  const lawUnverified = notice("LAW_UNVERIFIED");
  const blocked = view?.notices.find((x) => x.code === "NO_CANDIDATE" || x.code === "ENVELOPE_EMPTY");

  return (
    <section aria-labelledby={`${base}-title`} className="@container flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`${base}-title`} className="text-h2 font-semibold text-fg">
            매스 자동 제안
          </h2>
          <p className="text-body text-fg-2">대지·법규 엔벨로프·면적표 목표로 매스 후보 3안을 만듭니다. 기준 초과가 있는 안은 나오지 않고, 같은 입력이면 같은 안이 나옵니다. 크레딧은 쓰지 않습니다.</p>
        </div>
        <IconButton icon="x" label="매스 제안 닫기" size="sm" onClick={onClose} />
      </header>

      <form
        className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-5 @3xl:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="목표 연면적" htmlFor={gfaId} hint="비우면 층수로만 정합니다">
          <Input id={gfaId} inputMode="decimal" suffix="㎡" value={gfa} onChange={(e) => setGfa(e.target.value)} invalid={issue !== null} />
        </Field>
        <Field label="목표 층수" htmlFor={`${base}-floors`} hint="비우면 자동">
          <Input id={`${base}-floors`} inputMode="numeric" suffix="층" value={floors} onChange={(e) => setFloors(e.target.value)} />
        </Field>
        <Field label="층고" htmlFor={`${base}-fh`}>
          <NumberInput id={`${base}-fh`} value={floorHeight} onChange={setFloorHeight} min={TARGET_LIMITS.floorHeightMin} max={TARGET_LIMITS.floorHeightMax} step={100} />
        </Field>
        <Field label="용도" htmlFor={`${base}-use`}>
          <Input id={`${base}-use`} value={use} maxLength={TARGET_LIMITS.useMax} onChange={(e) => setUse(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-1 @3xl:pt-5">
          <Button type="submit" variant="primary" icon="sparkles" loading={busy}>
            {view ? "다시 제안 받기" : "제안 받기"}
          </Button>
        </div>
        {issue ? (
          <p role="alert" className="text-caption text-danger @lg:col-span-2 @3xl:col-span-5">
            {issue}
          </p>
        ) : null}
      </form>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-gap">
        {state.phase === "loading" && !view ? <LoadingState label={LOADING_TEXT} rows={2} /> : null}
        {state.phase === "loading" && view ? <p className="text-caption text-fg-2">{LOADING_TEXT} 이전 결과는 계산이 끝나면 바뀝니다.</p> : null}
        {state.phase === "error" ? (
          <Banner tone="danger" title="매스를 제안하지 못했습니다" action={<Button size="sm" onClick={submit}>다시 시도</Button>}>
            {state.error}
          </Banner>
        ) : null}
        {state.phase === "idle" ? <EmptyState icon="sparkles" title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} /> : null}

        {view && state.phase !== "error" ? (
          <>
            {stale ? (
              <Banner tone="warn" title="결과가 오래되었습니다">
                {STALE_TEXT}
              </Banner>
            ) : null}
            {unmet ? (
              <Banner
                tone="warn"
                title="목표 연면적을 채우는 안이 없습니다"
                action={
                  <Button size="sm" onClick={() => document.getElementById(gfaId)?.focus()}>
                    목표 조정
                  </Button>
                }
              >
                {unmet.message} 아래는 판정에서 기준 초과가 없는 가장 큰 안들입니다.
              </Banner>
            ) : null}
            {blocked ? (
              <Banner tone="warn" title="후보를 만들지 못했습니다">
                {blocked.message}
              </Banner>
            ) : null}
            {lawUnverified ? (
              <Banner tone="info" title="법규 수치가 확인되지 않았습니다">
                {lawUnverified.message}
              </Banner>
            ) : null}
            {view.rulePackFallback ? <p className="text-caption text-fg-2">업데이트 만료로 보관 중인 규칙 팩({view.rulePackVersion})으로 계산했습니다.</p> : null}
            {view.candidates.length > 0 ? (
              <>
                {model.masses.length > 0 && applyLock === null ? (
                  <p className="text-caption text-fg-2">
                    적용하면 현재 매스 {model.masses.length}개가 이 안으로 바뀝니다{model.floor_layouts.length > 0 ? "(층 평면도 함께 지워집니다)" : ""}. 실행 취소 한 번으로 되돌릴 수 있습니다.
                  </p>
                ) : null}
                {applyLock ? (
                  <p id={lockId} className="flex items-center gap-1 text-caption text-fg-2">
                    <span className="font-medium text-fg">적용 잠금:</span> {applyLock}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-gap @xl:grid-cols-2 @4xl:grid-cols-3">
                  {view.candidates.map((c) => (
                    <CandidateCard key={c.id} c={c} model={model} applyLockReason={applyLock} applied={state.applied === c.id} onApply={() => onApply(c)} describeId={lockId} />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <p className="text-caption text-fg-3">{DISCLAIMER}</p>
    </section>
  );
}
