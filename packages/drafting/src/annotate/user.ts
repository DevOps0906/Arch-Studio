// 사람 주석(AR-06-086, 03_SCREENS_UX.md 9.6절): SheetSpec.annotations의 dim·text·leader·cloud → A-ANNO-USER 주석.
// 단, 이행한 자유 메모(`ov-note:*`, 앵커 없는 text)는 기존과 같은 A-ANNO-TEXT에 그린다([DECISION] 3).
// 위치는 앵커(모델 객체 + 부위)를 엔진 기하로 풀어 정수 mm로 정하고, 오프셋은 용지 mm(0.01mm 반올림)이다. 결정 규칙은
// tasks/logs/AR-06-086.md [DECISION] 5~8: 앵커 대상 없음·번호 범위 밖·기준 좌표(snap) 불일치는 고아 → 출력 0건 + unapplied.
// 이 시트 뷰에 그려지지 않는 대상(다른 층의 실, 단면 시트의 매스 등)은 고아가 아니라 그냥 그리지 않는다.
import type { Anchor, SheetAnnotation } from "@arch-studio/domain";
import { offset, roundHalfAway } from "@arch-studio/geometry";
import type { Annotation, DraftingInput, Mm, PaperUm, Prim, Vec } from "../sheet/types.ts";
import { cmpStr, dimension, paperMmToUm, paperToModel, type AnnotateContext, type UnappliedAnnotation, type UnappliedReason } from "./index.ts";

const L = "A-ANNO-USER" as const;
/** 이행 메모 레이어(기존 note:* 출력과 같다). */
const L_NOTE = "A-ANNO-TEXT" as const;
const r = roundHalfAway;
/** 여러 줄 문자 폭(용지 0.01mm). 기존 자유 메모와 같다. */
const NOTE_WIDTH: PaperUm = 8_000;
/** 구름 호 반지름(용지 2.5mm)과 기본 크기(용지 20mm). */
const CLOUD_R: PaperUm = 250;
const CLOUD_DEFAULT_MM = 20;
/** 사람 치수 값 틀. */
export const DIM_VALUE_TOKEN = "{값}";
export const USER_DIM_SOURCE_REF = "user";

type Src = Pick<DraftingInput, "model" | "judgment" | "sheet">;
interface Shape {
  pts: Vec<Mm>[];
  closed: boolean;
  /** 이 시트 뷰에 그려지는 대상인가. */
  visible: boolean;
}

/** ref → 형상. 모델에 없으면 null(고아). 예약 ref: site:boundary · road:<edge_index> · line:setback. */
function lookup(ref: string, src: Src): Shape | null {
  const { model, sheet } = src;
  const site = model.site;
  const onSite = sheet.kind === "site_plan";
  const ring = site.boundary.outer.map(([x, y]) => [x, y] as Vec<Mm>);
  if (ref === "site:boundary") return { pts: ring, closed: true, visible: onSite };
  const road = /^road:(0|[1-9][0-9]{0,5})$/.exec(ref);
  if (road !== null) {
    const n = Number(road[1]);
    const rd = site.roads.find((x) => x.edge_index === n);
    if (rd === undefined || n >= ring.length) return null;
    return { pts: [ring[n] as Vec<Mm>, ring[(n + 1) % ring.length] as Vec<Mm>], closed: false, visible: onSite && rd.width_mm > 0 };
  }
  if (ref === "line:setback") {
    const it = src.judgment.items.find((i) => i.key === "setback");
    const limit = it?.limit === undefined ? 0 : r(it.limit);
    if (!(limit > 0)) return null;
    const p = offset(site.boundary, -limit)[0];
    if (p === undefined) return null;
    return { pts: p.outer.map(([x, y]) => [x, y] as Vec<Mm>), closed: true, visible: onSite };
  }
  const mass = model.masses.find((m) => m.id === ref);
  if (mass !== undefined) {
    return { pts: mass.footprint.outer.map(([x, y]) => [x, y] as Vec<Mm>), closed: true, visible: onSite && mass.floors.length > 0 };
  }
  let found: Shape | null = null;
  for (const layout of model.floor_layouts) {
    const room = layout.rooms.find((x) => x.id === ref);
    if (room === undefined) continue;
    const visible = sheet.kind === "floor_plan" && layout.floor_id === sheet.floor_id;
    found = { pts: room.polygon.outer.map(([x, y]) => [x, y] as Vec<Mm>), closed: true, visible };
    if (visible) break;
  }
  return found;
}

type Resolved = { ok: true; pt: Vec<Mm> } | { ok: false; reason: UnappliedReason };

/** 부위 → 점(정수 mm). foot는 상대 점(other)에서 변 직선에 내린 수선의 발. */
function pointOf(a: Anchor, s: Shape, other: Vec<Mm> | null): Resolved {
  const n = s.pts.length;
  let pt: Vec<Mm>;
  if (a.at === "foot" && (a.part !== "edge" || other === null)) return { ok: false, reason: "invalid_anchor" };
  if (a.part === "center") {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    pt = [r((Math.min(...xs) + Math.max(...xs)) / 2), r((Math.min(...ys) + Math.max(...ys)) / 2)];
  } else {
    if (a.index === undefined) return { ok: false, reason: "invalid_anchor" };
    if (a.part === "vertex") {
      if (a.index >= n) return { ok: false, reason: "orphan_index" };
      pt = s.pts[a.index] as Vec<Mm>;
    } else {
      if (a.index >= (s.closed ? n : n - 1)) return { ok: false, reason: "orphan_index" };
      const p = s.pts[a.index] as Vec<Mm>;
      const q = s.pts[(a.index + 1) % n] as Vec<Mm>;
      if (a.at === "start") pt = p;
      else if (a.at === "end") pt = q;
      else if (a.at === "foot") {
        const o = other as Vec<Mm>;
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : ((o[0] - p[0]) * dx + (o[1] - p[1]) * dy) / len2;
        pt = [r(p[0] + t * dx), r(p[1] + t * dy)];
      } else pt = [r((p[0] + q[0]) / 2), r((p[1] + q[1]) / 2)];
    }
  }
  if (pt[0] !== a.snap[0] || pt[1] !== a.snap[1]) return { ok: false, reason: "orphan_moved" };
  return { ok: true, pt: [pt[0] + 0, pt[1] + 0] };
}

function textPrim(at: Vec<number>, h: PaperUm, s: string, align: "l" | "c", layer: typeof L | typeof L_NOTE = L): Prim<number> {
  return s.includes("\n") ? { layer, key: "text", t: "mtext", at, h, width: NOTE_WIDTH, s } : { layer, key: "text", t: "text", at, h, s, align };
}

/** 구름: 용지 2.5mm 반지름 반원 호를 사각형 네 변에 이어 붙인다(크기는 호 지름의 배수로 맞춤). */
function cloudPrims(c: Vec<Mm>, size_mm: number, ctx: AnnotateContext): Prim<Mm>[] {
  const R = paperToModel(CLOUD_R, ctx.scale);
  const side = paperToModel(r(size_mm * 100), ctx.scale);
  const n = Math.max(1, r(side / (2 * R)));
  const half = n * R;
  const [cx, cy] = c;
  const out: Prim<Mm>[] = [];
  const k = (side: string, i: number) => `cloud:${side}:${String(i).padStart(3, "0")}`;
  for (let i = 0; i < n; i++) {
    const x = cx - half + R + 2 * R * i;
    const y = cy - half + R + 2 * R * i;
    out.push(
      { layer: L, key: k("b", i), t: "arc", c: [x, cy - half], r: R, a0: 180, a1: 0 },
      { layer: L, key: k("l", i), t: "arc", c: [cx - half, y], r: R, a0: 90, a1: 270 },
      { layer: L, key: k("r", i), t: "arc", c: [cx + half, y], r: R, a0: 270, a1: 90 },
      { layer: L, key: k("t", i), t: "arc", c: [x, cy + half], r: R, a0: 0, a1: 180 },
    );
  }
  return out;
}

export interface UserAnnotationResult {
  annotations: Annotation[];
  unapplied: UnappliedAnnotation[];
}

/**
 * SheetSpec.annotations 중 override를 뺀 사람 주석을 A-ANNO-USER 주석으로 만든다. 순서는 id 사전순(배열 순서 무관).
 * view_id: 앵커 주석이 붙는 뷰(시트의 첫 뷰, 좌표 = 모델 mm). 없으면 앵커 주석은 그리지 않는다.
 */
export function applyUserAnnotations(src: Src, view_id: string | undefined, ctx: AnnotateContext): UserAnnotationResult {
  const annotations: Annotation[] = [];
  const unapplied: UnappliedAnnotation[] = [];
  const list = src.sheet.annotations.filter((a): a is Exclude<SheetAnnotation, { kind: "override" }> => a.kind !== "override");
  const m = (um: PaperUm) => paperToModel(um, ctx.scale);
  for (const a of [...list].sort((x, y) => cmpStr(x.id, y.id))) {
    const fail = (reason: UnappliedReason) => unapplied.push({ id: a.id, reason });
    const anchors = a.kind === "dim" ? [a.a, a.b] : a.kind === "text" ? (a.anchor ? [a.anchor] : []) : [a.anchor];
    const shapes = anchors.map((x) => lookup(x.ref, src));
    if (shapes.some((s) => s === null)) {
      fail("orphan_missing");
      continue;
    }
    if (anchors.length > 0 && (view_id === undefined || shapes.some((s) => !(s as Shape).visible))) continue;

    if (a.kind === "dim") {
      const [sa, sb] = shapes as [Shape, Shape];
      if (a.a.at === "foot" && a.b.at === "foot") {
        fail("invalid_anchor");
        continue;
      }
      const footA = a.a.at === "foot";
      const first = footA ? pointOf(a.b, sb, null) : pointOf(a.a, sa, null);
      if (!first.ok) {
        fail(first.reason);
        continue;
      }
      const second = footA ? pointOf(a.a, sa, first.pt) : pointOf(a.b, sb, first.pt);
      if (!second.ok) {
        fail(second.reason);
        continue;
      }
      const [pa, pb] = footA ? [second.pt, first.pt] : [first.pt, second.pt];
      const off = paperMmToUm(a.offset_mm);
      if (off === null) {
        fail("invalid_offset");
        continue;
      }
      if (pa[0] === pb[0] && pa[1] === pb[1]) {
        fail("zero_length");
        continue;
      }
      const value = r(Math.sqrt((pb[0] - pa[0]) ** 2 + (pb[1] - pa[1]) ** 2));
      const tpl = (a.text ?? DIM_VALUE_TOKEN).replace(/[\r\n]+/g, " ");
      const s = tpl.trim() === "" ? String(value) : tpl.split(DIM_VALUE_TOKEN).join(String(value));
      const d = dimension({ anno_id: a.id, view_id: view_id as string, a: pa, b: pb, offset: m(off), value_mm: value, source_ref: USER_DIM_SOURCE_REF }, ctx);
      annotations.push({ ...d, overridable: [], prims: d.prims.map((p) => ({ ...p, layer: L, ...(p.t === "text" ? { s } : {}) }) as Prim<Mm>) });
      continue;
    }

    if (a.kind === "text" && a.hidden === true) continue;
    const dx = paperMmToUm(a.dx_mm);
    const dy = paperMmToUm(a.dy_mm);
    if (dx === null || dy === null) {
      fail("invalid_offset");
      continue;
    }
    if (a.kind !== "cloud" && a.text.trim() === "") {
      fail("empty_text");
      continue;
    }
    if (a.kind === "text" && a.anchor === undefined) {
      annotations.push({ anno_id: a.id, kind: "note", prims: [textPrim([dx, dy], ctx.text_h, a.text, "l", a.id.startsWith("ov-") ? L_NOTE : L)], overridable: [] });
      continue;
    }
    const anchor = a.kind === "text" ? (a.anchor as Anchor) : a.anchor;
    const base = pointOf(anchor, shapes[0] as Shape, null);
    if (!base.ok) {
      fail(base.reason);
      continue;
    }
    const at: Vec<Mm> = [base.pt[0] + m(dx), base.pt[1] + m(dy)];
    if (a.kind === "leader" && at[0] === base.pt[0] && at[1] === base.pt[1]) {
      fail("zero_length");
      continue;
    }
    const prims: Prim<Mm>[] = [];
    if (a.kind === "leader") prims.push({ layer: L, key: "leader", t: "line", a: base.pt, b: at });
    if (a.kind === "cloud") prims.push(...cloudPrims(at, a.size_mm ?? CLOUD_DEFAULT_MM, ctx));
    if (a.text.trim() !== "") prims.push(textPrim(at, ctx.text_h, a.text, a.kind === "cloud" ? "c" : "l") as Prim<Mm>);
    annotations.push({ anno_id: a.id, kind: "note", view_id: view_id as string, prims, overridable: [] });
  }
  return { annotations, unapplied };
}
