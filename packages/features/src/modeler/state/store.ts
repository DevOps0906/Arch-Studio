// 모델러 상태기계(순수 리듀서). 모델 편집은 명령(commands.ts) → 이력(history.ts)으로만 바뀐다.
// 열람 상태(체험·구독 만료, 화면 폭 768 미만)에서는 편집 동작을 여기서 한 번 더 거부한다(도구 막대 숨김과 별도의 이중 차단, [DECISION] 6절).
// 드래그 중에는 모델을 바꾸지 않고 오프셋(drag)만 바꾼다. 놓을 때(dragEnd) 이동 명령 1개로 기록한다.
// 측정(D)·단면(S)은 화면 표시 상태다(AR-06-084): 이력에 넣지 않으므로 실행 취소 대상이 아니고, 모델(저장 바이트)을 바꾸지 않는다.
// 표시 값(조명·그림자·재질·층 라벨·층 숨김·분해도, AR-06-085)도 같다: display에만 두고 열람 모드에서도 바꿀 수 있다.
import type { Point } from "@arch-studio/domain";
import {
  DEFAULT_FLOOR_HEIGHT,
  addMass,
  deleteMass,
  moveMass,
  setBaseLevel,
  setFloorCount,
  setFloorHeight,
  setFloorUse,
  setRoof,
  type AddMassInput,
  type CommandResult,
  type Mass,
  type Model,
  type RoofType,
} from "./commands.ts";
import { SUGGEST_LABEL, applySuggestion } from "../suggest/apply.ts";
import { measureDistance, measureText, type Measurement, type Point3 } from "../tools/measure.ts";
import { northSection, sectionPlane, type SectionLine } from "../tools/section.ts";
import { DEFAULT_DISPLAY, EXPLODE_MEASURE_TEXT, explodeActive, type DisplaySettings } from "../display/settings.ts";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo, type History } from "./history.ts";

export type Tool = "select" | "draw" | "measure" | "section";
export type CameraMode = "perspective" | "plan" | "section";
/** 레이어 표시 키: 대지·엔벨로프·초과분·매스별(`mass:<id>`). */
export type LayerKey = "site" | "envelope" | "excess" | `mass:${string}`;

export type Command =
  | { readonly type: "add"; readonly input: AddMassInput }
  | { readonly type: "move"; readonly id: string; readonly dx: number; readonly dy: number }
  | { readonly type: "floors"; readonly id: string; readonly count: number }
  | { readonly type: "floorHeight"; readonly id: string; readonly floorId: string | null; readonly height: number }
  | { readonly type: "floorUse"; readonly id: string; readonly floorId: string | null; readonly use: string }
  | { readonly type: "baseLevel"; readonly id: string; readonly value: number }
  | { readonly type: "roof"; readonly id: string; readonly roof: RoofType; readonly pitch?: number }
  | { readonly type: "delete"; readonly id: string }
  /** 매스 자동 제안 적용(AR-06-028): 매스를 후보로 통째로 바꾸는 단일 명령 = 실행 취소 1단계. */
  | { readonly type: "suggest"; readonly masses: readonly Mass[] };

export const COMMAND_LABEL: Readonly<Record<Command["type"], string>> = {
  add: "매스 추가",
  move: "매스 이동",
  floors: "층 수 변경",
  floorHeight: "층고 변경",
  floorUse: "용도 변경",
  baseLevel: "바닥 높이 변경",
  roof: "지붕 변경",
  delete: "매스 삭제",
  suggest: SUGGEST_LABEL,
};

export function runCommand(model: Model, c: Command): CommandResult {
  switch (c.type) {
    case "add":
      return addMass(model, c.input);
    case "move":
      return moveMass(model, c.id, c.dx, c.dy);
    case "floors":
      return setFloorCount(model, c.id, c.count);
    case "floorHeight":
      return setFloorHeight(model, c.id, c.floorId, c.height);
    case "floorUse":
      return setFloorUse(model, c.id, c.floorId, c.use);
    case "baseLevel":
      return setBaseLevel(model, c.id, c.value);
    case "roof":
      return setRoof(model, c.id, c.roof, c.pitch);
    case "delete":
      return deleteMass(model, c.id);
    case "suggest":
      return applySuggestion(model, c.masses);
  }
}

export interface Notice {
  readonly text: string;
  readonly tone: "info" | "warn";
  /** 같은 문구를 다시 알릴 때 라이브 영역이 읽도록 바꾸는 번호. */
  readonly n: number;
}

export interface ModelerState {
  readonly history: History;
  /** 마지막으로 저장(또는 연) 모델. present와 참조가 다르면 저장하지 않은 변경이 있다. */
  readonly saved: Model;
  readonly selection: string | null;
  readonly tool: Tool;
  /** 그리는 중인 바닥 점(mm 정수). */
  readonly draft: readonly Point[];
  readonly draftFloors: number;
  readonly draftFloorHeight: number;
  /** 드래그 중인 매스와 오프셋(mm). 모델에는 놓을 때 반영한다. */
  readonly drag: { readonly id: string; readonly dx: number; readonly dy: number } | null;
  readonly hidden: readonly LayerKey[];
  readonly camera: CameraMode;
  /** 카메라 맞춤 요청 번호(F·뷰 전환 때 증가). */
  readonly fitN: number;
  readonly editable: boolean;
  readonly lockReason: string | null;
  readonly notice: Notice | null;
  /** 판정 패널 "매스 강조". */
  readonly highlight: readonly string[];
  /** 측정 결과(표시 전용, 여러 개 유지). */
  readonly measures: readonly Measurement[];
  /** 측정 첫 점(두 번째 점을 기다리는 중). */
  readonly measureStart: Point3 | null;
  /** 다음 측정 번호. */
  readonly measureN: number;
  /** 단면선(표시 전용 클리핑). */
  readonly section: SectionLine | null;
  /** 단면선 첫 점. */
  readonly sectionDraft: Point | null;
  /** 단면 보기(카메라를 단면선에 직각으로). */
  readonly sectionView: boolean;
  /** 표시 값(저장·실행 취소와 무관, display/settings.ts). */
  readonly display: DisplaySettings;
}

export type Action =
  | { readonly type: "command"; readonly command: Command }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "tool"; readonly tool: Tool }
  | { readonly type: "draftPoint"; readonly point: Point }
  | { readonly type: "draftPop" }
  | { readonly type: "draftCancel" }
  | { readonly type: "draftClose" }
  | { readonly type: "draftDefaults"; readonly floors?: number; readonly floorHeight?: number }
  | { readonly type: "dragStart"; readonly id: string }
  | { readonly type: "dragMove"; readonly dx: number; readonly dy: number }
  | { readonly type: "dragEnd" }
  | { readonly type: "dragCancel" }
  | { readonly type: "toggleLayer"; readonly layer: LayerKey }
  | { readonly type: "camera"; readonly mode: CameraMode }
  | { readonly type: "fit" }
  | { readonly type: "access"; readonly editable: boolean; readonly reason: string | null }
  | { readonly type: "reset"; readonly model: Model }
  | { readonly type: "saved"; readonly model: Model }
  | { readonly type: "highlight"; readonly ids: readonly string[] }
  | { readonly type: "measurePoint"; readonly point: Point3 }
  | { readonly type: "measureCancel" }
  | { readonly type: "measureDelete"; readonly id: number }
  | { readonly type: "measurePop" }
  | { readonly type: "measureClear" }
  | { readonly type: "sectionPoint"; readonly point: Point }
  | { readonly type: "sectionCancel" }
  | { readonly type: "sectionPreset" }
  | { readonly type: "sectionClear" }
  | { readonly type: "sectionView"; readonly on: boolean }
  | { readonly type: "display"; readonly patch: Partial<DisplaySettings> }
  | { readonly type: "notice"; readonly text: string; readonly tone?: Notice["tone"] };

export const LOCKED_DEFAULT = "열람 모드: 편집하려면 라이선스나 구독이 필요합니다.";

export function createModelerState(
  model: Model,
  access: { editable: boolean; reason: string | null } = { editable: true, reason: null },
  display: DisplaySettings = DEFAULT_DISPLAY,
): ModelerState {
  return {
    history: createHistory(model),
    saved: model,
    selection: model.masses[0]?.id ?? null,
    tool: "select",
    draft: [],
    draftFloors: 2,
    draftFloorHeight: DEFAULT_FLOOR_HEIGHT,
    drag: null,
    hidden: [],
    camera: "perspective",
    fitN: 0,
    editable: access.editable,
    lockReason: access.editable ? null : (access.reason ?? LOCKED_DEFAULT),
    notice: null,
    highlight: [],
    measures: [],
    measureStart: null,
    measureN: 1,
    section: null,
    sectionDraft: null,
    sectionView: false,
    display,
  };
}

const EDIT_ACTIONS = new Set<Action["type"]>(["command", "undo", "redo", "draftPoint", "draftClose", "dragStart"]);

function notify(s: ModelerState, text: string, tone: Notice["tone"] = "info"): ModelerState {
  return { ...s, notice: { text, tone, n: (s.notice?.n ?? 0) + 1 } };
}

function keepSelection(s: ModelerState, model: Model): string | null {
  return s.selection !== null && model.masses.some((m) => m.id === s.selection) ? s.selection : null;
}

function applyCommand(s: ModelerState, command: Command): ModelerState {
  const r = runCommand(s.history.present, command);
  if (!r.ok) return notify(s, r.reason, "warn");
  if (r.model === s.history.present) return s;
  const history = pushHistory(s.history, r.model, COMMAND_LABEL[command.type]);
  const selection = r.select !== undefined ? r.select : keepSelection(s, r.model);
  return notify({ ...s, history, selection }, `${COMMAND_LABEL[command.type]}했습니다.`);
}

const TOOL_NOTICE: Readonly<Record<Tool, string>> = {
  select: "선택 도구",
  draw: "매스 그리기: 바닥 꼭짓점을 차례로 찍고 Enter로 닫습니다.",
  measure: "측정: 두 점을 찍습니다(꼭짓점·변·바닥 100mm 스냅). Esc로 끝냅니다.",
  section: "단면: 평면에서 두 점을 찍어 단면선을 정합니다(100mm 격자). Esc로 끝냅니다.",
};

export function modelerReducer(s: ModelerState, a: Action): ModelerState {
  if (!s.editable && EDIT_ACTIONS.has(a.type)) return notify(s, s.lockReason ?? LOCKED_DEFAULT, "warn");
  // 측정·단면은 표시 전용이라 열람 모드에서도 허용(팀장 결정 2026-11-02). 모델을 바꾸는 도구(매스 그리기)만 잠근다.
  if (!s.editable && a.type === "tool" && a.tool === "draw") return notify(s, s.lockReason ?? LOCKED_DEFAULT, "warn");
  switch (a.type) {
    case "command":
      return applyCommand(s, a.command);
    case "undo": {
      if (!canUndo(s.history)) return notify(s, "되돌릴 작업이 없습니다.");
      const { history, label } = undo(s.history);
      return notify({ ...s, history, drag: null, selection: keepSelection(s, history.present) }, `실행 취소: ${label}`);
    }
    case "redo": {
      if (!canRedo(s.history)) return notify(s, "다시 실행할 작업이 없습니다.");
      const { history, label } = redo(s.history);
      return notify({ ...s, history, drag: null, selection: keepSelection(s, history.present) }, `다시 실행: ${label}`);
    }
    case "select": {
      const id = a.id !== null && s.history.present.masses.some((m) => m.id === a.id) ? a.id : null;
      if (id === s.selection) return s;
      const name = id === null ? null : massLabel(s.history.present, id);
      return notify({ ...s, selection: id }, name ? `${name} 선택` : "선택 해제");
    }
    case "tool":
      if (a.tool === s.tool) return s;
      // 분해도 중에는 띄운 판이 모델 위치와 달라 측정을 막는다(층 숨김만이면 허용, 팀장 결정 2026-11-02).
      if (a.tool === "measure" && explodeActive(s.history.present, s.display)) return notify(s, EXPLODE_MEASURE_TEXT, "warn");
      return notify({ ...s, tool: a.tool, draft: [], drag: null, measureStart: null, sectionDraft: null }, TOOL_NOTICE[a.tool]);
    case "draftPoint": {
      if (s.tool !== "draw") return s;
      const last = s.draft[s.draft.length - 1];
      if (last && last[0] === a.point[0] && last[1] === a.point[1]) return s;
      return { ...s, draft: [...s.draft, a.point] };
    }
    case "draftPop":
      return s.draft.length === 0 ? s : { ...s, draft: s.draft.slice(0, -1) };
    case "draftCancel":
      return s.draft.length === 0 ? s : notify({ ...s, draft: [] }, "그리기를 취소했습니다.");
    case "draftClose": {
      if (s.draft.length < 3) return notify(s, "꼭짓점을 3개 이상 찍어야 매스를 만들 수 있습니다.", "warn");
      const next = applyCommand(s, { type: "add", input: { outer: s.draft, floors: s.draftFloors, floorHeight: s.draftFloorHeight } });
      if (next.history === s.history) return next; // 실패: 그리던 점은 남긴다
      return { ...next, draft: [], tool: "select" };
    }
    case "draftDefaults":
      return { ...s, draftFloors: a.floors ?? s.draftFloors, draftFloorHeight: a.floorHeight ?? s.draftFloorHeight };
    case "dragStart":
      if (!s.history.present.masses.some((m) => m.id === a.id)) return s;
      return { ...s, selection: a.id, drag: { id: a.id, dx: 0, dy: 0 } };
    case "dragMove":
      if (!s.drag || (s.drag.dx === a.dx && s.drag.dy === a.dy)) return s;
      return { ...s, drag: { ...s.drag, dx: a.dx, dy: a.dy } };
    case "dragEnd": {
      if (!s.drag) return s;
      const { id, dx, dy } = s.drag;
      const cleared = { ...s, drag: null };
      if (dx === 0 && dy === 0) return cleared;
      return applyCommand(cleared, { type: "move", id, dx, dy });
    }
    case "dragCancel":
      return s.drag ? { ...s, drag: null } : s;
    case "toggleLayer": {
      const hidden = s.hidden.includes(a.layer) ? s.hidden.filter((k) => k !== a.layer) : [...s.hidden, a.layer];
      return { ...s, hidden };
    }
    case "camera":
      return { ...s, camera: a.mode, fitN: s.fitN + 1, sectionView: false };
    case "fit":
      return { ...s, fitN: s.fitN + 1 };
    case "access": {
      const lockReason = a.editable ? null : (a.reason ?? LOCKED_DEFAULT);
      if (a.editable === s.editable && lockReason === s.lockReason) return s;
      return { ...s, editable: a.editable, lockReason, ...(a.editable ? {} : { tool: s.tool === "draw" ? ("select" as const) : s.tool, draft: [], drag: null }) };
    }
    case "reset":
      return { ...createModelerState(a.model, { editable: s.editable, reason: s.lockReason }, s.display), hidden: s.hidden, camera: s.camera };
    case "saved":
      return { ...s, saved: a.model };
    case "highlight":
      return { ...s, highlight: a.ids };
    case "notice":
      return notify(s, a.text, a.tone);
    case "measurePoint": {
      if (s.tool !== "measure") return s;
      if (explodeActive(s.history.present, s.display)) return notify({ ...s, measureStart: null }, EXPLODE_MEASURE_TEXT, "warn");
      if (!s.measureStart) return notify({ ...s, measureStart: a.point }, "측정 첫 점을 찍었습니다. 두 번째 점을 찍으세요.");
      const m: Measurement = { id: s.measureN, a: s.measureStart, b: a.point };
      return notify({ ...s, measures: [...s.measures, m], measureStart: null, measureN: s.measureN + 1 }, `측정 ${m.id}: ${measureText(measureDistance(m.a, m.b))}`);
    }
    case "measureCancel":
      return s.measureStart ? notify({ ...s, measureStart: null }, "측정 첫 점을 취소했습니다.") : s;
    case "measureDelete": {
      if (!s.measures.some((m) => m.id === a.id)) return s;
      return notify({ ...s, measures: s.measures.filter((m) => m.id !== a.id) }, `측정 ${a.id}을 지웠습니다.`);
    }
    case "measurePop": {
      const last = s.measures[s.measures.length - 1];
      return last ? notify({ ...s, measures: s.measures.slice(0, -1) }, `측정 ${last.id}을 지웠습니다.`) : s;
    }
    case "measureClear":
      return s.measures.length === 0 && !s.measureStart ? s : notify({ ...s, measures: [], measureStart: null }, "측정을 모두 지웠습니다.");
    case "sectionPoint": {
      if (s.tool !== "section") return s;
      if (!s.sectionDraft) return notify({ ...s, sectionDraft: a.point }, "단면선 첫 점을 찍었습니다. 두 번째 점을 찍으세요.");
      const line: SectionLine = { a: s.sectionDraft, b: a.point };
      if (!sectionPlane(line)) return s;
      return notify({ ...s, section: line, sectionDraft: null, fitN: s.sectionView ? s.fitN + 1 : s.fitN }, "단면선을 정했습니다. 선의 오른쪽을 잘라 보입니다.");
    }
    case "sectionCancel":
      return s.sectionDraft ? notify({ ...s, sectionDraft: null }, "단면선 첫 점을 취소했습니다.") : s;
    case "sectionPreset":
      return notify({ ...s, section: northSection(s.history.present), sectionDraft: null, sectionView: true, fitN: s.fitN + 1 }, "정북 단면으로 잘라 봅니다.");
    case "sectionClear":
      return s.section || s.sectionDraft ? notify({ ...s, section: null, sectionDraft: null, sectionView: false, fitN: s.sectionView ? s.fitN + 1 : s.fitN }, "단면을 해제했습니다.") : s;
    case "sectionView":
      if (!s.section || a.on === s.sectionView) return s;
      return notify({ ...s, sectionView: a.on, fitN: s.fitN + 1 }, a.on ? "단면 보기" : "단면 보기를 끕니다.");
    case "display": {
      const next = { ...s.display, ...a.patch };
      const same = (Object.keys(next) as (keyof DisplaySettings)[]).every((k) => next[k] === s.display[k]);
      if (same) return s;
      // 측정 도구 중에 분해도가 켜지면 선택 도구로 돌린다(측정 결과는 유지).
      if (s.tool === "measure" && explodeActive(s.history.present, next)) return notify({ ...s, display: next, tool: "select", measureStart: null }, EXPLODE_MEASURE_TEXT, "warn");
      return { ...s, display: next };
    }
  }
}

/** 화면에 보일 매스 이름(DesignModel에 이름 칸이 없어 순번으로 부른다). */
export function massLabel(model: Model, id: string): string {
  const i = model.masses.findIndex((m) => m.id === id);
  return i < 0 ? "매스" : `매스 ${i + 1}`;
}

export const isDirty = (s: ModelerState) => s.history.present !== s.saved;

/** 드래그 오프셋을 반영한 모델(판정·초과분 미리보기 입력). 드래그가 없으면 present 그대로. */
export function previewModel(s: ModelerState): Model {
  if (!s.drag || (s.drag.dx === 0 && s.drag.dy === 0)) return s.history.present;
  const r = moveMass(s.history.present, s.drag.id, s.drag.dx, s.drag.dy);
  return r.ok ? r.model : s.history.present;
}

export const isVisible = (s: Pick<ModelerState, "hidden">, layer: LayerKey) => !s.hidden.includes(layer);
