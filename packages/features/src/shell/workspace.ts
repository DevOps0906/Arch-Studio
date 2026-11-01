// 통합 작업공간 순수 로직(03장 9.2~9.5절, AR-06-081): 6단계 막대·다음 단계·판정 요약 공유·GNB 작업공간 메뉴 대상 판정.
// 화면 코드는 이 표를 바꾸지 않는다(셸 소유). 판정 수는 judgment/model.ts의 같은 함수(buildRows·countStatuses)로 센다 —
// 판정 패널 머리·좁은 화면 요약과 같은 수가 나오도록. (judgment/index.ts는 shell을 import해서 순환이 생기므로 순수 파일만 쓴다.)
import { buildRows, countStatuses, type JudgmentData } from "../judgment/model.ts";

/** 6단계 막대(9.2절). '검토'는 6단계(렌더·제안서)의 하위 탭(팀장 결정 2026-11-02, 8.4절 미정 해소). */
export interface WorkspaceStage {
  readonly id: "site" | "model" | "program" | "plans" | "sheets" | "output";
  readonly n: number;
  readonly label: string;
  /** /projects/:id/ 뒤 경로. 첫 값이 단계 막대 링크 대상. */
  readonly segments: readonly string[];
}

export const WORKSPACE_STAGES: readonly WorkspaceStage[] = [
  { id: "site", n: 1, label: "대지", segments: ["site"] },
  { id: "model", n: 2, label: "모델·판정", segments: ["model"] },
  { id: "program", n: 3, label: "프로그램", segments: ["program"] },
  { id: "plans", n: 4, label: "평면", segments: ["plans"] },
  { id: "sheets", n: 5, label: "도면", segments: ["sheets"] },
  { id: "output", n: 6, label: "렌더·제안서", segments: ["render", "proposal", "review"] },
];

/** 경로 → 현재 경로 조각(site·model·…·review). 프로젝트 밖·탭 없음이면 null. */
export function segmentOf(pathname: string): string | null {
  const m = /^\/projects\/[^/]+\/([^/]+)/.exec(pathname);
  return m?.[1] ?? null;
}

export function stageOf(segment: string | null): WorkspaceStage | null {
  if (!segment) return null;
  return WORKSPACE_STAGES.find((s) => s.segments.includes(segment)) ?? null;
}

export function stageHref(projectId: string, segment: string): string {
  return `/projects/${encodeURIComponent(projectId)}/${segment}`;
}

/** 상단 바 다음 단계 버튼(9.2절 표: 모델 "다음: 평면", 평면 "다음: 도면 만들기", 도면 "다음: 렌더·제안서"). 없으면 null. */
export const NEXT_STEP: Readonly<Record<string, { readonly label: string; readonly segment: string } | null>> = {
  site: { label: "다음: 모델·판정", segment: "model" },
  model: { label: "다음: 평면", segment: "plans" },
  program: { label: "다음: 평면", segment: "plans" },
  plans: { label: "다음: 도면 만들기", segment: "sheets" },
  sheets: { label: "다음: 렌더·제안서", segment: "render" },
  render: { label: "다음: 제안서", segment: "proposal" },
  proposal: { label: "다음: 검토", segment: "review" },
  review: null,
};

/* ---------- 판정 요약 공유(9.3절: 막대·패널·상태줄 모든 단계에서 같은 값) ---------- */
export interface WorkspaceVerdict {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly unverified: number;
  readonly engine: string | null;
  readonly rulePack: string | null;
  readonly judgeMs: string | null;
}

/** 판정 결과 → 요약(순수). 판정 패널 머리 요약과 같은 함수로 센다. */
export function verdictOf(data: JudgmentData | null): WorkspaceVerdict | null {
  if (!data) return null;
  const c = countStatuses(buildRows(data).quant);
  return {
    ...c,
    engine: data.result.engine_version ?? null,
    rulePack: data.result.rule_pack_version ?? null,
    judgeMs: data.elapsedMs === null || data.elapsedMs === undefined ? null : `${Math.round(data.elapsedMs)}ms`,
  };
}

export interface WorkspaceState {
  /** 마지막으로 판정한 화면의 요약. 단계를 바꿔도 남는다(판정하지 않는 단계는 이 값을 보인다). 프로젝트가 바뀌면 셸이 새로 만든다. */
  readonly verdict: WorkspaceVerdict | null;
  /** 오른쪽 적층 패널 접힘(단계를 바꿔도 유지). */
  readonly dockCollapsed: boolean;
  /** 패널 절 펼침(절 id → 펼침). 없으면 절의 기본값. */
  readonly sections: Readonly<Record<string, boolean>>;
}

export type WorkspaceAction =
  | { readonly type: "verdict"; readonly verdict: WorkspaceVerdict | null }
  | { readonly type: "toggleDock" }
  | { readonly type: "section"; readonly id: string; readonly open: boolean }
  /** 패널을 펼치고 그 절을 연다(예: 압출 → 속성 절의 층고 입력). */
  | { readonly type: "reveal"; readonly id: string };

export const INITIAL_WORKSPACE: WorkspaceState = Object.freeze({ verdict: null, dockCollapsed: false, sections: Object.freeze({}) });

/**
 * 작업공간 상태(순수). 프로젝트 레이아웃 라우트에 한 번 있어 단계(자식 경로)를 바꿔도 남는다.
 * verdict null은 "판정 없음"(매스 없음·판정 오류·판정하지 않음)이라 지운다. "판정 중"은 게시하지 않는다(verdictAction).
 */
export function workspaceReducer(s: WorkspaceState, a: WorkspaceAction): WorkspaceState {
  switch (a.type) {
    case "verdict":
      if (a.verdict === null) return s.verdict === null ? s : { ...s, verdict: null };
      return sameVerdict(s.verdict, a.verdict) ? s : { ...s, verdict: a.verdict };
    case "toggleDock":
      return { ...s, dockCollapsed: !s.dockCollapsed };
    case "section":
      return s.sections[a.id] === a.open ? s : { ...s, sections: { ...s.sections, [a.id]: a.open } };
    case "reveal":
      return !s.dockCollapsed && s.sections[a.id] === true ? s : { ...s, dockCollapsed: false, sections: { ...s.sections, [a.id]: true } };
  }
}

/**
 * 판정 화면의 상태 → 셸에 올릴 행동(순수). active = 이 화면이 지금 판정하려는가(매스 있음·입력 충족).
 * - active가 아니면 판정 없음(지움). 판정 오류도 지움(옛 값을 남기지 않는다).
 * - 판정 중(loading)·요청 직전(idle)은 아무것도 올리지 않는다(이전 값 유지 → 단계 전환 중 깜박임 없음).
 */
export function verdictAction(phase: "idle" | "loading" | "ready" | "error", data: JudgmentData | null, active: boolean): WorkspaceAction | null {
  if (!active || phase === "error") return { type: "verdict", verdict: null };
  if (phase === "ready" && data) return { type: "verdict", verdict: verdictOf(data) };
  return null;
}

function sameVerdict(a: WorkspaceVerdict | null, b: WorkspaceVerdict): boolean {
  return a !== null && a.pass === b.pass && a.warn === b.warn && a.fail === b.fail && a.unverified === b.unverified && a.engine === b.engine && a.rulePack === b.rulePack && a.judgeMs === b.judgeMs;
}

/* ---------- GNB 작업공간 메뉴(9.5절) ---------- */
export interface WorkspaceMenuItem {
  readonly id: "ws-model" | "ws-plans" | "ws-sheets";
  readonly label: string;
  readonly segment: "model" | "plans" | "sheets";
  /** 평면은 P1 기능. */
  readonly p1: boolean;
}

export const WORKSPACE_MENU: readonly WorkspaceMenuItem[] = [
  { id: "ws-model", label: "모델링", segment: "model", p1: false },
  { id: "ws-plans", label: "평면", segment: "plans", p1: true },
  { id: "ws-sheets", label: "도면", segment: "sheets", p1: false },
];

/**
 * P1(평면) 기능이 이 빌드에 있는가. 평면 편집기(AR-06-027)가 들어 있어 지금은 true다.
 * 빌드별로 끄는 장치(기능 플래그)는 아직 없다 — 생기면 여기서 읽는다(팀장 확인 필요).
 */
export const P1_AVAILABLE = true;

export interface ProjectBrief {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  /** ISO 8601. */
  readonly updatedAt: string;
}

export interface WorkspaceMenuInput {
  readonly item: WorkspaceMenuItem;
  /** 지금 열린 프로젝트(프로젝트 안 경로). */
  readonly currentProjectId: string | null;
  /** 현재 경로 조각(현재 위치 표시용). */
  readonly currentSegment: string | null;
  /** 최근 연 프로젝트(화면 표시 값, 권한을 정하지 않는다). */
  readonly lastProjectId: string | null;
  /** 프로젝트 목록. 읽는 중이면 null. */
  readonly projects: readonly ProjectBrief[] | null;
  /** 목록을 읽지 못했다(빈 목록·읽는 중과 구분). */
  readonly listFailed: boolean;
  readonly p1Available: boolean;
  /** 편집 권리 거부(체험만료·구독만료). 메뉴는 열리고 그 단계가 열람 모드로 열린다. */
  readonly readOnly: boolean;
}

export type WorkspaceMenuTarget =
  | { readonly kind: "go"; readonly to: string; readonly current: boolean; readonly hint: string | null }
  | { readonly kind: "pick"; readonly candidates: readonly ProjectBrief[] }
  | { readonly kind: "disabled"; readonly reason: string; readonly action: { readonly label: string; readonly to: string } | null }
  | { readonly kind: "pending" }
  /** 목록 읽기 실패: 다시 시도하거나 프로젝트 목록 화면으로. */
  | { readonly kind: "failed"; readonly reason: string; readonly action: { readonly label: string; readonly to: string } };

export const PICK_LIMIT = 5;
export const NO_PROJECT_TEXT = "프로젝트를 먼저 만드세요";
export const NO_P1_TEXT = "다음 버전에서 제공합니다";
export const LIST_FAILED_TEXT = "프로젝트 목록을 읽지 못했습니다";
const READ_ONLY_HINT = "열람 모드로 열립니다";

/** 최근 수정 순 상위 5개(같은 시각이면 이름순 — 결과가 입력 순서에 기대지 않게). */
export function recentProjects(projects: readonly ProjectBrief[], limit = PICK_LIMIT): readonly ProjectBrief[] {
  return [...projects].sort((a, b) => (a.updatedAt === b.updatedAt ? a.name.localeCompare(b.name, "ko") : a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

/** 9.5절 표의 6상황 → 메뉴 대상(순수). */
export function workspaceMenuTarget(input: WorkspaceMenuInput): WorkspaceMenuTarget {
  const { item, currentProjectId, currentSegment, lastProjectId, projects, listFailed, p1Available, readOnly } = input;
  if (item.p1 && !p1Available) return { kind: "disabled", reason: NO_P1_TEXT, action: null };
  const roHint = readOnly ? READ_ONLY_HINT : null;
  if (currentProjectId) {
    return { kind: "go", to: stageHref(currentProjectId, item.segment), current: currentSegment === item.segment, hint: roHint };
  }
  if (listFailed) return { kind: "failed", reason: LIST_FAILED_TEXT, action: { label: "프로젝트 목록으로 가기", to: "/projects" } };
  if (projects === null) return { kind: "pending" };
  if (projects.length === 0) return { kind: "disabled", reason: NO_PROJECT_TEXT, action: { label: "새 프로젝트", to: "/projects" } };
  const last = lastProjectId ? projects.find((p) => p.id === lastProjectId) : undefined;
  if (last) {
    const hint = `${last.name}에서 열기`;
    return { kind: "go", to: stageHref(last.id, item.segment), current: false, hint: roHint ? `${hint} · ${roHint}` : hint };
  }
  return { kind: "pick", candidates: recentProjects(projects) };
}

/* ---------- 최근 연 프로젝트(화면 표시 값) ---------- */
type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const RECENT_KEY = "arch.workspace.recent.v1";
const storage = (): StorageLike | null => {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
};

/** 저장 문자열 → 프로젝트 id. 모르는 값은 null(신뢰하지 않는다). */
export function parseRecent(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown };
    return typeof v.id === "string" && v.id.length > 0 && v.id.length <= 64 ? v.id : null;
  } catch {
    return null;
  }
}

export function loadRecentProject(): string | null {
  try {
    return parseRecent(storage()?.getItem(RECENT_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveRecentProject(id: string): void {
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify({ id }));
  } catch {
    // 표시 값이라 실패해도 무시한다.
  }
}
