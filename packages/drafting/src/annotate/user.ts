// annotate/user — 주석 편집층(SheetSpec.annotations[], 03_SCREENS_UX.md 9.6절, AR-06-086).
// override(자동 주석 이동·숨김)는 applyOverrides 에 넘기고, dim·text·leader·cloud 는 앵커를 엔진 기하로 풀어 A-ANNO-USER 에 그린다.
// 고아(앵커 ref 없음·index 범위 밖·이 시트에 그려지지 않는 객체)는 위치를 추측하지 않고 출력에서 뺀 뒤 unapplied 로 보고한다.
// 그리는 순서는 id 사전순(배열 순서 무관). 순수 함수.
import type { Anchor, SheetAnnotation } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { USER_LAYER } from "../layers/index.ts";
import type { Annotation, Mm, PaperUm, Prim, Vec } from "../sheet/types.ts";
import { applyOverrides, dimension, NOTE_WIDTH, paperToModel, type AnnotateContext, type AnnotationOverride, type UnappliedOverride } from "./index.ts";

const r = roundHalfAway;

/** 이 시트에 그려지는 모델 객체의 외곽 점(모델 mm, 정수). ref 는 모델 객체 id. */
export interface ViewAnchor {
  ref: string;
  ring: Vec<Mm>[];
}

export type AnchorTable = ReadonlyMap<string, readonly Vec<Mm>[]>;

/** 같은 ref 가 여러 번이면 앞의 것이 이긴다. */
export function anchorTable(list: readonly ViewAnchor[] | undefined): AnchorTable {
  const m = new Map<string, readonly Vec<Mm>[]>();
  for (const a of list ?? []) if (!m.has(a.ref)) m.set(a.ref, a.ring);
  return m;
}

/** 앵커 → 점(모델 mm 정수). 풀 수 없으면 null(고아). edge 의 index 번째 변 = ring[index] → ring[index+1](닫힘), at 기본 mid. */
export function resolveAnchor(table: AnchorTable, a: Anchor): Vec<Mm> | null {
  const ring = table.get(a.ref);
  if (ring === undefined || ring.length === 0) return null;
  if (a.part === "center") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    return [r((x0 + x1) / 2), r((y0 + y1) / 2)];
  }
  const i = a.index;
  if (i === undefined || !Number.isInteger(i) || i < 0 || i >= ring.length) return null;
  const p = ring[i] as Vec<Mm>;
  if (a.part === "vertex") return [p[0], p[1]];
  const q = ring[(i + 1) % ring.length] as Vec<Mm>;
  if (a.at === "start") return [p[0], p[1]];
  if (a.at === "end") return [q[0], q[1]];
  return [r((p[0] + q[0]) / 2), r((p[1] + q[1]) / 2)];
}

const VALUE_SLOT = "{값}";

function textPrim(at: Vec<number>, s: string, ctx: AnnotateContext): Prim<number> {
  return s.includes("\n")
    ? { layer: USER_LAYER, key: "text", t: "mtext", at, h: ctx.text_h, width: NOTE_WIDTH, s }
    : { layer: USER_LAYER, key: "text", t: "text", at, h: ctx.text_h, s, align: "l" };
}

type Built = { ok: true; annotation: Annotation } | { ok: false; reason: UnappliedOverride["reason"] };

function buildOne(a: Exclude<SheetAnnotation, { kind: "override" }>, ctx: AnnotateContext, table: AnchorTable, viewId: string | undefined): Built {
  const anno_id = `user:${a.id}`;
  // 용지 mm → 0.01mm 정수(기존 해상도) → 모델 mm. 축척 분모가 100의 배수라 정수다.
  const off = (mm: number): Mm => paperToModel(r(mm * 100), ctx.scale);
  const orphan: Built = { ok: false, reason: "orphan_anchor" };
  const need = (): string | null => (viewId === undefined ? null : viewId);
  switch (a.kind) {
    case "dim": {
      const view_id = need();
      const pa = view_id === null ? null : resolveAnchor(table, a.a);
      const pb = view_id === null ? null : resolveAnchor(table, a.b);
      if (view_id === null || pa === null || pb === null) return orphan;
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      if (dx === 0 && dy === 0) return { ok: false, reason: "degenerate_dim" };
      const template = a.text ?? VALUE_SLOT;
      if (!template.includes(VALUE_SLOT)) return { ok: false, reason: "invalid_template" };
      const value = r(Math.sqrt(dx * dx + dy * dy));
      const base = dimension({ anno_id, view_id, a: pa, b: pb, offset: off(a.offset_mm), value_mm: value, source_ref: `annotation:${a.id}.distance` }, ctx);
      const prims = base.prims.map((p) => {
        const q = { ...p, layer: USER_LAYER } as Prim<Mm | PaperUm>;
        return q.t === "text" ? { ...q, s: template.split(VALUE_SLOT).join(String(value)) } : q;
      });
      return { ok: true, annotation: { anno_id, kind: "dim", view_id, prims, overridable: [] } };
    }
    case "text": {
      if (a.text.trim() === "") return { ok: false, reason: "note_without_text" };
      if (a.anchor === undefined) {
        const at: Vec<PaperUm> = [r(a.dx_mm * 100), r(a.dy_mm * 100)];
        return { ok: true, annotation: { anno_id, kind: "note", prims: [textPrim(at, a.text, ctx)], overridable: [] } };
      }
      const view_id = need();
      const p = view_id === null ? null : resolveAnchor(table, a.anchor);
      if (view_id === null || p === null) return orphan;
      return { ok: true, annotation: { anno_id, kind: "note", view_id, prims: [textPrim([p[0] + off(a.dx_mm), p[1] + off(a.dy_mm)], a.text, ctx)], overridable: [] } };
    }
    case "leader": {
      const view_id = need();
      if (view_id === null) return orphan;
      const pts: Vec<Mm>[] = [];
      for (const an of a.anchors) {
        const p = resolveAnchor(table, an);
        if (p === null) return orphan; // 다중 앵커는 하나라도 고아면 전체 고아
        pts.push(p);
      }
      const last = pts[pts.length - 1] as Vec<Mm>;
      const end: Vec<Mm> = [last[0] + off(a.dx_mm), last[1] + off(a.dy_mm)];
      const prims: Prim<Mm>[] = [{ layer: USER_LAYER, key: "line", t: "pline", closed: false, pts: [...pts, end] }];
      if (a.text.trim() !== "") prims.push(textPrim(end, a.text, ctx) as Prim<Mm>);
      return { ok: true, annotation: { anno_id, kind: "note", view_id, prims, overridable: [] } };
    }
    case "cloud": {
      const view_id = need();
      if (view_id === null) return orphan;
      const pts: Vec<Mm>[] = [];
      for (const an of a.anchors) {
        const p = resolveAnchor(table, an);
        if (p === null) return orphan;
        pts.push(p);
      }
      const prims: Prim<Mm>[] = [{ layer: USER_LAYER, key: "cloud", t: "pline", closed: true, pts }];
      if (a.text !== undefined && a.text.trim() !== "") {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const [x, y] of pts) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
        prims.push(textPrim([r((x0 + x1) / 2), r((y0 + y1) / 2)], a.text, ctx) as Prim<Mm>);
      }
      return { ok: true, annotation: { anno_id, kind: "note", view_id, prims, overridable: [] } };
    }
  }
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 자동 주석(raw)에 편집층을 적용한다. override 는 id 순으로 applyOverrides 에 넘기고(같은 target 이면 id 뒤쪽 칸이 이긴다),
 * 사람 주석은 id 순으로 풀어 붙인다. 고아·못 그리는 주석은 unapplied(target = 주석 id)로 돌려준다.
 */
export function applyAnnotations(
  raw: readonly Annotation[],
  edits: readonly SheetAnnotation[] | undefined,
  ctx: AnnotateContext,
  anchors: AnchorTable,
  viewId: string | undefined,
): { annotations: Annotation[]; unapplied: UnappliedOverride[] } {
  const sorted = [...(edits ?? [])].sort((x, y) => cmpStr(x.id, y.id));
  const overrides: AnnotationOverride[] = [];
  for (const e of sorted) {
    if (e.kind !== "override") continue;
    const o: AnnotationOverride = { target: e.target };
    if (e.dx_mm !== undefined) o.dx_mm = e.dx_mm;
    if (e.dy_mm !== undefined) o.dy_mm = e.dy_mm;
    if (e.text !== undefined) o.text = e.text;
    if (e.hidden !== undefined) o.hidden = e.hidden;
    overrides.push(o);
  }
  const base = applyOverrides(raw, overrides, ctx);
  const annotations = base.annotations;
  const unapplied = base.unapplied;
  for (const e of sorted) {
    if (e.kind === "override") continue;
    const b = buildOne(e, ctx, anchors, viewId);
    if (b.ok) annotations.push(b.annotation);
    else unapplied.push({ target: e.id, reason: b.reason });
  }
  return { annotations, unapplied };
}
