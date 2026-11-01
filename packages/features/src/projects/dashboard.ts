// /projects 대시보드 순수 로직(03장 3.3절, AR-06-082): 프로젝트 카드 사실·6단계 진척·다음 할 일·정렬·요약 4칸·오늘 할 일.
// 근거가 있는 값만 만든다. 판정 스냅샷·시트 생성 시각처럼 조회 경로가 없는 값은 null로 두고 화면이 빈 상태 문구를 보인다(0 표시 금지).
// 기하는 만들지 않는다: 대지 경계는 저장된 모델 좌표를 geometry normalizePolygon·minAreaRect로 정리·측정만 한다(표시 전용).
import { formatAreaM2, type DesignModelV1, type Point, type SheetSpec } from "@arch-studio/domain";
import { area, minAreaRect, normalizePolygon } from "@arch-studio/geometry";
import { sheetName } from "../sheets/model.ts";
import { WORKSPACE_STAGES, stageHref, type WorkspaceStage } from "../shell/workspace.ts";

/** 프로젝트 마지막 판정 요약(셸이 판정을 게시할 때 남긴 값, shell/workspace.ts). example=true면 데모 [예시] 값. */
export interface VerdictFacts {
  readonly pass: number;
  readonly warn: number;
  readonly fail: number;
  readonly example: boolean;
  /** 판정 시각(ISO 8601). 데모 [예시]는 null. */
  readonly at?: string | null;
}

/** 카드 썸네일용 대지 경계(정규화된 외곽 + 최소 면적 회전 직사각형). */
export interface SiteOutline {
  readonly outer: readonly Point[];
  readonly rect: readonly [Point, Point, Point, Point];
  readonly widthMm: number;
  readonly depthMm: number;
  readonly areaText: string;
}

export interface StageProgress {
  /** 단계별 완료(WORKSPACE_STAGES 순서). 렌더·제안서는 조회 경로가 없어 항상 false. */
  readonly done: readonly boolean[];
  /** 첫 미완료 단계(앞 5단계를 모두 마치면 렌더·제안서). */
  readonly current: WorkspaceStage;
}

export interface CardInput {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  readonly updatedAt: string;
  readonly version: number;
  readonly cloudVersion: number | null | undefined;
  /** 모델을 읽지 못했으면(열기 실패·형식 오류) null. */
  readonly model: DesignModelV1 | null;
  readonly sheets: readonly SheetSpec[];
  readonly verdict: VerdictFacts | null;
  /** 이 프로젝트에서 마지막으로 연 단계 경로 조각(site·model·…·review). 없으면 null. */
  readonly lastStage?: string | null;
}

export interface ProjectCardView {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string | null;
  /** 대지 라벨·용도지역 한 줄(같은 용도지역을 두 번 쓰지 않는다). */
  readonly place: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly cloudVersion: number | null | undefined;
  readonly outline: SiteOutline | null;
  readonly sheetCount: number;
  /** 최근 시트 이름(목록 마지막 시트). 없으면 null. */
  readonly recentSheet: string | null;
  readonly verdict: VerdictFacts | null;
  readonly progress: StageProgress;
  readonly next: string;
  readonly openHref: string;
}

/** 단계별 다음 할 일 한 줄(근거: 저장된 모델·시트 목록). */
export const STAGE_TODO: Readonly<Record<WorkspaceStage["id"], string>> = {
  site: "대지 경계를 확인하세요",
  model: "매스를 그려 판정하세요",
  program: "실 구성과 면적 목표를 정하세요",
  plans: "평면에 실을 배치하세요",
  sheets: "도면 시트를 만드세요",
  output: "렌더·제안서를 준비하세요",
};

/** 저장된 경계 → 썸네일 값. 경계가 무효(자기교차·면적 0 등)면 null. */
export function siteOutline(model: DesignModelV1 | null): SiteOutline | null {
  if (!model) return null;
  try {
    const poly = normalizePolygon({ outer: model.site.boundary.outer.map((p) => [p[0], p[1]] as Point) });
    const r = minAreaRect(poly);
    return { outer: poly.outer, rect: r.corners, widthMm: r.widthMm, depthMm: r.depthMm, areaText: `${formatAreaM2(area(poly))}㎡` };
  } catch {
    return null;
  }
}

export function stageProgress(model: DesignModelV1 | null, sheetCount: number, outline: SiteOutline | null): StageProgress {
  const done = [
    outline !== null,
    model !== null && model.masses.length > 0,
    model !== null && (model.program.targets.length > 0 || Object.keys(model.program.checklist_answers).length > 0),
    model !== null && model.floor_layouts.some((f) => f.rooms.length > 0),
    sheetCount > 0,
    false,
  ];
  const idx = done.findIndex((d, i) => !d && i < 5);
  const current = WORKSPACE_STAGES[idx === -1 ? 5 : idx] as WorkspaceStage;
  return { done, current };
}

/** 다음 할 일 한 줄: 기준 초과가 있으면 그것부터, 아니면 현재 단계 할 일. */
export function nextTodo(progress: StageProgress, verdict: VerdictFacts | null): string {
  if (verdict && verdict.fail > 0) return `기준 초과 ${verdict.fail}건 해소`;
  return STAGE_TODO[progress.current.id];
}

/** 대지 라벨에 이미 용도지역(끝 "지역" 뺀 이름)이 있으면 덧붙이지 않는다. 둘 다 없으면 "대지 정보 없음". */
export function placeLine(siteLabel: string | null, useDistrict: string | null): string {
  const stem = useDistrict?.replace(/지역$/, "") ?? "";
  const parts = [siteLabel, useDistrict && !(siteLabel ?? "").includes(stem) ? useDistrict : null].filter((x): x is string => !!x);
  return parts.join(" · ") || "대지 정보 없음";
}

export function buildCard(input: CardInput): ProjectCardView {
  const outline = siteOutline(input.model);
  const progress = stageProgress(input.model, input.sheets.length, outline);
  const last = input.sheets[input.sheets.length - 1];
  const failing = input.verdict !== null && input.verdict.fail > 0;
  return {
    id: input.id,
    name: input.name,
    siteLabel: input.siteLabel,
    place: placeLine(input.siteLabel, input.model?.site.zoning.use_district ?? null),
    updatedAt: input.updatedAt,
    version: input.version,
    cloudVersion: input.cloudVersion,
    outline,
    sheetCount: input.sheets.length,
    recentSheet: last ? sheetName(last, input.sheets, input.model) : null,
    verdict: input.verdict,
    progress,
    next: nextTodo(progress, input.verdict),
    openHref: stageHref(input.id, input.lastStage ?? (failing ? "model" : (progress.current.segments[0] as string))),
  };
}

/* ---------- 정렬(초과 많은 순; 검색·저장 위치·최근 수정·이름순은 list-query.ts applyListQuery) ---------- */

export type CardOrder = "updated" | "violations";

const failOf = (c: { verdict: VerdictFacts | null }) => (c.verdict ? c.verdict.fail : -1);
const warnOf = (c: { verdict: VerdictFacts | null }) => (c.verdict ? c.verdict.warn : -1);

/**
 * 최근 수정: 수정 시각 내림차순. 초과 많은 순: 초과 수 → 확인 수 → 수정 시각(판정 기록 없는 카드는 맨 뒤).
 * 같으면 id로 고정(결정적). 새 배열을 돌려준다.
 */
export function sortCards<T extends { readonly id: string; readonly updatedAt: string; readonly verdict: VerdictFacts | null }>(cards: readonly T[], order: CardOrder): T[] {
  return [...cards].sort((a, b) => {
    if (order === "violations") {
      const d = failOf(b) - failOf(a) || warnOf(b) - warnOf(a);
      if (d !== 0) return d;
    }
    const t = b.updatedAt.localeCompare(a.updatedAt);
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/* ---------- 요약 4칸 ---------- */

export interface DashboardSummary {
  readonly active: number;
  /** 판정 기록이 하나도 없으면 null(빈 상태). */
  readonly failItems: number | null;
  readonly failProjects: number;
  /** 판정 값 중 [예시]가 섞였는지. */
  readonly example: boolean;
}

export function summarize(cards: readonly { readonly verdict: VerdictFacts | null }[]): DashboardSummary {
  const judged = cards.flatMap((c) => (c.verdict ? [c.verdict] : []));
  return {
    active: cards.length,
    failItems: judged.length === 0 ? null : judged.reduce((s, v) => s + v.fail, 0),
    failProjects: judged.filter((v) => v.fail > 0).length,
    example: judged.some((v) => v.example),
  };
}

/* ---------- 오늘 할 일(프로젝트별 초과·확인 필요·남은 단계에서 자동 생성) ---------- */

export interface ProjectTodo {
  /** `${projectId}:fail|warn|stage` — 체크 상태 키. */
  readonly key: string;
  readonly tone: "danger" | "warn" | "info";
  readonly title: string;
  readonly detail: string;
  readonly badge: string | null;
  readonly to: string;
}

/** 초과(모든 프로젝트) → 확인 필요 → 남은 단계 순. 카드 순서를 따른다. */
export function projectTodos(cards: readonly ProjectCardView[]): ProjectTodo[] {
  const fails: ProjectTodo[] = [];
  const warns: ProjectTodo[] = [];
  const stages: ProjectTodo[] = [];
  for (const c of cards) {
    const model = stageHref(c.id, "model");
    if (c.verdict && c.verdict.fail > 0) {
      fails.push({ key: `${c.id}:fail`, tone: "danger", title: `${c.name} — 기준 초과 ${c.verdict.fail}건 해소`, detail: "모델·판정", badge: "초과", to: model });
    }
    if (c.verdict && c.verdict.warn > 0) {
      warns.push({ key: `${c.id}:warn`, tone: "warn", title: `${c.name} — 확인 필요 ${c.verdict.warn}건`, detail: "모델·판정", badge: "확인", to: model });
    }
    const s = c.progress.current;
    stages.push({
      key: `${c.id}:stage`,
      tone: "info",
      title: `${c.name} — ${STAGE_TODO[s.id]}`,
      detail: `${s.n}/6 ${s.label}`,
      badge: null,
      to: stageHref(c.id, s.segments[0] as string),
    });
  }
  return [...fails, ...warns, ...stages];
}
