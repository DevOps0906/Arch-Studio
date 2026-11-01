// /projects 대시보드 조각(03장 3.3절, AR-06-082). 표시 전용: 상태는 index.tsx가 갖고 props로만 받는다(renderToStaticMarkup 테스트 대상).
// 색·크기는 토큰 유틸리티만. 판정 상태는 색 + 아이콘 + 글자(DESIGN.md 6장). 값이 없는 칸은 빈 상태 문구(0 표시 금지).
import { Badge, Button, Checkbox, Icon, Progress, Skeleton, type IconName } from "@arch-studio/ui";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { WORKSPACE_STAGES } from "../shell/workspace.ts";
import { usagePercent, ZERO_CREDIT_TEXT, type CreditView } from "./credit.ts";
import type { DashboardSummary, ProjectCardView, ProjectTodo, VerdictFacts } from "./dashboard.ts";
import { formatDate } from "./messages.ts";
import { StoreChip } from "./parts.tsx";
import { SitePreview } from "./SitePreview.tsx";
import type { TodayItem } from "./today.ts";

export const DASH_TEXT = {
  heading: "오늘 이어서 할 작업",
  noVerdict: "판정 기록 없음",
  noVerdictHint: "열어서 판정하면 여기에 보입니다.",
  noSheet: "시트 아직 없음",
  sheetPreviewLater: "미리보기는 도면 단계에서 봅니다.",
  noSite: "대지 경계를 읽지 못했습니다",
  weekSheetsEmpty: "시트 생성 시각을 아직 기록하지 않습니다.",
  todoTitle: "오늘 할 일",
  todoEmpty: "오늘 할 일이 없습니다",
  cloudTitle: "진행 중 클라우드 작업",
  cloudNotConnected: "클라우드 작업 조회는 아직 연결되지 않았습니다.",
  activityTitle: "최근 활동",
  activityEmpty: "최근 활동은 아직 기록하지 않습니다.",
  revisionTitle: "법규 개정 알림",
  revisionEmpty: "규칙 팩 개정 정보를 아직 받지 않았습니다.",
  revisionFallback: "업데이트 기간이 끝나 마지막 규칙 팩으로 판정합니다. 이후 개정은 반영되지 않습니다.",
} as const;

const CARD = "flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad";

/* ---------- 요약 4칸 ---------- */

function Cell({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-panel border border-line bg-surface p-pad">
      <p className="text-caption text-fg-2">{label}</p>
      <div className="text-display font-semibold text-fg tabular-nums">{children}</div>
      {foot ? <p className="text-caption text-fg-2">{foot}</p> : null}
    </div>
  );
}

const DASH = <span className="text-fg-3">-</span>;

export function SummaryStrip({ summary, credit, onViolations }: { summary: DashboardSummary | null; credit: CreditView; onViolations: () => void }) {
  const fail = summary?.failItems ?? null;
  return (
    <section aria-label="요약" className="grid grid-cols-2 gap-gap md:grid-cols-4">
      <Cell label="진행 중 프로젝트">{summary ? summary.active : DASH}</Cell>
      <Cell
        label="기준 초과 항목"
        foot={fail === null ? DASH_TEXT.noVerdict : `${summary?.failProjects ?? 0}개 프로젝트${summary?.example ? " · [예시]" : ""}`}
      >
        {fail === null ? (
          DASH
        ) : fail > 0 ? (
          <button type="button" onClick={onViolations} className="focus-ring rounded-sm text-danger underline-offset-4 hover:underline" aria-label={`기준 초과 ${fail}건, 초과 많은 순으로 정렬`}>
            {fail}
          </button>
        ) : (
          fail
        )}
      </Cell>
      <Cell label="이번 주 만든 시트" foot={DASH_TEXT.weekSheetsEmpty}>
        {DASH}
      </Cell>
      <Cell
        label="크레딧 잔액"
        foot={credit.status === "ready" ? (credit.snapshot.example ? "[예시]" : credit.stale ? `기준 ${formatDate(credit.snapshot.asOf)}` : "크레딧") : credit.status === "unavailable" ? "불러올 수 없음" : null}
      >
        {credit.status === "ready" ? credit.snapshot.balance : DASH}
      </Cell>
    </section>
  );
}

/* ---------- 프로젝트 카드 ---------- */

const VERDICT_BADGES: readonly { key: "pass" | "warn" | "fail"; label: string; tone: "ok" | "warn" | "danger"; icon: IconName }[] = [
  { key: "pass", label: "통과", tone: "ok", icon: "circle-check" },
  { key: "warn", label: "확인", tone: "warn", icon: "triangle-alert" },
  { key: "fail", label: "초과", tone: "danger", icon: "circle-x" },
];

export function VerdictBadges({ verdict }: { verdict: VerdictFacts | null }) {
  if (!verdict) {
    return (
      <p className="text-caption text-fg-2">
        <span className="font-medium text-fg">{DASH_TEXT.noVerdict}</span> · {DASH_TEXT.noVerdictHint}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1" aria-label={`판정 통과 ${verdict.pass} · 확인 ${verdict.warn} · 초과 ${verdict.fail}${verdict.example ? " ([예시])" : ""}`}>
      {verdict.example ? <span className="text-caption text-fg-3">[예시]</span> : null}
      {verdict.at ? <span className="text-caption text-fg-3">기준 {formatDate(verdict.at)}</span> : null}
      {VERDICT_BADGES.map((b) =>
        b.key === "pass" || verdict[b.key] > 0 ? (
          <Badge key={b.key} tone={b.tone} icon={b.icon}>
            {b.label} {verdict[b.key]}
          </Badge>
        ) : (
          <Badge key={b.key} tone="neutral" icon={b.icon}>
            {b.label} 0
          </Badge>
        ),
      )}
    </p>
  );
}

/** 6칸 진척 막대: 완료 칸은 먹, 현재 칸은 테두리, 남은 칸은 바탕. */
export function StageBar({ done, current, next }: { done: readonly boolean[]; current: ProjectCardView["progress"]["current"]; next: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div role="img" aria-label={`진척 ${current.n}/6 ${current.label}`} className="grid grid-cols-6 gap-0.5">
        {WORKSPACE_STAGES.map((s, i) => (
          <i key={s.id} title={s.label} className={`h-1.5 rounded-full ${done[i] ? "bg-accent" : s.id === current.id ? "bg-fg-3" : "bg-raised"}`} />
        ))}
      </div>
      <p className="text-caption text-fg-2">
        <span className="font-medium text-fg tabular-nums">
          {current.n}/6 {current.label}
        </span>{" "}
        · {next}
      </p>
    </div>
  );
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      {children}
      <figcaption className="truncate text-caption text-fg-2">{caption}</figcaption>
    </figure>
  );
}

function SheetBox({ name }: { name: string | null }) {
  return (
    <div className={`flex aspect-4/3 w-full flex-col items-center justify-center gap-1 rounded-panel border bg-viewport p-2 text-center ${name ? "border-line" : "border-dashed border-line"}`}>
      <Icon name="section" className="text-fg-3" />
      <span className="text-caption font-medium text-fg-2">{name ?? DASH_TEXT.noSheet}</span>
      {name ? <span className="text-caption text-fg-3">{DASH_TEXT.sheetPreviewLater}</span> : null}
    </div>
  );
}

export function ProjectCard({ card, onManage }: { card: ProjectCardView; onManage: (id: string) => void }) {
  const titleId = useId();
  const o = card.outline;
  return (
    <article aria-labelledby={titleId} className={`${CARD} min-w-0`}>
      <div className="grid grid-cols-2 gap-2">
        <Figure caption={o ? `대지 · ${o.areaText}` : "대지 · 없음"}>
          {o ? (
            <SitePreview outer={o.outer} rect={o.rect} widthMm={o.widthMm} depthMm={o.depthMm} />
          ) : (
            <div className="flex aspect-4/3 w-full items-center justify-center rounded-panel border border-dashed border-line bg-viewport p-2 text-center text-caption text-fg-2">{DASH_TEXT.noSite}</div>
          )}
        </Figure>
        <Figure caption={card.recentSheet ? `최근 시트 · ${card.recentSheet}` : "최근 시트 · 없음"}>
          <SheetBox name={card.recentSheet} />
        </Figure>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={titleId} className="truncate text-body font-semibold text-fg">
          {card.name}
        </h3>
        <p className="truncate text-caption text-fg-2">{card.place}</p>
      </div>
      <VerdictBadges verdict={card.verdict} />
      <StageBar done={card.progress.done} current={card.progress.current} next={card.next} />
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-2 text-caption text-fg-2">
        <span className="tabular-nums">
          시트 {card.sheetCount} · <time dateTime={card.updatedAt}>{formatDate(card.updatedAt)}</time>
        </span>
        <StoreChip version={card.version} cloudVersion={card.cloudVersion} />
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onManage(card.id)} aria-label={`${card.name} 관리`}>
            관리
          </Button>
          <Link to={card.openHref} aria-label={`${card.name} 열기`} className="focus-ring inline-flex h-control items-center rounded-control bg-accent px-3 text-caption font-medium text-accent-fg">
            열기
          </Link>
        </span>
      </div>
    </article>
  );
}

/** 카드 자리 로딩(모델 읽는 중). 시간 기반 진행률 없음. */
export function ProjectCardSkeleton({ name }: { name: string }) {
  return (
    <article aria-busy="true" aria-label={`${name} 불러오는 중`} className={CARD}>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="aspect-4/3 w-full" />
        <Skeleton className="aspect-4/3 w-full" />
      </div>
      <p className="truncate text-body font-semibold text-fg">{name}</p>
      <Skeleton className="h-4 w-2/3" />
    </article>
  );
}

/* ---------- 오른쪽 열 ---------- */

function PanelHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 id={id} className="text-h2 font-semibold text-fg">
        {title}
      </h2>
      {aside}
    </div>
  );
}

const TONE_TEXT: Record<"warn" | "danger" | "info", string> = { warn: "text-warn", danger: "text-danger", info: "text-info" };
const TONE_ICON: Record<"warn" | "danger" | "info", IconName> = { warn: "triangle-alert", danger: "circle-x", info: "info" };

/** 오늘 할 일: 시스템 항목(충돌·열람·폴백, 체크 없음) + 프로젝트별 자동 할 일(체크, 완료 수). */
export function TodoPanel({
  system,
  todos,
  done,
  onToggle,
  onConflict,
}: {
  system: readonly TodayItem[];
  todos: readonly ProjectTodo[];
  done: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
  onConflict: () => void;
}) {
  const id = useId();
  const doneCount = todos.filter((t) => done.has(t.key)).length;
  return (
    <section aria-labelledby={id} className={CARD}>
      <PanelHead id={id} title={DASH_TEXT.todoTitle} aside={todos.length > 0 ? <span className="text-caption text-fg-2 tabular-nums" aria-label={`완료 ${doneCount}개 / 전체 ${todos.length}개`}>{doneCount} / {todos.length}</span> : null} />
      {system.length === 0 && todos.length === 0 ? (
        <p className="flex items-center gap-2 text-body text-fg-2">
          <Icon name="circle-check" className="text-ok" />
          {DASH_TEXT.todoEmpty}
        </p>
      ) : null}
      {system.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {system.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 border-b border-line pb-2">
              <p className="flex items-center gap-2 text-body font-medium text-fg">
                <Icon name={TONE_ICON[item.tone]} className={TONE_TEXT[item.tone]} />
                {item.title}
              </p>
              <p className="text-caption text-fg-2">{item.detail}</p>
              {item.to ? (
                <Link to={item.to} className="focus-ring self-start rounded-sm text-caption text-info underline">
                  {item.action}
                </Link>
              ) : item.id === "conflict" ? (
                <Button size="sm" className="self-start" onClick={onConflict}>
                  {item.action}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {todos.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {todos.map((t) => (
            <li key={t.key} className="flex items-start gap-2">
              <Checkbox
                checked={done.has(t.key)}
                onChange={(e) => onToggle(t.key, e.currentTarget.checked)}
                aria-label={`${t.title} 완료`}
                label={<span className="sr-only">{t.title}</span>}
                className="mt-0.5"
              />
              <span className={`flex min-w-0 flex-1 flex-col ${done.has(t.key) ? "text-fg-3 line-through" : ""}`}>
                <Link to={t.to} className="focus-ring rounded-sm text-body text-fg hover:underline">
                  {t.title}
                </Link>
                <span className="text-caption text-fg-2">{t.detail}</span>
              </span>
              {t.badge ? (
                <Badge tone={t.tone === "danger" ? "danger" : "warn"} icon={TONE_ICON[t.tone]}>
                  {t.badge}
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CreditCard({ view }: { view: CreditView }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={CARD}>
      <PanelHead
        id={id}
        title="크레딧"
        aside={
          <Link to="/credits" className="focus-ring rounded-sm text-caption text-info underline">
            충전
          </Link>
        }
      />
      {view.status === "loading" ? <Skeleton className="h-4 w-1/2" /> : null}
      {view.status === "unavailable" ? <p className="text-body text-fg-2">{view.reason}</p> : null}
      {view.status === "ready" ? (
        <>
          <p className="flex items-baseline justify-between text-body text-fg-2">
            <span>잔액{view.snapshot.example ? " [예시]" : ""}</span>
            <span>
              <b className="text-h1 font-semibold text-fg tabular-nums">{view.snapshot.balance}</b> 크레딧
            </span>
          </p>
          <Progress value={usagePercent(view.snapshot)} label={`이번 달 사용 ${view.snapshot.monthUsed} 크레딧`} />
          {view.snapshot.usage.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-caption text-fg-2">
              {view.snapshot.usage.map((u) => (
                <li key={u.label} className="flex justify-between tabular-nums">
                  <span>
                    {u.label} {u.times}회
                  </span>
                  <span>{u.credits}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {view.stale ? <p className="text-caption text-fg-2">기준 시각 {formatDate(view.snapshot.asOf)} (마지막으로 받은 값)</p> : null}
        </>
      ) : null}
      <p className="flex items-center gap-2 text-caption font-medium text-fg">
        <Icon name="coins" className="text-fg-3" />
        {ZERO_CREDIT_TEXT}
      </p>
    </section>
  );
}

export function CloudActivityCard({ cloudNote }: { cloudNote: string | null }) {
  const cloudId = useId();
  const actId = useId();
  return (
    <section className={CARD} aria-labelledby={cloudId}>
      <PanelHead id={cloudId} title={DASH_TEXT.cloudTitle} />
      <p className="text-body text-fg-2">{cloudNote ?? DASH_TEXT.cloudNotConnected}</p>
      <h2 id={actId} className="text-h2 font-semibold text-fg">
        {DASH_TEXT.activityTitle}
      </h2>
      <p className="text-body text-fg-2">{DASH_TEXT.activityEmpty}</p>
    </section>
  );
}

export function RevisionCard({ fallback }: { fallback: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={CARD}>
      <PanelHead id={id} title={DASH_TEXT.revisionTitle} />
      {fallback ? (
        <>
          <p className="flex items-start gap-2 text-body text-fg">
            <Icon name="info" className="mt-0.5 shrink-0 text-info" />
            {DASH_TEXT.revisionFallback}
          </p>
          <Link to="/license" className="focus-ring self-start rounded-sm text-caption text-info underline">
            업데이트 연장 보기
          </Link>
        </>
      ) : (
        <p className="text-body text-fg-2">{DASH_TEXT.revisionEmpty}</p>
      )}
    </section>
  );
}
