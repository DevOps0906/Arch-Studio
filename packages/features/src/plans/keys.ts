// 평면 편집기 키 → 동작 번역(순수, 03장 6.1절 "평면 편집기" 행). 화면은 동작만 실행한다.
import type { Tool } from "./editor.ts";

export interface KeyInfo {
  readonly key: string;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export type Action =
  | { readonly t: "tool"; readonly tool: Tool }
  | { readonly t: "grid" }
  | { readonly t: "undo" }
  | { readonly t: "redo" }
  | { readonly t: "save" }
  | { readonly t: "escape" }
  | { readonly t: "delete" }
  | { readonly t: "enter" }
  | { readonly t: "backspace" }
  | { readonly t: "space" }
  | { readonly t: "edge"; readonly dir: 1 | -1 }
  /** 화살표: 모델 좌표 방향(위 = +y). 이동량은 shift·alt와 그리드 상태로 화면이 정한다. */
  | { readonly t: "arrow"; readonly ux: -1 | 0 | 1; readonly uy: -1 | 0 | 1; readonly shift: boolean; readonly alt: boolean };

const TOOL_KEYS: Readonly<Record<string, Tool>> = { v: "select", r: "room", x: "split", j: "merge", d: "door", w: "window" };

export function keyAction(k: KeyInfo): Action | null {
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (k.ctrl) {
    if (key === "z") return k.shift ? { t: "redo" } : { t: "undo" };
    if (key === "y") return { t: "redo" };
    if (key === "s") return { t: "save" };
    return null;
  }
  if (k.alt && !key.startsWith("Arrow")) return null;
  switch (key) {
    case "ArrowLeft":
      return { t: "arrow", ux: -1, uy: 0, shift: k.shift, alt: k.alt };
    case "ArrowRight":
      return { t: "arrow", ux: 1, uy: 0, shift: k.shift, alt: k.alt };
    case "ArrowUp":
      return { t: "arrow", ux: 0, uy: 1, shift: k.shift, alt: k.alt };
    case "ArrowDown":
      return { t: "arrow", ux: 0, uy: -1, shift: k.shift, alt: k.alt };
    case "Escape":
      return { t: "escape" };
    case "Delete":
      return { t: "delete" };
    case "Enter":
      return { t: "enter" };
    case "Backspace":
      return { t: "backspace" };
    case " ":
      return { t: "space" };
    case "[":
      return { t: "edge", dir: -1 };
    case "]":
      return { t: "edge", dir: 1 };
    case "g":
      return { t: "grid" };
  }
  const tool = TOOL_KEYS[key];
  return tool && !k.shift ? { t: "tool", tool } : null;
}

/** 글자 입력 칸·선택 상자·대화상자 안에서는 단축키를 가로채지 않는다. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === "function" && el.closest("dialog") !== null;
}
