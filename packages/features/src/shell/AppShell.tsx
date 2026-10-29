// 앱 셸(DASHBOARD_PATTERNS A, 03장 8장, D-31·D-32·D-34). 왼쪽 GNB + 상단 바 + 페이지 슬롯.
// 반응형 3구간(tokens.css --breakpoint-md 768 · --breakpoint-xl 1200, DESIGN.md 5.2):
//   ~767      GNB 숨김 → 햄버거 + 왼쪽 서랍(<dialog>)
//   768~1199  64px 아이콘 레일(--sidebar-w-collapsed), 이름은 툴팁
//   1200~     펼침 248px(--sidebar-w). 프로젝트 화면(/projects/:id/*)은 레일로 자동 접힘(D-31 a), 사용자가 접을 수도 있다.
// 설치형 창은 최소 1024px(tauri.conf)라 서랍 구간은 웹 스튜디오(071)·좁은 창 스크린샷용이다.
import { Badge, LicenseStatusBadge, OfflineIndicator, cn, formatInt, type LicenseStatus } from "@arch-studio/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { useDemoMode, useDisplayPrefs, useEntitlement, useEntitlementStatus, useOnline, useSession } from "./context.tsx";
import { decideRoute } from "./guard.ts";
import { ShellIcon } from "./icons.tsx";
import { NAV_GROUP_LABEL, NAV_ITEMS, isActive, lockOf, projectIdOf, type NavGroup, type NavItem } from "./nav.ts";
import { FullScreenLoading } from "./states.tsx";
import { licenseBadgeOf } from "./entitlement-state.ts";

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
            <ul key={g} aria-label={label ?? undefined} className="flex flex-col gap-1">
              {label ? (
                <li aria-hidden="true" className={cn("px-3 pt-2 text-caption font-medium text-fg-3", expandable || onNavigate ? (onNavigate ? "" : "hidden xl:block") : "hidden")}>
                  {label}
                </li>
              ) : null}
              {body(g).map((item) => (
                <NavEntry key={item.id} item={item} pathname={pathname} expandable={expandable} onNavigate={onNavigate} />
              ))}
            </ul>
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
function HeaderStatus({ saveLabel }: { saveLabel: string | null }) {
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
  const status = useMemo(() => ({ saveLabel, setSaveLabel }), [saveLabel]);

  // 경로가 바뀌면 서랍을 닫는다.
  useEffect(() => setDrawer(false), [pathname]);

  return (
    <ShellStatusContext.Provider value={status}>
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
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-gap p-3 outline-none md:p-pad xl:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ShellStatusContext.Provider>
  );
}
