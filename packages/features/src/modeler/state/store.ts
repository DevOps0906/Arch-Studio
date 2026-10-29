// 모델러 상태기계(순수 리듀서). 모델 편집은 명령(commands.ts) → 이력(history.ts)으로만 바뀐다.
// 열람 상태(체험·구독 만료, 화면 폭 768 미만)에서는 편집 동작을 여기서 한 번 더 거부한다(도구 막대 숨김과 별도의 이중 차단, [DECISION] 6절).
// 드래그 중에는 모델을 바꾸지 않고 오프셋(drag)만 바꾼다. 놓을 때(dragEnd) 이동 명령 1개로 기록한다.
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
  type Model,
  type RoofType,
} from "./commands.ts";
import { canRedo, canUndo, createHistory, pushHistory, redo, undo, type History } from "./history.ts";

export type Tool = "select" | "draw";
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
  | { readonly type: "delete"; readonly id: string };

export const COMMAND_LABEL: Readonly<Record<Command["type"], string>> = {
  add: "매스 추가",
  move: "매스 이동",
  floors: "층 수 변경",
  floorHeight: "층고 변경",
  floorUse: "용도 변경",
  baseLevel: "바닥 높이 변경",
  roof: "지붕 변경",
  delete: "매스 삭제",
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
  | { readonly type: "notice"; readonly text: string; readonly tone?: Notice["tone"] };

export const LOCKED_DEFAULT = "열람 모드: 편집하려면 라이선스나 구독이 필요합니다.";

export function createModelerState(model: Model, access: { editable: boolean; reason: string | null } = { editable: true, reason: null }): ModelerState {
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

export function modelerReducer(s: ModelerState, a: Action): ModelerState {
  if (!s.editable && EDIT_ACTIONS.has(a.type)) return notify(s, s.lockReason ?? LOCKED_DEFAULT, "warn");
  if (!s.editable && a.type === "tool" && a.tool !== "select") return notify(s, s.lockReason ?? LOCKED_DEFAULT, "warn");
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
      return notify({ ...s, tool: a.tool, draft: [], drag: null }, a.tool === "draw" ? "매스 그리기: 바닥 꼭짓점을 차례로 찍고 Enter로 닫습니다." : "선택 도구");
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
      return { ...s, camera: a.mode, fitN: s.fitN + 1 };
    case "fit":
      return { ...s, fitN: s.fitN + 1 };
    case "access": {
      const lockReason = a.editable ? null : (a.reason ?? LOCKED_DEFAULT);
      if (a.editable === s.editable && lockReason === s.lockReason) return s;
      return { ...s, editable: a.editable, lockReason, ...(a.editable ? {} : { tool: "select" as const, draft: [], drag: null }) };
    }
    case "reset":
      return { ...createModelerState(a.model, { editable: s.editable, reason: s.lockReason }), hidden: s.hidden, camera: s.camera };
    case "saved":
      return { ...s, saved: a.model };
    case "highlight":
      return { ...s, highlight: a.ids };
    case "notice":
      return notify(s, a.text, a.tone);
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
