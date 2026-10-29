// 모델러 단축키(03장 6.1절, 순수): 키 입력 → 화면 동작. 입력칸·선택 상자·글 편집 중에는 Ctrl 조합만 받는다(호출 쪽이 typing 표시).
// V 선택, M 매스 그리기, E 압출(층고 칸으로), D 측정·S 단면(후속 안내), H 엔벨로프, 1/2/3 투시·평면·정북 단면, F 맞춤,
// Delete 삭제, 화살표 이동 100mm(Shift 1,000·Alt 10), Ctrl+화살표 카메라 회전, Ctrl+Z/Ctrl+Shift+Z·Ctrl+Y, Ctrl+S, Esc, Enter·Backspace(그리기).
import type { CameraMode, Tool } from "../state/store.ts";

export interface KeyInput {
  readonly key: string;
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface KeyContext {
  readonly tool: Tool;
  readonly drawing: boolean;
  readonly hasSelection: boolean;
  /** 포커스가 입력칸에 있음. */
  readonly typing: boolean;
}

export type KeyAction =
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "save" }
  | { readonly type: "tool"; readonly tool: Tool }
  | { readonly type: "extrude" }
  | { readonly type: "pending"; readonly what: "measure" | "section" }
  | { readonly type: "toggleEnvelope" }
  | { readonly type: "camera"; readonly mode: CameraMode }
  | { readonly type: "fit" }
  | { readonly type: "delete" }
  | { readonly type: "nudge"; readonly dx: number; readonly dy: number }
  | { readonly type: "orbit"; readonly dAzimuth: number; readonly dPolar: number }
  | { readonly type: "escape" }
  | { readonly type: "draftClose" }
  | { readonly type: "draftPop" };

/** 화살표 이동량(mm): 기본 100, Shift 1,000, Alt 10(03장 6.1절 제안). */
export function nudgeStep(k: Pick<KeyInput, "shift" | "alt">): number {
  return k.shift ? 1000 : k.alt ? 10 : 100;
}

/** Ctrl+화살표 카메라 회전 단위(라디안의 분수, 1/24 바퀴 = 15°). */
export const ORBIT_STEP = Math.PI / 12;

export function keyAction(k: KeyInput, c: KeyContext): KeyAction | null {
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (k.ctrl) {
    if (key === "z") return k.shift ? { type: "redo" } : { type: "undo" };
    if (key === "y") return { type: "redo" };
    if (key === "s") return { type: "save" };
    if (c.typing) return null;
    if (key === "ArrowLeft") return { type: "orbit", dAzimuth: -ORBIT_STEP, dPolar: 0 };
    if (key === "ArrowRight") return { type: "orbit", dAzimuth: ORBIT_STEP, dPolar: 0 };
    if (key === "ArrowUp") return { type: "orbit", dAzimuth: 0, dPolar: -ORBIT_STEP };
    if (key === "ArrowDown") return { type: "orbit", dAzimuth: 0, dPolar: ORBIT_STEP };
    return null;
  }
  if (c.typing) return null;
  if (key === "Escape") return { type: "escape" };
  if (c.drawing) {
    if (key === "Enter") return { type: "draftClose" };
    if (key === "Backspace") return { type: "draftPop" };
  }
  switch (key) {
    case "v":
      return { type: "tool", tool: "select" };
    case "m":
      return { type: "tool", tool: "draw" };
    case "e":
      return c.hasSelection ? { type: "extrude" } : null;
    case "d":
      return { type: "pending", what: "measure" };
    case "s":
      return { type: "pending", what: "section" };
    case "h":
      return { type: "toggleEnvelope" };
    case "1":
      return { type: "camera", mode: "perspective" };
    case "2":
      return { type: "camera", mode: "plan" };
    case "3":
      return { type: "camera", mode: "section" };
    case "f":
      return { type: "fit" };
    case "Delete":
      return c.hasSelection ? { type: "delete" } : null;
    case "Backspace":
      return c.hasSelection && !c.drawing ? { type: "delete" } : null;
  }
  if (c.hasSelection && c.tool === "select" && key.startsWith("Arrow")) {
    const s = nudgeStep(k);
    if (key === "ArrowLeft") return { type: "nudge", dx: -s, dy: 0 };
    if (key === "ArrowRight") return { type: "nudge", dx: s, dy: 0 };
    if (key === "ArrowUp") return { type: "nudge", dx: 0, dy: s };
    if (key === "ArrowDown") return { type: "nudge", dx: 0, dy: -s };
  }
  return null;
}

/** 키보드 이벤트 대상이 글 입력칸인가(단축키 무시). */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "spinbutton" || role === "textbox" || role === "combobox";
}
