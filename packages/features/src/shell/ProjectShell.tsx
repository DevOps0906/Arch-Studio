// 프로젝트 화면 = 통합 작업공간 셸(03장 9.2~9.4절, AR-06-081. 8.4절 상단 탭 8개를 대체).
// 위에서 아래: 상단 바(☰·← 프로젝트·이름·저장 상태·온라인·크레딧·라이선스·화면 행동·다음 단계) → 6단계 막대(고정, 6단계 아래 렌더·제안서·검토 하위 탭)
// → 열람 모드 배너 → 본문(화면 높이 전체, 페이지 스크롤 없음: <Workspace> 화면은 본문을 꽉 채우고, 아직 슬롯이 없는 화면은 본문 안에서만 스크롤)
// → 먹색 상태줄(왼쪽은 화면 슬롯, 오른쪽 판정 요약·엔진·규칙 팩·판정 소요). GNB는 AppShell이 레일로 접고(768~), ~767은 ☰ 서랍.
// 단계 전환은 같은 레이아웃 라우트 안의 자식 경로 이동이라 셸·판정 요약·패널 접힘이 남고 URL만 바뀐다(뒤로 가기 가능).
import { Banner, cn } from "@arch-studio/ui";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router";
import { HeaderStatus, useShellStatus } from "./AppShell.tsx";
import { useCapabilities, useEntitlement, useOnline } from "./context.tsx";
import { bridgeErrorText } from "./errors.ts";
import { ShellIcon } from "./icons.tsx";
import { DENY_TEXT, PROJECT_TABS, lockOf, type ProjectTab } from "./nav.ts";
import { ProjectProvider, useProject } from "./project.tsx";
import { EmptyBlock, ErrorState, LoadingState } from "./states.tsx";
import { NO_SCROLLBAR, VerdictCounts, WorkspaceContext, type WorkspaceContextValue } from "./Workspace.tsx";
import { INITIAL_WORKSPACE, NEXT_STEP, WORKSPACE_STAGES, saveRecentProject, segmentOf, stageHref, stageOf, workspaceReducer, type WorkspaceStage, type WorkspaceVerdict } from "./workspace.ts";

/** 편집 권리: 설치형 desktop_edit(로컬 라이선스 파일), 웹 web_edit(서버) — ADR-001 4.7. 플랫폼 이름 대신 capabilities로 고른다. */
function useEditDecision() {
  const { by } = useCapabilities();
  return useEntitlement(by("localProjects", "desktop_edit", "web_edit"));
}

function ReadOnlyBanner() {
  const decision = useEditDecision();
  if (!decision || decision.allowed) return null;
  return (
    <Banner tone="warn" title="열람 모드: 편집하려면 라이선스나 구독이 필요합니다">
      {DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람·내보내기는 그대로 됩니다.
    </Banner>
  );
}

/* ---------- 6단계 막대 ---------- */
function StageLink({ stage, projectId, current, verdict }: { stage: WorkspaceStage; projectId: string; current: boolean; verdict: WorkspaceVerdict | null }) {
  const fail = stage.id === "model" && verdict ? verdict.fail : 0;
  return (
    <li className="shrink-0">
      <Link
        to={stageHref(projectId, stage.segments[0] ?? "")}
        aria-current={current ? "page" : undefined}
        aria-label={`${stage.n}단계 ${stage.label}${fail > 0 ? `, 기준 초과 ${fail}` : ""}`}
        className={cn(
          "focus-ring -mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-body whitespace-nowrap transition-colors",
          current ? "border-fg font-semibold text-fg" : "border-transparent text-fg-2 hover:text-fg",
        )}
      >
        <span aria-hidden="true" className={cn("inline-flex size-5 items-center justify-center rounded-full border text-caption tabular-nums", current ? "border-fg bg-fg text-bg" : "border-fg-3")}>
          {stage.n}
        </span>
        {/* ~767은 현재 단계만 이름(9.4절) */}
        <span aria-hidden="true" className={current ? undefined : "hidden md:inline"}>
          {stage.label}
        </span>
        {fail > 0 ? (
          <span aria-hidden="true" className="text-caption font-semibold text-danger tabular-nums">
            초과 {fail}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/** 6단계(렌더·제안서) 하위 탭: 렌더 · 제안서 · 검토. 클라우드 탭이라 오프라인·권리 잠금을 숨기지 않고 표시한다. */
function SubTab({ tab, projectId, active }: { tab: ProjectTab; projectId: string; active: boolean }) {
  const online = useOnline();
  const lock = lockOf(tab, online, useEntitlement(tab.feature));
  const hint = lock.kind === "offline" ? "오프라인" : lock.kind === "locked" ? `잠김: ${lock.reason}` : null;
  return (
    <li className="shrink-0">
      <Link
        to={stageHref(projectId, tab.segment)}
        aria-current={active ? "page" : undefined}
        aria-label={hint ? `${tab.label} (${hint})` : undefined}
        title={hint ?? undefined}
        className={cn(
          "focus-ring inline-flex h-control-sm items-center gap-1.5 rounded-control px-3 text-body whitespace-nowrap",
          active ? "bg-raised font-semibold text-fg" : "text-fg-2 hover:text-fg",
        )}
      >
        {tab.label}
        {lock.kind !== "open" ? <ShellIcon name={lock.kind === "offline" ? "wifi-off" : "lock"} className="size-3.5 text-fg-3" /> : null}
      </Link>
    </li>
  );
}

const OUTPUT_TABS = PROJECT_TABS.filter((t) => t.segment === "render" || t.segment === "proposal" || t.segment === "review");

function ProjectFrame() {
  const { id, load, reload } = useProject();
  const { pathname } = useLocation();
  const { saveLabel, openNav } = useShellStatus();
  const decision = useEditDecision();
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_WORKSPACE);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const [statusEl, setStatusEl] = useState<HTMLElement | null>(null);
  const segment = segmentOf(pathname);
  const stage = stageOf(segment);
  const next = segment ? NEXT_STEP[segment] ?? null : null;
  const name = load.status === "ready" ? load.record.name : load.status === "loading" ? "불러오는 중" : "프로젝트";
  const readOnly = decision !== undefined && !decision.allowed;
  const ctx = useMemo<WorkspaceContextValue>(() => ({ state, dispatch, readOnly, actionsEl, statusEl }), [state, readOnly, actionsEl, statusEl]);
  const verdict = state.verdict;

  // 최근 연 프로젝트(GNB 작업공간 메뉴, 9.5절). 화면 표시 값이고 권한을 정하지 않는다.
  useEffect(() => {
    if (load.status === "ready") saveRecentProject(load.record.id);
  }, [load]);

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 상단 바 */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg px-2 md:px-3">
          <button
            type="button"
            onClick={openNav}
            aria-label="메뉴 열기"
            aria-haspopup="dialog"
            className="focus-ring inline-flex size-control shrink-0 items-center justify-center rounded-control text-fg-2 hover:bg-raised md:hidden"
          >
            <ShellIcon name="menu" className="size-5" />
          </button>
          <Link to="/projects" aria-label="프로젝트 목록" className="focus-ring hidden shrink-0 items-center gap-1 rounded-control px-1 text-caption text-info hover:underline md:inline-flex">
            <ShellIcon name="chevron-left" className="size-3.5" />
            프로젝트
          </Link>
          {/* 페이지 제목(h1)은 각 화면(Workspace 또는 PageHeader)이 갖는다. 여기는 맥락 표시. */}
          <p className="min-w-0 truncate text-body font-semibold text-fg md:text-h2">{name}</p>
          {saveLabel ? <span className="hidden shrink-0 rounded-control border border-line px-2 text-caption text-fg-2 md:inline">{saveLabel}</span> : null}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {/* 태블릿 이하는 화면 행동·다음 단계 자리를 위해 온라인·잔액·라이선스를 숨긴다(9.4절 크레딧 숨김, 오프라인은 GNB 배지로 보인다) */}
            <span className="hidden shrink-0 xl:flex">
              <HeaderStatus saveLabel={null} />
            </span>
            {/* 화면 행동(저장·내보내기). 좁은 폭에서는 이 줄만 가로로 밀린다(다음 단계 버튼은 항상 보임). */}
            <div ref={setActionsEl} className={cn("flex min-w-0 items-center gap-2 overflow-x-auto p-1", NO_SCROLLBAR)} />
            {next ? (
              <Link
                to={stageHref(id, next.segment)}
                className="focus-ring inline-flex h-control shrink-0 items-center gap-1 rounded-control bg-accent px-3 text-body font-medium text-accent-fg hover:opacity-90"
              >
                <span className="hidden md:inline">{next.label}</span>
                <span className="md:hidden">다음</span>
                <ShellIcon name="chevron-right" className="size-3.5" />
              </Link>
            ) : null}
          </div>
        </header>

        {/* 6단계 막대(고정) */}
        <nav aria-label="작업 단계" className={cn("shrink-0 overflow-x-auto border-b border-line bg-surface", NO_SCROLLBAR)}>
          <ol className="flex px-1 md:px-2">
            {WORKSPACE_STAGES.map((s) => (
              <StageLink key={s.id} stage={s} projectId={id} current={stage?.id === s.id} verdict={verdict} />
            ))}
          </ol>
        </nav>
        {stage?.id === "output" ? (
          <nav aria-label="렌더·제안서 하위 탭" className={cn("shrink-0 overflow-x-auto border-b border-line bg-surface px-2 py-1", NO_SCROLLBAR)}>
            <ul className="flex gap-1">
              {OUTPUT_TABS.map((t) => (
                <SubTab key={t.id} tab={t} projectId={id} active={segment === t.segment} />
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="shrink-0 empty:hidden">
          <ReadOnlyBanner />
        </div>

        {/* 본문: <Workspace>는 absolute로 꽉 채우고, 그 밖의 화면은 이 안에서만 스크롤 */}
        <div className="relative min-h-0 flex-1 overflow-y-auto p-3 md:p-pad">
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

        {/* 먹색 상태줄 */}
        <footer className="flex h-control-sm shrink-0 items-center gap-4 overflow-hidden bg-fg px-3 text-caption whitespace-nowrap text-bg tabular-nums">
          <div ref={setStatusEl} className="flex min-w-0 flex-1 items-center gap-x-4 overflow-hidden" />
          <div className="flex shrink-0 items-center gap-4">
            <span className="sr-only">판정 요약</span>
            <VerdictCounts verdict={verdict} tone="ink" />
            {/* 태블릿 이하는 엔진·규칙 팩을 숨긴다(9.4절) */}
            <span className="hidden xl:inline">
              엔진 {verdict?.engine ?? "-"} · 규칙 팩 {verdict?.rulePack ?? "-"} · {verdict?.judgeMs ?? "-"}
            </span>
          </div>
        </footer>
      </div>
    </WorkspaceContext.Provider>
  );
}

/** `/projects/:id` 레이아웃 라우트. 단계 화면은 useProject()로 열린 프로젝트를 읽는다. */
export function ProjectShell() {
  const { id = "" } = useParams();
  return (
    <ProjectProvider id={id}>
      {/* key: 다른 프로젝트로 가면 작업공간 상태(판정 요약·패널 접힘)를 새로 만든다(이전 프로젝트 값이 남지 않게). */}
      <ProjectFrame key={id} />
    </ProjectProvider>
  );
}
