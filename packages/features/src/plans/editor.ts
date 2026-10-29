// 편집기 상태기계(순수): 이력·선택·도구·그리기 중인 점·알림. 화면은 이 함수들의 결과를 그대로 그린다.
// 모든 모델 변경은 ops.ts 연산을 거치고, 성공하면 이력에 한 단계(또는 같은 키면 합쳐서)로 남는다.
import type { Point } from "@arch-studio/domain";
import type { FloorLayout } from "@arch-studio/layout";
import { commit, createHistory, redo, undo, type History } from "./history.ts";
import { layoutOfFloor, withFloorLayout, type Layouts } from "./model.ts";
import { GRID_MM, GRID_SHIFT_MM, NO_SELECTION, type OpResult, type Selection } from "./ops.ts";

export type Tool = "select" | "room" | "split" | "merge" | "door" | "window";

export interface Notice {
  readonly tone: "info" | "warn";
  readonly text: string;
}

export interface EditorState {
  readonly history: History<Layouts>;
  /** 모델이 바뀔 때마다 1씩 늘어난다(판정 요청의 model_rev, 실행취소로 돌아가도 새 값). */
  readonly rev: number;
  readonly floor: string;
  readonly sel: Selection;
  readonly tool: Tool;
  /** 실 그리기 중인 점(닫기 전). */
  readonly draw: readonly Point[];
  /** 그리기 키보드 커서(그리드 점). */
  readonly cursor: Point;
  readonly grid: boolean;
  readonly notice: Notice | null;
  /** 끌기 한 번을 한 단계로 합치기 위한 번호. */
  readonly dragSeq: number;
}

export function initEditor(layouts: Layouts, floor: string): EditorState {
  return { history: createHistory(layouts), rev: 0, floor, sel: NO_SELECTION, tool: "select", draw: [], cursor: [0, 0], grid: true, notice: null, dragSeq: 0 };
}

export const layouts = (s: EditorState): Layouts => s.history.present;
export const currentLayout = (s: EditorState): FloorLayout => layoutOfFloor(s.history.present, s.floor);
export const gridMm = (s: EditorState) => (s.grid ? GRID_MM : 1);

/** 연산을 현재 층에 적용한다. 실패하면 모델은 그대로 두고 이유를 알린다. */
export function applyOp(s: EditorState, op: (l: FloorLayout) => OpResult, coalesce: string | null = null): EditorState {
  const r = op(currentLayout(s));
  if (!r.ok) return { ...s, notice: { tone: "warn", text: r.reason } };
  const next = withFloorLayout(s.history.present, r.layout);
  if (next === s.history.present) return { ...s, notice: r.notice ? { tone: "info", text: r.notice } : null };
  return {
    ...s,
    history: commit(s.history, next, coalesce),
    rev: s.rev + 1,
    sel: r.select ?? s.sel,
    notice: r.notice ? { tone: "info", text: r.notice } : null,
    draw: r.select ? [] : s.draw,
  };
}

/** 선택이 가리키는 실·문창이 아직 있는지 확인해 없으면 비운다(실행취소 뒤 정리). */
export function sanitizeSelection(s: EditorState): EditorState {
  const l = currentLayout(s);
  if (s.sel.kind === "room") {
    const id = s.sel.id;
    const room = l.rooms.find((r) => r.id === id);
    if (!room) return { ...s, sel: NO_SELECTION };
    if (s.sel.edge !== null && s.sel.edge >= room.polygon.outer.length) return { ...s, sel: { kind: "room", id, edge: null } };
  }
  if (s.sel.kind === "opening") {
    const id = s.sel.id;
    if (!l.openings.some((o) => o.id === id)) return { ...s, sel: NO_SELECTION };
  }
  return s;
}

export function doUndo(s: EditorState): EditorState {
  const h = undo(s.history);
  return h === s.history ? s : sanitizeSelection({ ...s, history: h, rev: s.rev + 1, notice: { tone: "info", text: "실행취소했습니다." } });
}

export function doRedo(s: EditorState): EditorState {
  const h = redo(s.history);
  return h === s.history ? s : sanitizeSelection({ ...s, history: h, rev: s.rev + 1, notice: { tone: "info", text: "다시 실행했습니다." } });
}

export function setFloor(s: EditorState, floor: string): EditorState {
  return s.floor === floor ? s : { ...s, floor, sel: NO_SELECTION, tool: "select", draw: [], notice: null };
}

export function setTool(s: EditorState, tool: Tool): EditorState {
  return { ...s, tool, draw: tool === "room" ? s.draw : [], notice: null };
}

export function select(s: EditorState, sel: Selection): EditorState {
  return { ...s, sel, notice: null };
}

/** [ ] 키: 선택한 실의 다음/이전 변. */
export function stepEdge(s: EditorState, dir: 1 | -1): EditorState {
  if (s.sel.kind !== "room") return { ...s, notice: { tone: "warn", text: "먼저 실을 고르세요." } };
  const room = currentLayout(s).rooms.find((r) => r.id === (s.sel as { id: string }).id);
  if (!room) return s;
  const n = room.polygon.outer.length;
  const cur = s.sel.edge;
  const edge = cur === null ? (dir === 1 ? 0 : n - 1) : (cur + dir + n) % n;
  return { ...s, sel: { kind: "room", id: room.id, edge }, notice: null };
}

/** 방향키 한 번의 이동량(mm). Shift 1,000 · 그리드 끄면 Alt 10 · 기본 100. */
export function arrowStep(shift: boolean, alt: boolean, grid: boolean): number {
  if (shift) return GRID_SHIFT_MM;
  if (alt && !grid) return 10;
  return GRID_MM;
}

// ---------- 그리기 ----------

export function drawAdd(s: EditorState, p: Point): EditorState {
  const last = s.draw[s.draw.length - 1];
  if (last && last[0] === p[0] && last[1] === p[1]) return s;
  return { ...s, draw: [...s.draw, p], cursor: p, notice: null };
}

export function drawBack(s: EditorState): EditorState {
  return s.draw.length === 0 ? s : { ...s, draw: s.draw.slice(0, -1), notice: null };
}

export function moveCursor(s: EditorState, dx: number, dy: number): EditorState {
  return { ...s, cursor: [s.cursor[0] + dx, s.cursor[1] + dy] };
}
