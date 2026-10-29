// 문·창 블록 정의(BLOCK)와 배치(INSERT). 블록 국소 좌표: x = 벽을 따라(개구부 시작 0 → 끝 width), y = 호스트 실 안쪽,
// 원점 = 개구부 시작점(벽 중심선). 변이 축에 평행하면 INSERT 회전(0·90·180·270)으로 놓고, 아니면(INSERT 회전이 90° 배수만)
// 블록 정의를 그 방향으로 미리 돌린 별도 블록을 rot 0으로 놓는다. 미리 돌린 문 호는 고정 각도 표(사칙연산·sqrt만, 초월함수 없음)의 꺾은선.
import type { OpeningPlacement } from "@arch-studio/layout";
import { roundHalfAway } from "@arch-studio/geometry";
import type { BlockDef, Mm, Prim, Vec } from "../../sheet/types.ts";

/** cos·sin(15° × k), k = 0..6. 상수 리터럴(Math.cos 금지). */
const COS15 = [1, 0.9659258262890683, 0.8660254037844387, 0.7071067811865476, 0.5, 0.25881904510252074, 0];

const sgn = (v: number) => (v < 0 ? `m${-v}` : `${v}`);

/** 블록 이름: DOOR-W900-T100-L, WIN-W1200-T200, 미리 돌린 것은 -D3_m4(국소 x 방향 원시 벡터). */
export function blockName(p: OpeningPlacement): string {
  const base = p.kind === "door" ? `DOOR-W${p.width_mm}-T${p.thickness_mm}-${p.swing === "left" ? "L" : "R"}` : `WIN-W${p.width_mm}-T${p.thickness_mm}`;
  return p.rot_deg === null ? `${base}-D${sgn(p.dir[0])}_${sgn(p.dir[1])}` : base;
}

/** 국소 좌표 도형(회전 전). 문 호는 axis=true면 ARC, 아니면 15° 꺾은선 점 목록으로 돌려준다. */
function localEntities(p: OpeningPlacement, axis: boolean): Array<Prim<number>> {
  const w = p.width_mm;
  const h = roundHalfAway(p.thickness_mm / 2);
  if (p.kind === "window") {
    const L = "A-GLAZ" as const;
    return [
      { layer: L, key: "jamb:0", t: "line", a: [0, -h], b: [0, h] },
      { layer: L, key: "jamb:1", t: "line", a: [w, -h], b: [w, h] },
      { layer: L, key: "face:in", t: "line", a: [0, h], b: [w, h] },
      { layer: L, key: "face:out", t: "line", a: [0, -h], b: [w, -h] },
      { layer: L, key: "glass", t: "line", a: [0, 0], b: [w, 0] },
    ];
  }
  const L = "A-DOOR" as const;
  // 'left' = 실 안에서 벽을 볼 때 왼손 쪽 경첩 = 국소 x = w(OpeningPlacement.swing 정의).
  const hx = p.swing === "left" ? w : 0;
  const out: Array<Prim<number>> = [
    { layer: L, key: "jamb:0", t: "line", a: [0, -h], b: [0, h] },
    { layer: L, key: "jamb:1", t: "line", a: [w, -h], b: [w, h] },
    { layer: L, key: "leaf", t: "line", a: [hx, h], b: [hx, h + w] },
  ];
  if (axis) {
    out.push(p.swing === "left" ? { layer: L, key: "swing", t: "arc", c: [hx, h], r: w, a0: 90, a1: 180 } : { layer: L, key: "swing", t: "arc", c: [hx, h], r: w, a0: 0, a1: 90 });
  } else {
    // 닫힌 위치(벽을 따라) → 열린 위치(실 안쪽 수직). 0°·90° 끝은 정확.
    const dirX = p.swing === "left" ? -1 : 1;
    const pts: Vec<number>[] = COS15.map((c, k) => [hx + dirX * w * c, h + w * (COS15[6 - k] as number)]);
    out.push({ layer: L, key: "swing", t: "pline", closed: false, pts });
  }
  return out;
}

/** 국소 → 블록 좌표(미리 돌림). R = [x̂ ŷ], x̂ = dir/|dir|, ŷ = x̂를 반시계 90°. 반올림 mm. */
function rotateEntities(ents: Array<Prim<number>>, dir: Vec<number>): Prim<Mm>[] {
  const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
  const cx = dir[0] / len;
  const cy = dir[1] / len;
  const tr = (v: Vec<number>): Vec<Mm> => [roundHalfAway(v[0] * cx - v[1] * cy), roundHalfAway(v[0] * cy + v[1] * cx)];
  return ents.map((e) => {
    switch (e.t) {
      case "line":
        return { ...e, a: tr(e.a), b: tr(e.b) };
      case "pline":
        return { ...e, pts: e.pts.map(tr) };
      default:
        return e; // 미리 돌리는 블록에는 선·꺾은선만 있다
    }
  });
}

export function blockDef(p: OpeningPlacement): BlockDef {
  const axis = p.rot_deg !== null;
  const ents = localEntities(p, axis);
  return { name: blockName(p), entities: axis ? (ents as Prim<Mm>[]) : rotateEntities(ents, p.dir) };
}

/** 배치마다 INSERT 1개 + 필요한 블록 정의(이름 사전순, 중복 제거). */
export function openingPrims(placements: readonly OpeningPlacement[]): { prims: Prim<Mm>[]; blocks: BlockDef[] } {
  const defs = new Map<string, BlockDef>();
  const prims: Prim<Mm>[] = [];
  for (const p of placements) {
    const def = blockDef(p);
    if (!defs.has(def.name)) defs.set(def.name, def);
    prims.push({
      layer: p.kind === "door" ? "A-DOOR" : "A-GLAZ",
      key: `opening:${p.opening_id}`,
      t: "insert",
      block: def.name,
      at: [p.origin[0], p.origin[1]],
      rot_deg: p.rot_deg ?? 0,
    });
  }
  const names = [...defs.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { prims, blocks: names.map((n) => defs.get(n) as BlockDef) };
}
