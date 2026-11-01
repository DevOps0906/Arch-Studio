// 앱 셸(DASHBOARD_PATTERNS A, 03장 8장, D-31·D-32·D-34). 왼쪽 GNB + 상단 바 + 페이지 슬롯.
// 반응형 3구간(tokens.css --breakpoint-md 768 · --breakpoint-xl 1200, DESIGN.md 5.2):
//   ~767      GNB 숨김 → 햄버거 + 왼쪽 서랍(<dialog>)
//   768~1199  64px 아이콘 레일(--sidebar-w-collapsed), 이름은 툴팁
//   1200~     펼침 248px(--sidebar-w). 프로젝트 화면(/projects/:id/*)은 레일로 자동 접힘(D-31 a), 사용자가 접을 수도 있다.
// 설치형 창은 최소 1024px(tauri.conf)라 서랍 구간은 웹 스튜디오(071)·좁은 창 스크린샷용이다.
// 프로젝트 화면은 통합 작업공간(03장 9장)이라 이 상단 바 대신 ProjectShell의 상단 바를 쓰고 본문 여백·페이지 스크롤이 없다.
import { Badge, Dialog, LicenseStatusBadge, OfflineIndicator, cn, formatInt, type LicenseStatus } from "@arch-studio/ui";
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useAdapters, useCapabilities, useDemoMode, useDisplayPrefs, useEntitlement, useEntitlementStatus, useOnline, useSession } from "./context.tsx";
import { decideRoute } from "./guard.ts";
import { ShellIcon } from "./icons.tsx";
import { NAV_GROUP_LABEL, NAV_ITEMS, isActive, lockOf, projectIdOf, type NavGroup, type NavItem } from "./nav.ts";
import { FullScreenLoading } from "./states.tsx";
import { licenseBadgeOf } from "./entitlement-state.ts";
import {
  P1_AVAILABLE,
  WORKSPACE_MENU,
  loadRecentProject,
  segmentOf,
  stageHref,
  workspaceMenuTarget,
  type ProjectBrief,
  type WorkspaceMenuItem,
  type WorkspaceMenuTarget,
} from "./workspace.ts";

/* ---------- 라우트 가드 ---------- */
/** 루트 레이아웃: 008 상태기계로 /login·/onboarding 이동을 정한다. */
export function AuthGate() {
  const { state, booting } = useSession();
  const { pathname } = useLocation();
  const d = decideRoute(state, pathname, booting);
  if (d.kind === "redirect") return <Navigate to={d.to} replace />;
  if (d.kind === "loading") return <FullScreenLoading />;
  return (
    <>
      <DemoRibbon />
      <Outlet />
    </>
  );
}

/** 데모 데이터 모드 표시(개발 빌드 전용 — 릴리스 번들에는 데모 모듈이 없다). */
function DemoRibbon() {
  const demo = useDemoMode();
  if (!demo) return null;
  return (
    <div role="note" className="fixed right-2 bottom-2 z-50 rounded-control border border-warn bg-surface px-2 py-1 text-caption font-medium text-warn shadow-pop">
      데모 데이터 · 개발 전용
    </div>
  );
}

/* ---------- 상단 바 저장 상태 슬롯 ---------- */
interface ShellStatusValue {
  readonly saveLabel: string | null;
  /** 프로젝트 화면이 저장 상태 문구(03장 5.1절 "이 PC에만 저장됨 · 서버에 없음" 등)를 올린다. 화면을 떠나면 null. */
  setSaveLabel(label: string | null): void;
  /** GNB 서랍 열기(~767). 프로젝트 작업공간 상단 바의 ☰가 쓴다. */
  openNav(): void;
}
const ShellStatusContext = createContext<ShellStatusValue | null>(null);

export function useShellStatus(): ShellStatusValue {
  const v = useContext(ShellStatusContext);
  if (!v) throw new Error("useShellStatus는 AppShell 안에서만 쓴다.");
  return v;
}

/* ---------- GNB ---------- */
function NavEntry({ item, pathname, expandable, onNavigate }: { item: NavItem; pathname: string; expandable: boolean; onNavigate?: () => void }) {
  const online = useOnline();
  const decision = useEntitlement(item.feature);
  const lock = lockOf(item, online, decision);
  const active = isActive(item, pathname);
  const hint = lock.kind === "offline" ? "오프라인" : lock.kind === "locked" ? `잠김: ${lock.reason}` : null;
  return (
    <li>
      <Link
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={hint ? `${item.label} (${hint})` : item.label}
        className={cn(
          "group focus-ring relative flex min-h-10 items-center gap-3 rounded-control px-3 text-body text-fg-2 transition-colors hover:bg-raised hover:text-fg",
          active && "bg-raised font-semibold text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-full before:bg-accent",
        )}
      >
        <span className="relative inline-flex">
          <ShellIcon name={item.icon} className="size-5" />
          {lock.kind !== "open" ? (
            <ShellIcon name={lock.kind === "offline" ? "wifi-off" : "lock"} className="absolute -right-1.5 -bottom-1 size-3 rounded-full bg-nav text-fg-2" />
          ) : null}
        </span>
        {/* 펼침(1200~)에서 보이는 이름 */}
        <span className={cn("min-w-0 flex-1 truncate", expandable ? "hidden xl:inline" : "hidden", onNavigate && "inline!")}>{item.label}</span>
        {hint && (expandable || onNavigate) ? (
          <Badge className={cn(!onNavigate && "hidden xl:inline-flex")}>{lock.kind === "offline" ? "오프라인" : "잠김"}</Badge>
        ) : null}
        {/* 레일(768~1199·접힘)에서 호버·포커스 툴팁(8.6절) */}
        {!onNavigate ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-1/2 left-full z-40 ml-2 hidden -translate-y-1/2 rounded-control bg-fg px-2 py-1 text-caption whitespace-nowrap text-bg shadow-pop group-hover:block group-focus-visible:block",
              expandable && "xl:hidden!",
            )}
          >
            {hint ? `${item.label} · ${hint}` : item.label}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NavList({ pathname, expandable, onNavigate }: { pathname: string; expandable: boolean; onNavigate?: () => void }) {
  const groups: NavGroup[] = ["main", "law"];
  const body = (group: NavGroup) => NAV_ITEMS.filter((i) => i.group === group);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-gap">
      <div className="flex flex-col gap-gap">
        {groups.map((g) => {
          const label = NAV_GROUP_LABEL[g];
          return (
            <Fragment key={g}>
              {/* 묶음 "작업공간"은 프로젝트와 법규 사이(8.3·9.5절) */}
              {g === "law" ? <WorkspaceGroup pathname={pathname} expandable={expandable} onNavigate={onNavigate} /> : null}
              <ul aria-label={label ?? undefined} className="flex flex-col gap-1">
                {label ? <NavGroupLabel label={label} expandable={expandable} onNavigate={onNavigate} /> : null}
                {body(g).map((item) => (
                  <NavEntry key={item.id} item={item} pathname={pathname} expandable={expandable} onNavigate={onNavigate} />
                ))}
              </ul>
            </Fragment>
          );
        })}
      </div>
      {/* 아래 고정: 크레딧 · 라이선스 · 설정(8.3절, D-32 a) */}
      <ul className="flex flex-col gap-1 border-t border-line pt-gap">
        {body("footer").map((item) => (
          <NavEntry key={item.id} item={item} pathname={pathname} expandable={expandable} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

function NavGroupLabel({ label, expandable, onNavigate }: { label: string; expandable: boolean; onNavigate?: () => void }) {
  return (
    <li aria-hidden="true" className={cn("px-3 pt-2 text-caption font-medium text-fg-3", expandable || onNavigate ? (onNavigate ? "" : "hidden xl:block") : "hidden")}>
      {label}
    </li>
  );
}

/* ---------- GNB 작업공간 묶음(9.5절): 모델링 · 평면 · 도면 ---------- */
const WS_ICON: Readonly<Record<WorkspaceMenuItem["segment"], "box" | "pentagon" | "section">> = { model: "box", plans: "pentagon", sheets: "section" };

interface WorkspaceSources {
  readonly projects: readonly ProjectBrief[] | null;
  readonly failed: boolean;
  readonly lastId: string | null;
  retry(): void;
}
/** GNB가 레일·서랍 두 곳에 그려져도 목록은 AppShell에서 한 번만 읽는다. */
const WorkspaceSourcesContext = createContext<WorkspaceSources | null>(null);

/** 프로젝트 목록(이름·최근 수정)과 최근 연 프로젝트. 경로가 바뀔 때마다 다시 읽는다(로컬 목록, 설계 모델 본문 없음). */
function useWorkspaceSources(pathname: string): WorkspaceSources {
  const { projects } = useAdapters();
  const [list, setList] = useState<readonly ProjectBrief[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLastId(loadRecentProject());
    projects.list().then(
      (rows) => {
        if (!alive) return;
        setFailed(false);
        setList(rows.map((r) => ({ id: r.id, name: r.name, siteLabel: r.siteLabel, updatedAt: r.updatedAt })));
      },
      // 읽기 실패는 빈 목록·읽는 중과 따로 둔다(빈 목록으로 보면 "먼저 만드세요"로 잘못 보인다).
      () => {
        if (!alive) return;
        setFailed(true);
        setList(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [projects, pathname, tick]);
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return useMemo(() => ({ projects: list, failed, lastId, retry }), [list, failed, lastId, retry]);
}

function WorkspaceGroup({ pathname, expandable, onNavigate }: { pathname: string; expandable: boolean; onNavigate?: () => void }) {
  const sources = useContext(WorkspaceSourcesContext);
  const { by } = useCapabilities();
  const edit = useEntitlement(by("localProjects", "desktop_edit", "web_edit"));
  const currentProjectId = projectIdOf(pathname);
  const currentSegment = segmentOf(pathname);
  const readOnly = edit !== undefined && !edit.allowed;
  return (
    <ul aria-label="작업공간" className="flex flex-col gap-1">
      <NavGroupLabel label="작업공간" expandable={expandable} onNavigate={onNavigate} />
      {WORKSPACE_MENU.map((item) => (
        <WorkspaceEntry
          key={item.id}
          item={item}
          target={workspaceMenuTarget({
            item,
            currentProjectId,
            currentSegment,
            lastProjectId: sources?.lastId ?? null,
            projects: sources?.projects ?? null,
            listFailed: sources?.failed ?? false,
            p1Available: P1_AVAILABLE,
            readOnly,
          })}
          onRetry={sources?.retry}
          expandable={expandable}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function WorkspaceEntry({
  item,
  target,
  onRetry,
  expandable,
  onNavigate,
}: {
  item: WorkspaceMenuItem;
  target: WorkspaceMenuTarget;
  onRetry?: () => void;
  expandable: boolean;
  onNavigate?: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => setPicking(false), []);
  const disabled = target.kind === "disabled" || target.kind === "pending" || target.kind === "failed";
  const reason = target.kind === "disabled" || target.kind === "failed" ? target.reason : target.kind === "pending" ? "프로젝트 목록을 읽는 중" : null;
  const hint = target.kind === "go" ? target.hint : reason;
  const current = target.kind === "go" && target.current;
  const cls = cn(
    "group focus-ring relative flex min-h-10 w-full items-center gap-3 rounded-control px-3 text-left text-body text-fg-2 transition-colors hover:bg-raised hover:text-fg",
    current && "bg-raised font-semibold text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.75 before:rounded-full before:bg-accent",
    disabled && "cursor-not-allowed text-fg-3 hover:bg-transparent hover:text-fg-3",
  );
  const inner = (
    <>
      <ShellIcon name={WS_ICON[item.segment]} className="size-5" />
      <span className={cn("min-w-0 flex-1 flex-col", expandable ? "hidden xl:flex" : "hidden", onNavigate && "flex!")}>
        <span className="truncate">{item.label}</span>
        {/* 비활성 이유는 메뉴 옆 글자로도 보인다(9.5절) */}
        {reason ? <span className="truncate text-caption font-normal text-fg-3">{reason}</span> : null}
      </span>
      {!onNavigate ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 left-full z-40 ml-2 hidden -translate-y-1/2 rounded-control bg-fg px-2 py-1 text-caption whitespace-nowrap text-bg shadow-pop group-hover:block group-focus-visible:block",
            expandable && !hint && "xl:hidden!",
          )}
        >
          {hint ? `${item.label} · ${hint}` : item.label}
        </span>
      ) : null}
    </>
  );
  const label = hint ? `${item.label} (${hint})` : item.label;
  const pickDone = () => {
    closePicker();
    onNavigate?.();
  };
  return (
    <li className="flex flex-col">
      {target.kind === "go" ? (
        <Link to={target.to} onClick={onNavigate} aria-current={current ? "page" : undefined} aria-label={label} className={cls}>
          {inner}
        </Link>
      ) : target.kind === "pick" ? (
        <button type="button" onClick={() => setPicking(true)} aria-haspopup="dialog" aria-label={`${item.label} (프로젝트 고르기)`} className={cls}>
          {inner}
        </button>
      ) : (
        // 비활성도 포커스는 받는다(aria-disabled, 6.1절 키보드)
        <button type="button" aria-disabled="true" aria-label={label} className={cls}>
          {inner}
        </button>
      )}
      {(target.kind === "disabled" || target.kind === "failed") && target.action && (expandable || onNavigate) ? (
        <span className={cn("ml-11 flex flex-wrap gap-x-3", !onNavigate && "hidden xl:flex")}>
          <Link to={target.action.to} onClick={onNavigate} className="focus-ring rounded-sm text-caption text-info underline">
            {target.action.label}
          </Link>
          {target.kind === "failed" && onRetry ? (
            <button type="button" onClick={onRetry} className="focus-ring rounded-sm text-caption text-info underline">
              다시 시도
            </button>
          ) : null}
        </span>
      ) : null}
      {target.kind === "pick" ? (
        <Dialog open={picking} onClose={closePicker} title="프로젝트 고르기" description={`${item.label}을 열 프로젝트를 고르세요. 최근 수정한 ${target.candidates.length}개입니다.`}>
          <ul className="flex flex-col gap-1">
            {target.candidates.map((c) => (
              <li key={c.id}>
                <Link to={stageHref(c.id, item.segment)} onClick={pickDone} className="focus-ring flex min-h-10 flex-col justify-center rounded-control px-3 py-1 text-body text-fg hover:bg-raised">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="truncate text-caption text-fg-2">
                    {c.siteLabel ?? "대지 미입력"} · 수정 {c.updatedAt.slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/projects" onClick={pickDone} className="focus-ring mt-gap inline-flex rounded-sm text-body text-info underline">
            모든 프로젝트 보기
          </Link>
        </Dialog>
      ) : null}
    </li>
  );
}

/** ~767 서랍. 네이티브 <dialog>(포커스 가둠·Esc 닫기). ui Sheet는 오른쪽 고정이라 왼쪽 서랍을 여기 둔다(ui 부족 목록). */
function NavDrawer({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
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
      aria-label="주 메뉴"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-0 h-dvh max-h-dvh w-(--sidebar-w) max-w-full bg-nav p-pad text-fg shadow-pop backdrop:bg-overlay"
    >
      <nav aria-label="주 메뉴" className="flex h-full flex-col gap-gap">
        <div className="flex items-center justify-between">
          <span className="text-h2 font-semibold">Arch Studio</span>
          <button type="button" onClick={onClose} aria-label="메뉴 닫기" className="focus-ring inline-flex size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised">
            <ShellIcon name="x" />
          </button>
        </div>
        <NavList pathname={pathname} expandable onNavigate={onClose} />
      </nav>
    </dialog>
  );
}

/* ---------- 상단 바 ---------- */
/** 상단 바 오른쪽 상태. 프로젝트 작업공간 상단 바도 같이 쓴다(1200~에서만). */
export function HeaderStatus({ saveLabel }: { saveLabel: string | null }) {
  const online = useOnline();
  const { state } = useSession();
  const status = useEntitlementStatus();
  const session = state.kind === "ready" ? state.session : null;
  const badge: LicenseStatus | null = licenseBadgeOf(status?.state, session?.plan_code ?? null);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {saveLabel ? <span className="hidden truncate text-caption text-fg-2 xl:inline">{saveLabel}</span> : null}
      <span className="hidden md:inline-flex">
        <OfflineIndicator online={online} />
      </span>
      {/* 잔액: 로그인·온라인일 때만 숫자(8.2절), 아니면 "-" */}
      <span className="hidden text-caption text-fg-2 md:inline">
        잔액 <span className="text-num font-medium text-fg tabular-nums">{session && online ? formatInt(session.credit_balance) : "-"}</span>
      </span>
      <Link to="/license" className="focus-ring inline-flex rounded-sm" aria-label="라이선스 상태 보기">
        {badge ? <LicenseStatusBadge status={badge} /> : <Badge>라이선스 미확인</Badge>}
      </Link>
    </div>
  );
}

/** 셸 레이아웃(인증된 경로의 부모 라우트). */
export function AppShell() {
  const { pathname } = useLocation();
  const { prefs, update } = useDisplayPrefs();
  const [drawer, setDrawer] = useState(false);
  const [saveLabel, setSaveLabel] = useState<string | null>(null);
  const inProject = projectIdOf(pathname) !== null;
  const expandable = !inProject && !prefs.gnbCollapsed;
  const openNav = useCallback(() => setDrawer(true), []);
  const wsSources = useWorkspaceSources(pathname);
  const status = useMemo(() => ({ saveLabel, setSaveLabel, openNav }), [saveLabel, openNav]);

  // 경로가 바뀌면 서랍을 닫는다.
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <ShellStatusContext.Provider value={status}>
      <WorkspaceSourcesContext.Provider value={wsSources}>
      <div className="flex min-h-dvh bg-bg text-fg">
        <a href="#main" className="focus-ring sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
          본문으로 건너뛰기
        </a>
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-nav p-2 md:flex",
            "w-(--sidebar-w-collapsed)",
            expandable && "xl:w-(--sidebar-w) xl:p-3",
          )}
        >
          <nav aria-label="주 메뉴" className="flex min-h-0 flex-1 flex-col gap-gap">
            <Link to="/projects" aria-label="Arch Studio 홈" className="focus-ring flex h-control items-center gap-2 rounded-control px-3 font-semibold text-fg">
              <span aria-hidden="true" className="text-h2">A</span>
              <span className={cn("truncate text-body", expandable ? "hidden xl:inline" : "hidden")}>Arch Studio</span>
            </Link>
            <NavList pathname={pathname} expandable={expandable} />
          </nav>
        </aside>
        <NavDrawer open={drawer} onClose={() => setDrawer(false)} pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col">
          {!inProject ? (
          <header className="sticky top-0 z-30 flex h-(--gnb-h) items-center gap-2 border-b border-line bg-bg/95 px-3 md:px-pad">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="메뉴 열기"
              aria-haspopup="dialog"
              className="focus-ring inline-flex size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised md:hidden"
            >
              <ShellIcon name="menu" className="size-5" />
            </button>
            {!inProject ? (
              <button
                type="button"
                onClick={() => update({ gnbCollapsed: !prefs.gnbCollapsed })}
                aria-label={prefs.gnbCollapsed ? "메뉴 펼치기" : "메뉴 접기"}
                aria-pressed={prefs.gnbCollapsed}
                className="focus-ring hidden size-control items-center justify-center rounded-control text-fg-2 hover:bg-raised xl:inline-flex"
              >
                <ShellIcon name={prefs.gnbCollapsed ? "chevron-right" : "chevron-left"} />
              </button>
            ) : null}
            <span className="truncate font-semibold md:hidden">Arch Studio</span>
            {/* 검색 = 명령 팔레트(6.1절 Ctrl+K). 팔레트 구현 전이라 비활성 + 이유 */}
            <button
              type="button"
              disabled
              title="명령 팔레트는 준비 중입니다"
              className="hidden h-control min-w-0 items-center gap-2 rounded-control border border-input bg-surface px-3 text-caption text-fg-3 disabled:cursor-not-allowed md:inline-flex"
            >
              <ShellIcon name="search" />
              <span className="truncate">메뉴·프로젝트 검색</span>
              <kbd className="font-mono text-caption">Ctrl+K</kbd>
            </button>
            <div className="ml-auto flex min-w-0 items-center">
              <HeaderStatus saveLabel={saveLabel} />
            </div>
          </header>
          ) : null}
          <main
            id="main"
            tabIndex={-1}
            className={cn("flex min-w-0 flex-1 flex-col outline-none", inProject ? "h-dvh min-h-0 overflow-hidden" : "gap-gap p-3 md:p-pad xl:p-6")}
          >
            <Outlet />
          </main>
        </div>
      </div>
      </WorkspaceSourcesContext.Provider>
    </ShellStatusContext.Provider>
  );
}
