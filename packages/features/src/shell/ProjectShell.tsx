// 프로젝트 화면 셸(03장 8.4절, D-31 a): GNB는 AppShell이 64px 레일로 접고, 여기서 "← 프로젝트" · 프로젝트 이름 · 상단 탭 8개.
// 탭은 같은 프로젝트 경로로 이동하는 링크다(ARIA tabs 아님 → aria-current). 좁은 폭은 가로 스크롤(nav.ts PROJECT_TABS 주석).
import { Banner, cn } from "@arch-studio/ui";
import { Link, Outlet, useLocation, useParams } from "react-router";
import { useCapabilities, useEntitlement, useOnline } from "./context.tsx";
import { ShellIcon } from "./icons.tsx";
import { DENY_TEXT, PROJECT_TABS, lockOf, type ProjectTab } from "./nav.ts";
import { ProjectProvider, useProject } from "./project.tsx";
import { EmptyBlock, ErrorState, LoadingState } from "./states.tsx";
import { bridgeErrorText } from "./errors.ts";

function TabLink({ tab, base, active }: { tab: ProjectTab; base: string; active: boolean }) {
  const online = useOnline();
  const lock = lockOf(tab, online, useEntitlement(tab.feature));
  const hint = lock.kind === "offline" ? "오프라인" : lock.kind === "locked" ? `잠김: ${lock.reason}` : null;
  return (
    <li className="shrink-0">
      <Link
        to={`${base}/${tab.segment}`}
        aria-current={active ? "page" : undefined}
        aria-label={hint ? `${tab.label} (${hint})` : undefined}
        title={hint ?? undefined}
        className={cn(
          "focus-ring -mb-px inline-flex h-control items-center gap-1.5 border-b-2 px-3 text-body whitespace-nowrap transition-colors",
          active ? "border-fg font-semibold text-fg" : "border-transparent text-fg-2 hover:text-fg",
        )}
      >
        {tab.label}
        {lock.kind !== "open" ? <ShellIcon name={lock.kind === "offline" ? "wifi-off" : "lock"} className="size-3.5 text-fg-3" /> : null}
      </Link>
    </li>
  );
}

/** 편집 권리: 설치형 desktop_edit(로컬 라이선스 파일), 웹 web_edit(서버) — ADR-001 4.7. 플랫폼 이름 대신 capabilities로 고른다. */
function ReadOnlyBanner() {
  const { by } = useCapabilities();
  const decision = useEntitlement(by("localProjects", "desktop_edit", "web_edit"));
  if (!decision || decision.allowed) return null;
  return (
    <Banner tone="warn" title="열람 모드: 편집하려면 라이선스나 구독이 필요합니다">
      {DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람·내보내기는 그대로 됩니다.
    </Banner>
  );
}

function ProjectFrame() {
  const { id, load, reload } = useProject();
  const { pathname } = useLocation();
  const base = `/projects/${encodeURIComponent(id)}`;
  const name = load.status === "ready" ? load.record.name : load.status === "loading" ? "불러오는 중" : "프로젝트";
  return (
    <div className="flex min-w-0 flex-col gap-gap">
      <div className="flex min-w-0 flex-col gap-1 border-b border-line xl:flex-row xl:items-end xl:gap-gap">
        <div className="flex min-w-0 items-center gap-2 pb-1 xl:pb-2">
          <Link to="/projects" className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-control text-caption text-info hover:underline">
            <ShellIcon name="chevron-left" className="size-3.5" />
            프로젝트
          </Link>
          {/* 페이지 제목(h1)은 각 탭 화면의 PageHeader가 갖는다. 여기는 맥락 표시. */}
          <p className="min-w-0 truncate text-h2 font-semibold text-fg">{name}</p>
        </div>
        <nav aria-label="프로젝트 탭" className="min-w-0 overflow-x-auto">
          <ul className="flex">
            {PROJECT_TABS.map((tab) => (
              <TabLink key={tab.id} tab={tab} base={base} active={pathname === `${base}/${tab.segment}` || pathname.startsWith(`${base}/${tab.segment}/`)} />
            ))}
          </ul>
        </nav>
      </div>
      <ReadOnlyBanner />
      {load.status === "loading" ? (
        <LoadingState label="프로젝트를 여는 중" />
      ) : load.status === "missing" ? (
        <EmptyBlock
          icon="inbox"
          title="프로젝트를 찾지 못했습니다"
          description="삭제되었거나 이 PC에 없는 프로젝트입니다. 목록에서 다시 여세요."
          action={
            <Link to="/projects" className="focus-ring text-body text-info underline">
              프로젝트 목록
            </Link>
          }
        />
      ) : load.status === "error" ? (
        <ErrorState title="프로젝트를 열지 못했습니다" description={bridgeErrorText({ name: "BridgeError", code: load.code })} onRetry={reload} />
      ) : (
        <Outlet />
      )}
    </div>
  );
}

/** `/projects/:id` 레이아웃 라우트. 탭 화면은 useProject()로 열린 프로젝트를 읽는다. */
export function ProjectShell() {
  const { id = "" } = useParams();
  return (
    <ProjectProvider id={id}>
      <ProjectFrame />
    </ProjectProvider>
  );
}
