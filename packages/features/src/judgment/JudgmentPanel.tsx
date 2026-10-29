// 판정 패널(03장 3.5절 "판정 패널", AR-F-004·007). 표시 전용: 값·판정은 엔진 결과를 그대로 보인다.
// 모델러 우측 영역(폭은 부모가 정한다)에 들어가도록 w-full. 색·크기는 토큰 유틸리티만. 상태는 배지(아이콘 + 글자).
// packages/ui의 같은 이름 컴포넌트(JudgmentPanel)는 데모용 목록이라 쓰지 않고, Badge·Banner·Button·RuleCitation 조각만 쓴다.
import { Badge, Banner, Button, EmptyState, Icon, JudgmentBadge, Skeleton, Spinner } from "@arch-studio/ui";
import { useId, useState, type ReactNode } from "react";
import {
  CHECK_NOW_LABEL,
  EXTEND_LABEL,
  FALLBACK_BANNER_TITLE,
  REVISION_CHECK_TITLE,
  SHOW_LIST_LABEL,
  fallbackSentence,
  revisionCheckSentence,
  revisionCheckStale,
  type FallbackNotice,
} from "./fallback.ts";
import {
  buildRows,
  countStatuses,
  noticeWarnings,
  scheduledRuleCount,
  type DisplayStatus,
  type JudgmentData,
  type RowView,
} from "./model.ts";
import {
  DISCLAIMER,
  EMPTY_DESCRIPTION,
  EMPTY_TITLE,
  LOADING_LABEL,
  PANEL_TITLE,
  REFRESHING_LABEL,
  STATUS_HINT,
  STATUS_LABEL,
  TARGET_SECTION_NOTE,
  TARGET_SECTION_TITLE,
  UNVERIFIED_BASIS,
  UNVERIFIED_TEXT,
  judgeErrorText,
} from "./messages.ts";

export interface RevisionCheck {
  /** 마지막으로 규칙 팩 개정을 확인한 날(YYYY-MM-DD). 기록이 없으면 null. */
  readonly lastCheckedAt: string | null;
  /** 오늘(YYYY-MM-DD). 호출자가 준다(패널은 시계를 읽지 않는다). */
  readonly today: string;
  readonly onCheck?: () => void;
}

export interface JudgmentPanelProps {
  /** 판정 요청 상태(useJudgment). idle + data 없음 = 아직 판정할 것이 없음. */
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly data: JudgmentData | null;
  /** 오류 코드(useJudgment().error.code). */
  readonly errorCode?: string | null;
  readonly onRetry?: () => void;
  /** 모델에 매스가 있는가. false면 빈 상태(03장 5.4절). */
  readonly hasMass?: boolean;
  /** 빈 상태 아래 행동 버튼(예: 매스 그리기·자동 제안). 036이 넣는다. */
  readonly emptyAction?: ReactNode;
  /** 강조 대상 매스 id(기하 항목 행의 "매스 강조"가 이 목록으로 onHighlight를 부른다). */
  readonly massIds?: readonly string[];
  /** 매스 강조 콜백(3D 강조는 036). 끄면 빈 배열. */
  readonly onHighlight?: (massIds: readonly string[]) => void;
  /** 업데이트 만료 폴백이면 값을 준다(EntitlementStatus에 기한 필드가 생기면 044가 연결). 아니면 null. */
  readonly fallback?: FallbackNotice | null;
  readonly onShowRevisions?: () => void;
  readonly onExtendUpdates?: () => void;
  /** 개정 확인이 30일 넘게 없을 때의 "개정 확인 필요" 배너(제안). 주지 않으면 배너 없음. */
  readonly revisionCheck?: RevisionCheck | null;
  /** 처음부터 펼칠 행 id(미리보기·테스트용). */
  readonly defaultExpanded?: readonly string[];
  readonly className?: string;
}

const BADGE_FALLBACK: Record<Exclude<DisplayStatus, "pass" | "warn" | "fail">, { tone: "neutral" | "info"; icon: "info" | "book-open" }> = {
  unverified: { tone: "neutral", icon: "info" },
  na: { tone: "neutral", icon: "info" },
  target: { tone: "info", icon: "info" },
  not_target: { tone: "neutral", icon: "info" },
};

/** 상태 배지: 색 + 아이콘 + 글자. 스크린리더용 설명을 덧붙인다. */
export function StatusBadge({ status }: { status: DisplayStatus }) {
  const hint = STATUS_HINT[status];
  if (status === "pass" || status === "warn" || status === "fail") {
    return (
      <span aria-label={hint} role="img" className="inline-flex">
        <JudgmentBadge status={status} />
      </span>
    );
  }
  const b = BADGE_FALLBACK[status];
  return (
    <span aria-label={hint} role="img" className="inline-flex">
      <Badge tone={b.tone} icon={b.icon}>
        {STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}

function BasisList({ row }: { row: RowView }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {row.basis.map((b, i) => (
        <li key={i} className="flex flex-col gap-0.5 rounded-control border border-line bg-raised px-2 py-1.5 text-caption text-fg-2">
          {b.verified ? (
            <>
              <span className="font-medium text-fg">
                {b.law} {b.article}
              </span>
              <span className="tabular-nums">시행일 {b.effectiveFrom}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-fg">근거 조문 {UNVERIFIED_BASIS}(법규 원문 대조 전)</span>
              <span>시행일 {UNVERIFIED_BASIS}</span>
            </>
          )}
          {b.ordinance ? <span>지자체 조례 포함</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Row({
  row,
  packVersion,
  open,
  onToggle,
  highlighted,
  onHighlight,
}: {
  row: RowView;
  packVersion: string;
  open: boolean;
  onToggle: () => void;
  highlighted: boolean;
  onHighlight: (() => void) | null;
}) {
  const panelId = useId();
  const unverified = row.status === "unverified";
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="focus-ring flex w-full min-h-row flex-col gap-1 px-pad py-2 text-left hover:bg-raised"
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-body font-medium text-fg">
            <Icon name={open ? "chevron-down" : "chevron-right"} className="size-3.5 shrink-0 text-fg-3" />
            <span className="min-w-0">{row.label}</span>
          </span>
          <StatusBadge status={row.status} />
        </span>
        {row.valueText || row.limitText || row.excessText ? (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-num text-fg-2 tabular-nums">
            {row.valueText ? <span>{row.valueText}</span> : null}
            {row.limitText ? <span>{row.limitText}</span> : null}
            {row.excessText ? <span className="font-medium text-danger">{row.excessText}</span> : null}
          </span>
        ) : null}
        {unverified ? <span className="pl-5 text-caption text-fg-2">{UNVERIFIED_TEXT}</span> : null}
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-2 px-pad pb-3 pl-9">
          {row.reasons.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-caption text-fg-2">
              {row.reasons.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-caption font-medium text-fg">근거 조항</p>
          <BasisList row={row} />
          <p className="text-caption text-fg-2">
            규칙 팩 <span className="font-mono">{packVersion}</span>
          </p>
          {onHighlight ? (
            <div>
              <Button size="sm" variant="secondary" aria-pressed={highlighted} onClick={onHighlight}>
                {highlighted ? "매스 강조 끄기" : "해당 매스 강조"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div id={panelId} hidden />
      )}
    </li>
  );
}

function Section({
  title,
  note,
  rows,
  packVersion,
  expanded,
  toggle,
  highlightedId,
  massIds,
  onHighlightRow,
}: {
  title: string;
  note?: string;
  rows: readonly RowView[];
  packVersion: string;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  highlightedId: string | null;
  massIds: readonly string[];
  onHighlightRow: ((row: RowView) => void) | null;
}) {
  const headingId = useId();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h3 id={headingId} className="px-pad pt-3 text-caption font-semibold text-fg-2">
        {title}
      </h3>
      {note ? <p className="px-pad pb-1 text-caption text-fg-3">{note}</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            packVersion={packVersion}
            open={expanded.has(row.id)}
            onToggle={() => toggle(row.id)}
            highlighted={highlightedId === row.id}
            onHighlight={onHighlightRow && row.highlightable && massIds.length > 0 ? () => onHighlightRow(row) : null}
          />
        ))}
      </ul>
    </section>
  );
}

/** 판정 패널. 모델러(036)가 우측 영역에 넣는다. useJudgment()의 값을 그대로 넘기면 된다. */
export function JudgmentPanel({
  phase,
  data,
  errorCode = null,
  onRetry,
  hasMass = true,
  emptyAction,
  massIds = [],
  onHighlight,
  fallback = null,
  onShowRevisions,
  onExtendUpdates,
  revisionCheck = null,
  defaultExpanded = [],
  className,
}: JudgmentPanelProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const onHighlightRow = onHighlight
    ? (row: RowView) => {
        const off = highlightedId === row.id;
        setHighlightedId(off ? null : row.id);
        onHighlight(off ? [] : massIds);
      }
    : null;

  const titleId = useId();
  const showStale = revisionCheck !== null && revisionCheckStale(revisionCheck.lastCheckedAt, revisionCheck.today);
  const banners = (
    <>
      {fallback ? (
        <Banner
          tone="warn"
          title={FALLBACK_BANNER_TITLE}
          action={
            onShowRevisions || onExtendUpdates ? (
              <div className="flex flex-wrap gap-2">
                {onShowRevisions ? (
                  <Button size="sm" variant="secondary" onClick={onShowRevisions}>
                    {SHOW_LIST_LABEL}
                  </Button>
                ) : null}
                {onExtendUpdates ? (
                  <Button size="sm" onClick={onExtendUpdates}>
                    {EXTEND_LABEL}
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
        >
          {fallbackSentence(fallback)}
        </Banner>
      ) : null}
      {showStale && revisionCheck ? (
        <Banner
          tone="info"
          title={REVISION_CHECK_TITLE}
          action={
            revisionCheck.onCheck ? (
              <Button size="sm" variant="secondary" onClick={revisionCheck.onCheck}>
                {CHECK_NOW_LABEL}
              </Button>
            ) : undefined
          }
        >
          {revisionCheckSentence(revisionCheck.lastCheckedAt, revisionCheck.today)}
        </Banner>
      ) : null}
    </>
  );

  let body: ReactNode;
  if (phase === "error") {
    const t = judgeErrorText(errorCode);
    body = (
      <div className="p-pad">
        <Banner
          tone="danger"
          title={t.title}
          action={
            onRetry ? (
              <Button size="sm" onClick={onRetry}>
                다시 시도
              </Button>
            ) : undefined
          }
        >
          {t.description}
        </Banner>
      </div>
    );
  } else if (!hasMass && !data) {
    body = (
      <div className="p-pad">
        <EmptyState icon="inbox" title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} action={emptyAction} />
      </div>
    );
  } else if (!data) {
    // 아직 첫 결과가 없다(loading·idle).
    body = (
      <div role="status" aria-live="polite" className="flex flex-col gap-gap p-pad">
        <span className="sr-only">{LOADING_LABEL}</span>
        <div aria-hidden="true" className="flex items-center gap-2 text-caption text-fg-2">
          <Spinner />
          {LOADING_LABEL}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-row w-full" />
        ))}
      </div>
    );
  } else {
    const built = buildRows(data);
    const all = [...built.quant, ...built.target];
    const counts = countStatuses(built.quant);
    const scheduled = scheduledRuleCount(data.warnings);
    const notices = noticeWarnings(data.warnings);
    const pack = data.result.rule_pack_version;
    const sectionProps = { packVersion: pack, expanded, toggle, highlightedId, massIds, onHighlightRow };
    body = (
      <>
        <div className="flex flex-col gap-1 border-b border-line px-pad py-2 text-caption text-fg-2">
          <p className="flex flex-wrap gap-x-2 tabular-nums" aria-label="판정 요약">
            <span>통과 {counts.pass}</span>
            <span>· 확인 필요 {counts.warn}</span>
            <span>· 기준 초과 {counts.fail}</span>
            <span>· 미확인 {counts.unverified}</span>
          </p>
          <p>
            <span>
              규칙 팩 <span className="font-mono">{pack}</span>
            </span>
            <span> · 적용 기준일 {data.result.application_date}</span>
          </p>
          {phase === "loading" ? (
            <p role="status" aria-live="polite" className="flex items-center gap-1.5">
              <Spinner />
              {REFRESHING_LABEL}
            </p>
          ) : null}
        </div>
        {all.length === 0 ? (
          <div className="p-pad">
            <EmptyState icon="inbox" title="표시할 판정이 없습니다" description="근거 조항이 있는 판정 항목이 아직 없습니다." />
          </div>
        ) : (
          <>
            <Section title="건축 기준" rows={built.quant} {...sectionProps} />
            <Section title={TARGET_SECTION_TITLE} note={TARGET_SECTION_NOTE} rows={built.target} {...sectionProps} />
          </>
        )}
        {notices.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-line px-pad py-2 text-caption text-fg-2">
            {notices.map((w, i) => (
              <li key={`${w.code}-${i}`} className="flex gap-1.5">
                <Icon name="info" className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {scheduled > 0 ? (
          <p className="border-t border-line px-pad py-2 text-caption text-fg-2 tabular-nums">예정 규칙(참고) {scheduled}건</p>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className={["flex w-full min-w-0 flex-col gap-gap", className ?? ""].join(" ").trim()}>
      {banners}
      <div className="flex flex-col rounded-panel border border-line bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-line px-pad py-2">
          <h2 id={titleId} className="text-h2 font-semibold text-fg">
            {PANEL_TITLE}
          </h2>
          {data?.elapsedMs != null ? <span className="text-caption text-fg-3 tabular-nums">판정 {Math.round(data.elapsedMs)}ms</span> : null}
        </header>
        {body}
        <p className="border-t border-line px-pad py-2 text-caption text-fg-3">{DISCLAIMER}</p>
      </div>
    </section>
  );
}
