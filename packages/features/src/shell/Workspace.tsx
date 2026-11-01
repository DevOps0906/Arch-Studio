// 통합 작업공간 슬롯(03장 9.2·9.4절, AR-06-081). 프로젝트 셸(ProjectShell)이 상단 바·6단계 막대·상태줄을 그리고,
// 각 단계 화면은 <Workspace>에 도구 레일·왼쪽 목록·캔버스·오른쪽 적층 패널·층/시트 탭·상태줄 내용을 넘긴다.
// 3구간(JS로 한 곳에만 그린다 — 같은 패널을 두 번 마운트하면 입력 id가 겹치고 상태가 갈라진다):
//   1200~     레일 · 목록 · 캔버스 · 패널 4열(패널 접으면 띠 폭만)
//   768~1199  레일 · 캔버스 · 패널 3열, 목록은 탭 줄 [목록] 버튼으로 여는 왼쪽 서랍
//   ~767      캔버스 전면, 레일은 탭 줄 아래 가로 도구줄(끝에 [속성·판정] 버튼 → 아래 시트 최대 70%), 목록은 왼쪽 서랍 85%
// 치수는 9.8절 후보 토큰을 아직 채택하지 않아 기존 --spacing 배수 유틸리티(w-12·w-60·w-72·w-80·h-10)만 쓴다.
import { cn } from "@arch-studio/ui";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { JudgmentData } from "../judgment/model.ts";
import { ShellIcon } from "./icons.tsx";
import { verdictAction, type WorkspaceAction, type WorkspaceState, type WorkspaceVerdict } from "./workspace.ts";

/* ---------- 맥락 ---------- */
export interface WorkspaceContextValue {
  readonly state: WorkspaceState;
  readonly dispatch: Dispatch<WorkspaceAction>;
  /** 편집 권리 거부(열람 모드): 도구 레일을 숨긴다(9.2절). 다음 단계 버튼은 남긴다. */
  readonly readOnly: boolean;
  /** 상단 바의 화면 행동 자리·상태줄 왼쪽 자리(ProjectShell이 만든 요소). */
  readonly actionsEl: HTMLElement | null;
  readonly statusEl: HTMLElement | null;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function useWorkspaceContext(): WorkspaceContextValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("Workspace는 /projects/:id 아래 화면에서만 쓴다.");
  return v;
}

/**
 * 판정하는 화면(모델·평면·도면)이 최신 판정을 셸에 올린다. 막대·패널 띠·상태줄이 모든 단계에서 같은 값을 보인다(9.3절).
 * active = 지금 판정하려는가(매스 있음·입력 충족). 아니면 판정 없음으로 지우고, 판정 중이면 이전 값을 둔다(verdictAction).
 */
export function useWorkspaceJudgment(judgment: { readonly phase: "idle" | "loading" | "ready" | "error"; readonly data: JudgmentData | null }, active: boolean): void {
  const ws = useContext(WorkspaceContext);
  const dispatch = ws?.dispatch;
  const { phase, data } = judgment;
  useEffect(() => {
    const a = verdictAction(phase, data, active);
    if (dispatch && a) dispatch(a);
  }, [dispatch, phase, data, active]);
}

/** 패널을 펼치고 절을 연다. 다음 프레임에 그 안 요소에 포커스를 줄 수 있다(예: 압출 → 층고 입력). */
export function useWorkspaceReveal(): (sectionId: string, focusId?: string) => void {
  const dispatch = useContext(WorkspaceContext)?.dispatch;
  return useCallback(
    (sectionId: string, focusId?: string) => {
      dispatch?.({ type: "reveal", id: sectionId });
      if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
    },
    [dispatch],
  );
}

/* ---------- 화면 폭 구간 ---------- */
export type WorkspaceLayout = "narrow" | "medium" | "wide";

function readBreakpoint(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 지금 구간(경계는 토큰 --breakpoint-md·xl). */
export function useWorkspaceLayout(): WorkspaceLayout {
  const of = (w: number, md: number, xl: number): WorkspaceLayout => (w >= xl ? "wide" : w >= md ? "medium" : "narrow");
  const [kind, setKind] = useState<WorkspaceLayout>(() => (typeof window === "undefined" ? "wide" : of(window.innerWidth, readBreakpoint("--breakpoint-md", 768), readBreakpoint("--breakpoint-xl", 1200))));
  useEffect(() => {
    const md = readBreakpoint("--breakpoint-md", 768);
    const xl = readBreakpoint("--breakpoint-xl", 1200);
    const update = () => setKind(of(window.innerWidth, md, xl));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return kind;
}

/* ---------- 판정 수 ---------- */
/** 판정 수 글자(초과·확인·통과). 상태색은 글자와 함께. tone="ink"는 먹색 상태줄 위(반전 글자). */
export function VerdictCounts({ verdict, tone = "panel", vertical = false }: { verdict: WorkspaceVerdict | null; tone?: "panel" | "ink"; vertical?: boolean }) {
  if (!verdict) return <span className={cn("text-caption", tone === "ink" ? "text-bg" : "text-fg-3")}>판정 전</span>;
  const items = [
    { key: "fail", label: "초과", n: verdict.fail, cls: tone === "ink" ? "font-semibold text-bg" : "font-semibold text-danger" },
    { key: "warn", label: "확인", n: verdict.warn, cls: tone === "ink" ? "text-bg" : "text-warn" },
    { key: "pass", label: "통과", n: verdict.pass, cls: tone === "ink" ? "text-bg" : "text-ok" },
    // 규칙 팩 수치가 없어 모두 미확인이면 0·0·0만 보이지 않도록 미확인 수를 덧붙인다.
    ...(verdict.unverified > 0 ? [{ key: "unverified", label: "미확인", n: verdict.unverified, cls: tone === "ink" ? "text-bg" : "text-fg-2" }] : []),
  ];
  return (
    <span className={cn("inline-flex gap-x-3 gap-y-1 text-caption tabular-nums", vertical ? "flex-col items-center text-center" : "flex-wrap items-center")}>
      {items.map((i) => (
        <span key={i.key} className={i.cls}>
          {vertical ? (
            <>
              {i.label}
              <br />
              {i.n}
            </>
          ) : (
            `${i.label} ${i.n}`
          )}
        </span>
      ))}
    </span>
  );
}

/* ---------- 서랍·아래 시트(네이티브 <dialog>: 포커스 가둠·Esc 닫기) ---------- */
function WsDialog({ open, onClose, label, side, children }: { open: boolean; onClose: () => void; label: string; side: "left" | "bottom"; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cn(
        "bg-surface p-0 text-fg shadow-pop backdrop:bg-overlay",
        side === "left" ? "m-0 h-dvh max-h-dvh w-[85vw] max-w-sm border-r border-line md:w-80" : "mx-0 mt-auto mb-0 max-h-[70dvh] w-full max-w-full rounded-t-panel border-t border-line",
      )}
    >
      <div className="flex h-10 items-center justify-between gap-2 border-b border-line px-3">
        <span className="text-body font-semibold">{label}</span>
        <button type="button" onClick={onClose} aria-label={`${label} 닫기`} className="focus-ring inline-flex size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised">
          <ShellIcon name="x" />
        </button>
      </div>
      {/* 열려 있을 때만 그린다(데스크톱 자리와 동시에 마운트하지 않는다). */}
      <div className="overflow-y-auto p-3">{open ? children : null}</div>
    </dialog>
  );
}

/* ---------- 작업공간 ---------- */
export interface WorkspacePanel {
  readonly id: string;
  readonly title: string;
  readonly content: ReactNode;
  /** 기본 펼침(판정 절은 항상 펼침으로 시작, 9.2절). 기본 true. */
  readonly defaultOpen?: boolean;
  /** 절 머리 오른쪽 요약(예: 판정 수). */
  readonly badge?: ReactNode;
}

export interface WorkspaceProps {
  /** 화면 제목(h1 하나, 화면에는 6단계 막대가 같은 이름을 보인다). */
  readonly title: string;
  readonly description?: string;
  /** 상단 바 오른쪽(다음 단계 버튼 앞)에 놓을 화면 행동(저장·내보내기 등). */
  readonly actions?: ReactNode;
  readonly rail?: ReactNode;
  readonly railLabel?: string;
  readonly list?: ReactNode;
  readonly listTitle?: string;
  readonly canvas: ReactNode;
  readonly canvasLabel?: string;
  /** 캔버스 위 알림 줄(충돌·저장 실패·잠금 안내 등). */
  readonly notices?: ReactNode;
  readonly panels?: readonly WorkspacePanel[];
  readonly panelsTitle?: string;
  /** 캔버스 아래 층·시트 탭. */
  readonly tabs?: ReactNode;
  /** 먹색 상태줄 왼쪽 내용(좌표·축척·스냅 등). 오른쪽 판정 요약·엔진·규칙 팩은 셸이 그린다. */
  readonly status?: ReactNode;
  /** 떠 있는 것(토스트·대화상자). */
  readonly children?: ReactNode;
}

/** 슬롯에 넣은 기존 구성요소의 카드 테두리·첫 제목을 지운다(절 머리·목록 머리가 제목). 제목은 스크린리더용으로 남긴다. */
const BARE = "[&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none [&>section>h2:first-child]:sr-only [&>section>div:first-child>h2]:sr-only";
/** 넘치는 가로 줄의 브라우저 기본 스크롤바(화살표) 숨김. 휠·터치·키보드 스크롤은 그대로. */
export const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const toolBtn = "focus-ring inline-flex h-control-sm shrink-0 items-center gap-1 rounded-control border border-line bg-surface px-2 text-caption text-fg hover:bg-raised";

export function Workspace(p: WorkspaceProps) {
  const ws = useWorkspaceContext();
  const kind = useWorkspaceLayout();
  const panels = p.panels ?? [];
  const panelsTitle = p.panelsTitle ?? (panels.map((x) => x.title).join(" · ") || "패널");
  const listTitle = p.listTitle ?? "목록";
  const [listOpen, setListOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const baseId = useId();
  const showRail = p.rail !== undefined && p.rail !== null && !ws.readOnly;
  const collapsed = ws.state.dockCollapsed;
  const verdict = ws.state.verdict;

  // 패널 접기 단축키 `]`(9.2절). 입력칸·수정키 조합·화면이 이미 쓴 키(평면 편집기의 [ ] 변 고르기)는 건드리지 않는다.
  const hasDock = panels.length > 0 && kind !== "narrow";
  const dispatch = ws.dispatch;
  useEffect(() => {
    if (!hasDock) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "]" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest("dialog"))) return;
      e.preventDefault();
      dispatch({ type: "toggleDock" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasDock, dispatch]);

  // 패널을 접고 펼친 뒤 포커스를 반대 버튼으로 옮긴다(누른 버튼이 사라지므로). 첫 렌더는 건드리지 않는다.
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const prevCollapsed = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    (collapsed ? expandRef : collapseRef).current?.focus();
  }, [collapsed]);

  // 구간이 바뀌면 서랍·시트를 닫는다(데스크톱 자리로 돌아간다).
  useEffect(() => {
    setListOpen(false);
    setSheetOpen(false);
  }, [kind]);

  const sections = panels.map((panel) => {
    const isOpen = ws.state.sections[panel.id] ?? panel.defaultOpen ?? true;
    const bodyId = `${baseId}-${panel.id}`;
    return (
      <section key={panel.id} className="border-b border-line">
        <h2 className="m-0">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => ws.dispatch({ type: "section", id: panel.id, open: !isOpen })}
            className="focus-ring flex min-h-10 w-full items-center gap-2 px-3 text-left text-body font-semibold text-fg hover:bg-raised"
          >
            <ShellIcon name={isOpen ? "chevron-down" : "chevron-right"} className="size-3.5 text-fg-3" />
            <span className="min-w-0 flex-1 truncate">{panel.title}</span>
            {panel.badge}
          </button>
        </h2>
        <div id={bodyId} hidden={!isOpen} className={cn("min-w-0 px-3 pb-3", BARE)}>
          {panel.content}
        </div>
      </section>
    );
  });

  const listButton =
    p.list !== undefined && kind !== "wide" ? (
      <button type="button" onClick={() => setListOpen(true)} aria-haspopup="dialog" className={toolBtn}>
        <ShellIcon name="menu" className="size-3.5" />
        {listTitle}
      </button>
    ) : null;

  const sheetButton =
    panels.length > 0 && kind === "narrow" ? (
      <button type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" className={cn(toolBtn, "ml-auto")}>
        {panelsTitle}
        {verdict && verdict.fail > 0 ? <span className="font-semibold text-danger tabular-nums">초과 {verdict.fail}</span> : null}
      </button>
    ) : null;

  return (
    <div data-workspace="" className="absolute inset-0 flex min-w-0">
      <h1 className="sr-only">{p.title}</h1>
      {p.description ? <p className="sr-only">{p.description}</p> : null}
      {p.actions && ws.actionsEl ? createPortal(p.actions, ws.actionsEl) : null}
      {p.status && ws.statusEl ? createPortal(p.status, ws.statusEl) : null}

      {showRail && kind !== "narrow" ? (
        <div role="group" aria-label={p.railLabel ?? "도구"} className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line bg-surface py-2">
          {p.rail}
        </div>
      ) : null}

      {p.list !== undefined && kind === "wide" ? (
        <aside aria-label={listTitle} className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
          <p className="flex h-10 shrink-0 items-center border-b border-line px-3 text-caption font-medium text-fg-2">{listTitle}</p>
          <div className={cn("min-h-0 flex-1 overflow-y-auto p-3", BARE)}>{p.list}</div>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {p.notices ? <div className="flex max-h-40 shrink-0 flex-col gap-2 overflow-y-auto border-b border-line bg-bg p-2">{p.notices}</div> : null}
        <div role="region" aria-label={p.canvasLabel ?? p.title} className="relative min-h-0 flex-1 overflow-auto bg-viewport">
          {p.canvas}
        </div>
        {p.tabs !== undefined || listButton || (sheetButton && !showRail) ? (
          <div className={cn("flex min-h-10 shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-surface px-2", NO_SCROLLBAR)}>
            {listButton}
            {p.tabs}
            {showRail ? null : sheetButton}
          </div>
        ) : null}
        {kind === "narrow" && showRail ? (
          <div role="group" aria-label={p.railLabel ?? "도구"} className="flex min-h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-surface px-2">
            {p.rail}
            {sheetButton}
          </div>
        ) : null}
      </div>

      {panels.length > 0 && kind !== "narrow" && collapsed ? (
        <aside aria-label={panelsTitle} className="flex w-12 shrink-0 flex-col items-center gap-3 border-l border-line bg-surface py-2">
          <button
            type="button"
            ref={expandRef}
            onClick={() => ws.dispatch({ type: "toggleDock" })}
            aria-expanded={false}
            aria-label={`${panelsTitle} 펼치기 (])`}
            aria-keyshortcuts="]"
            className="focus-ring inline-flex size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised"
          >
            <ShellIcon name="chevron-left" />
          </button>
          <VerdictCounts verdict={verdict} vertical />
        </aside>
      ) : null}
      {/* 접어도 패널 내용은 마운트한 채 숨긴다(입력 상태·포커스 대상 유지). */}
      {panels.length > 0 && kind !== "narrow" ? (
        <aside aria-label={panelsTitle} hidden={collapsed} className="flex w-72 shrink-0 flex-col border-l border-line bg-surface xl:w-80">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line pl-3">
            <span className="min-w-0 truncate text-caption font-medium text-fg-2">{panelsTitle}</span>
            <button
              type="button"
              ref={collapseRef}
              onClick={() => ws.dispatch({ type: "toggleDock" })}
              aria-expanded
              aria-label={`${panelsTitle} 접기 (])`}
              aria-keyshortcuts="]"
              className="focus-ring inline-flex size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised"
            >
              <ShellIcon name="chevron-right" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{sections}</div>
        </aside>
      ) : null}

      {p.list !== undefined && kind !== "wide" ? (
        <WsDialog open={listOpen} onClose={() => setListOpen(false)} label={listTitle} side="left">
          <div className={BARE}>{p.list}</div>
        </WsDialog>
      ) : null}
      {panels.length > 0 && kind === "narrow" ? (
        <WsDialog open={sheetOpen} onClose={() => setSheetOpen(false)} label={panelsTitle} side="bottom">
          <div className="-mx-3 -mt-3">{sections}</div>
        </WsDialog>
      ) : null}
      {p.children}
    </div>
  );
}
