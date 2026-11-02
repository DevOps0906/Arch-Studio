// annotate — 치수·라벨·경고·메모 주석과 덮어쓰기(02_ARCHITECTURE.md 2.3절 "주석과 치수").
// 치수는 분해형(LINE + TEXT, A-ANNO-DIMS). 값은 호출자가 넘긴 판정·측정 값 그대로이고 source_ref가 필수다.
// 덮어쓰기는 anno_id별 위치 이동(offset)·숨김(hide)과 자유 메모(note:*)만. 치수·면적 문자 값은 바꿀 수 없다.
import type { StdLayer } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { DraftingError } from "../sheet/errors.ts";
import type { Annotation, Mm, PaperUm, Prim, Scale, Vec } from "../sheet/types.ts";

export interface AnnotateContext {
  scale: Scale;
  /** 기본 문자 높이(용지 0.01mm). */
  text_h: PaperUm;
}

/**
 * 엔진 계산 값 TEXT 규칙(팀장 결정 2026-10-29): source_ref 필수 대상은 엔진이 계산한 값을 표시하는 것만.
 * - kind "dim" 주석: 모든 TEXT에 source_ref 필수, MTEXT 불가.
 * - label·warning: 값 줄(`kind: "value"`, 면적·판정 수치 등)만 source_ref 필수 — label()이 강제. 실명 같은 일반 줄은 대상 아님.
 */
export function checkValueText(a: Pick<Annotation, "anno_id" | "kind" | "prims">): void {
  if (a.kind !== "dim") return;
  for (const p of a.prims) {
    if (p.t === "mtext") throw new DraftingError("NUMERIC_TEXT_SOURCE", `${a.anno_id}/${p.key}: 치수 값은 MTEXT가 아니라 TEXT로 둡니다`);
    if (p.t === "text" && !(typeof p.source_ref === "string" && p.source_ref !== "")) {
      throw new DraftingError("NUMERIC_TEXT_SOURCE", `${a.anno_id}/${p.key}: 치수 값 "${p.s}"에 source_ref가 없습니다`);
    }
  }
}

/** 용지 0.01mm → 모델 mm. 축척 분모가 100의 배수라 정수 그대로. */
export function paperToModel(um: PaperUm, scale: Scale): Mm {
  return (um * scale) / 100 + 0;
}

const r = roundHalfAway;

// 치수 모양(제안, 용지 기준): 보조선 간격 1mm, 보조선 넘침 2mm, 45도 눈금 반길이 1.5mm, 값과 치수선 간격 1mm.
const EXT_GAP: PaperUm = 100;
const EXT_OVER: PaperUm = 200;
const TICK_HALF: PaperUm = 150;
const TEXT_GAP: PaperUm = 100;

export interface DimensionSpec {
  anno_id: string;
  view_id: string;
  a: Vec<Mm>;
  b: Vec<Mm>;
  /** 치수선을 a→b 왼쪽 법선 방향으로 띄우는 거리(모델 mm, 부호 있음). */
  offset: Mm;
  /** 표시 값(정수 mm). 엔진이 다시 재지 않는다 — 판정·측정 값 그대로. */
  value_mm: number;
  /** JudgmentResult 경로 또는 geometry 측정 키. */
  source_ref: string;
}

function needId(id: string, what: string): void {
  if (typeof id !== "string" || id === "") throw new DraftingError("INVALID_ARGUMENT", `${what}이(가) 비었습니다`);
}

function needMm(v: number, what: string): void {
  if (!Number.isSafeInteger(v)) throw new DraftingError("INVALID_ARGUMENT", `${what}은(는) 정수 mm여야 합니다: ${v}`);
}

/** 분해 치수: 치수선·보조선 2·45도 눈금 2(LINE) + 값(TEXT, 정수 mm, 천 단위 쉼표 없음). */
export function dimension(spec: DimensionSpec, ctx: AnnotateContext): Annotation {
  needId(spec.anno_id, "anno_id");
  needId(spec.view_id, "view_id");
  needId(spec.source_ref, `${spec.anno_id} source_ref`);
  for (const v of [...spec.a, ...spec.b, spec.offset]) needMm(v, spec.anno_id);
  needMm(spec.value_mm, `${spec.anno_id} value_mm`);
  const [ax, ay] = spec.a;
  const [bx, by] = spec.b;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) throw new DraftingError("INVALID_ARGUMENT", `${spec.anno_id}: 치수 두 점이 같습니다`);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const m = (um: PaperUm) => paperToModel(um, ctx.scale);
  const off = spec.offset;
  const sign = off < 0 ? -1 : 1;
  const a1: Vec<Mm> = [r(ax + nx * off), r(ay + ny * off)];
  const b1: Vec<Mm> = [r(bx + nx * off), r(by + ny * off)];
  const L = "A-ANNO-DIMS" as const;
  const prims: Prim<Mm>[] = [{ layer: L, key: "line", t: "line", a: a1, b: b1 }];
  if (Math.abs(off) > m(EXT_GAP)) {
    const g = m(EXT_GAP) * sign;
    const o = off + m(EXT_OVER) * sign;
    prims.push(
      { layer: L, key: "ext:a", t: "line", a: [r(ax + nx * g), r(ay + ny * g)], b: [r(ax + nx * o), r(ay + ny * o)] },
      { layer: L, key: "ext:b", t: "line", a: [r(bx + nx * g), r(by + ny * g)], b: [r(bx + nx * o), r(by + ny * o)] },
    );
  }
  // 45도 눈금: (u + n)/√2 방향. 1/√2 = √2/2를 sqrt로만 계산(초월함수 없음).
  const k = (m(TICK_HALF) * Math.sqrt(2)) / 2;
  const tx = (ux + nx) * k;
  const ty = (uy + ny) * k;
  for (const [id, [px, py]] of [["tick:a", a1], ["tick:b", b1]] as const) {
    prims.push({ layer: L, key: id, t: "line", a: [r(px - tx), r(py - ty)], b: [r(px + tx), r(py + ty)] });
  }
  const tg = m(TEXT_GAP) * sign;
  prims.push({
    layer: L,
    key: "text",
    t: "text",
    at: [r((a1[0] + b1[0]) / 2 + nx * tg), r((a1[1] + b1[1]) / 2 + ny * tg)],
    h: ctx.text_h,
    s: String(spec.value_mm),
    align: "c",
    source_ref: spec.source_ref,
  });
  return { anno_id: spec.anno_id, kind: "dim", view_id: spec.view_id, prims, overridable: ["offset", "hide"] };
}

export interface LabelSpec {
  anno_id: string;
  kind: "label" | "warning";
  /** 있으면 모델 mm(그 뷰), 없으면 용지 0.01mm. */
  view_id?: string;
  at: Vec<number>;
  /** 위에서 아래로 쌓는 줄. 엔진이 계산한 값(면적·판정 수치)은 `kind: "value"` + source_ref 필수. */
  lines: Array<{ kind?: "text"; s: string } | { kind: "value"; s: string; source_ref: string }>;
  layer?: StdLayer;
  align?: "l" | "c" | "r";
}

/** 라벨·경고(실명·면적, "검토 필요" 등). 줄 간격 = 문자 높이 × 1.5. */
export function label(spec: LabelSpec, ctx: AnnotateContext): Annotation {
  needId(spec.anno_id, "anno_id");
  for (const v of spec.at) needMm(v, spec.anno_id);
  if (spec.lines.length === 0) throw new DraftingError("INVALID_ARGUMENT", `${spec.anno_id}: 줄이 없습니다`);
  const layer = spec.layer ?? (spec.kind === "warning" ? "A-ANNO-TEXT" : "A-AREA-IDEN");
  const stepUm = r(ctx.text_h * 1.5);
  const step = spec.view_id === undefined ? stepUm : paperToModel(stepUm, ctx.scale);
  const prims: Prim<number>[] = spec.lines.map((line, i) => {
    const p: Prim<number> = {
      layer,
      key: `line:${String(i).padStart(3, "0")}`,
      t: "text",
      at: [spec.at[0], spec.at[1] - i * step],
      h: ctx.text_h,
      s: line.s,
      align: spec.align ?? "c",
    };
    if (line.kind === "value") {
      if (typeof line.source_ref !== "string" || line.source_ref === "") {
        throw new DraftingError("NUMERIC_TEXT_SOURCE", `${spec.anno_id}: 값 줄 "${line.s}"에 source_ref가 없습니다`);
      }
      p.source_ref = line.source_ref;
    }
    return p;
  });
  const out: Annotation = { anno_id: spec.anno_id, kind: spec.kind, prims, overridable: ["offset", "hide"] };
  if (spec.view_id !== undefined) out.view_id = spec.view_id;
  return out;
}

/** 자동 주석 1개의 수정(SheetSpec.annotations 의 kind "override" 를 풀어 넘긴 모양). */
export interface AnnotationOverride {
  target: string;
  dx_mm?: number;
  dy_mm?: number;
  text?: string;
  hidden?: boolean;
}

export interface UnappliedOverride {
  target: string;
  /**
   * orphan_anchor: 앵커 ref 없음·index 범위 밖·이 시트에 그려지지 않는 객체(출력에서 뺌). degenerate_dim: 치수 두 점이 같음.
   * invalid_template: 치수 문구에 {값}이 없음. 이 셋의 target 은 주석 id.
   */
  reason:
    | "missing_target"
    | "text_not_allowed"
    | "not_overridable"
    | "note_without_text"
    | "invalid_offset"
    | "orphan_anchor"
    | "degenerate_dim"
    | "invalid_template";
}

export const NOTE_PREFIX = "note:";
export const NOTE_WIDTH: PaperUm = 8_000;

function shiftPrim<U extends number>(p: Prim<U>, dx: number, dy: number): Prim<U> {
  const mv = (v: Vec<U>): Vec<U> => [(v[0] + dx) as U, (v[1] + dy) as U];
  switch (p.t) {
    case "line":
      return { ...p, a: mv(p.a), b: mv(p.b) };
    case "pline":
      return { ...p, pts: p.pts.map(mv) };
    case "arc":
    case "circle":
      return { ...p, c: mv(p.c) };
    case "text":
    case "mtext":
    case "insert":
      return { ...p, at: mv(p.at) };
    case "hatch":
      return { ...p, loops: p.loops.map((loop) => loop.map(mv)) };
  }
}

/** 용지 mm(실수) → 0.01mm 정수. 유한하지 않으면 null. */
function paperMmToUm(v: number | undefined): PaperUm | null {
  if (v === undefined) return 0;
  return Number.isFinite(v) ? r(v * 100) : null;
}

/**
 * annotation_overrides 적용. dx_mm·dy_mm는 용지 mm(tasks/logs/AR-06-020.md [DECISION] 후보):
 * 뷰 주석은 모델 mm(× 축척 분모)로, 용지 주석은 그대로 옮긴다. 같은 target이 여러 번 오면 뒤 항목의 칸이 이긴다.
 * `note:<id>` target은 자유 메모(A-ANNO-TEXT, 용지 좌표 (dx_mm, dy_mm)). 대상이 없는 덮어쓰기는 버리고 unapplied로 돌려준다
 * (화면 "적용되지 않은 주석 수정 n건").
 */
export function applyOverrides(
  annotations: readonly Annotation[],
  overrides: readonly AnnotationOverride[],
  ctx: AnnotateContext,
): { annotations: Annotation[]; unapplied: UnappliedOverride[] } {
  const merged: Record<string, AnnotationOverride> = Object.create(null);
  for (const o of overrides) merged[o.target] = { ...merged[o.target], ...o };
  const byId: Record<string, Annotation> = Object.create(null);
  for (const a of annotations) {
    if (Object.prototype.hasOwnProperty.call(byId, a.anno_id)) {
      throw new DraftingError("DUPLICATE_KEY", `anno_id 중복: ${a.anno_id}`);
    }
    byId[a.anno_id] = a;
  }

  const unapplied: UnappliedOverride[] = [];
  const hidden: Record<string, true> = Object.create(null);
  const notes: Annotation[] = [];
  for (const target of Object.keys(merged).sort()) {
    const o = merged[target] as AnnotationOverride;
    const dx = paperMmToUm(o.dx_mm);
    const dy = paperMmToUm(o.dy_mm);
    if (target.startsWith(NOTE_PREFIX)) {
      if (o.hidden === true) continue;
      if (dx === null || dy === null) {
        unapplied.push({ target, reason: "invalid_offset" });
        continue;
      }
      if (typeof o.text !== "string" || o.text.trim() === "") {
        unapplied.push({ target, reason: "note_without_text" });
        continue;
      }
      const L = "A-ANNO-TEXT" as const;
      const prim: Prim<PaperUm> = o.text.includes("\n")
        ? { layer: L, key: "text", t: "mtext", at: [dx, dy], h: ctx.text_h, width: NOTE_WIDTH, s: o.text }
        : { layer: L, key: "text", t: "text", at: [dx, dy], h: ctx.text_h, s: o.text, align: "l" };
      notes.push({ anno_id: target, kind: "note", prims: [prim], overridable: ["offset", "hide"] });
      continue;
    }
    const a = byId[target];
    if (a === undefined) {
      unapplied.push({ target, reason: "missing_target" });
      continue;
    }
    if (o.text !== undefined) unapplied.push({ target, reason: "text_not_allowed" });
    if (o.hidden === true) {
      if (a.overridable.includes("hide")) hidden[target] = true;
      else unapplied.push({ target, reason: "not_overridable" });
      continue;
    }
    if (o.dx_mm === undefined && o.dy_mm === undefined) continue;
    if (dx === null || dy === null) {
      unapplied.push({ target, reason: "invalid_offset" });
      continue;
    }
    if (!a.overridable.includes("offset")) {
      unapplied.push({ target, reason: "not_overridable" });
      continue;
    }
    const [mx, my] = a.view_id === undefined ? [dx, dy] : [paperToModel(dx, ctx.scale), paperToModel(dy, ctx.scale)];
    byId[target] = { ...a, prims: a.prims.map((p) => shiftPrim(p, mx, my)) };
  }

  const out: Annotation[] = [];
  for (const a of annotations) if (!hidden[a.anno_id]) out.push(byId[a.anno_id] as Annotation);
  for (const n of notes) {
    if (Object.prototype.hasOwnProperty.call(byId, n.anno_id)) throw new DraftingError("DUPLICATE_KEY", `anno_id 중복: ${n.anno_id}`);
    out.push(n);
  }
  return { annotations: out, unapplied };
}
