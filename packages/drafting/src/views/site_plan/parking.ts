// 간이 주차구획 결정적 배치(02_ARCHITECTURE.md 2.3절 site_plan 행, 제안 규격).
// 도로에 접한 변 중 여유(일반 구획이 들어가는 수)가 큰 변부터, 변을 따라 직각 주차로 장애인 구획 먼저, 일반 구획 다음.
// 대수는 호출자(JudgmentResult 값)가 정한다 — 여기서는 놓을 수 있는 만큼만 놓고 모자란 수를 돌려준다.
import type { Point, Polygon } from "@arch-studio/domain";
import { distance } from "@arch-studio/geometry";
import type { Mm, Vec } from "../../sheet/types.ts";
import { at, edgeFrame, inRingInclusive, strictlyInRing, type EdgeFrame } from "./geom.ts";

/** 일반 2.5m x 5.0m, 장애인 3.3m x 5.0m. */
export const BAY_W_GENERAL: Mm = 2_500;
export const BAY_W_ACCESSIBLE: Mm = 3_300;
export const BAY_DEPTH: Mm = 5_000;
/** 자리가 안 맞을 때 커서를 옮기는 간격. */
const SCAN_STEP: Mm = 500;

export type BayKind = "general" | "accessible";

export interface Bay {
  kind: BayKind;
  edge: number;
  seq: number;
  /** 변 시작점 쪽 도로 변에서 안쪽으로 4점(닫힌 사각형). */
  pts: Vec<Mm>[];
  center: Vec<Mm>;
}

export interface ParkingPlan {
  bays: Bay[];
  placed: number;
  shortfall: number;
  /** 배치를 시도한 첫 변의 번호와 그 변 중점 안쪽 점(경고 위치용). null = 변 없음. */
  anchor: Vec<Mm> | null;
  edge_order: number[];
}

export interface ParkingArgs {
  /** 대지 외곽(입력 순서 그대로: edge_index가 이 순서를 가리킨다). */
  site_ring: readonly Point[];
  /** 도로에 접한 변 번호들. */
  road_edges: readonly number[];
  /** 매스 합집합(장애물). */
  obstacles: readonly Polygon[];
  total: number;
  accessible: number;
}

function rectPoly(pts: Vec<Mm>[]): Polygon {
  return { outer: pts.map((p) => [p[0], p[1]] as Point) };
}

function fits(pts: Vec<Mm>[], center: Vec<Mm>, args: ParkingArgs, others: readonly Bay[]): boolean {
  const ring = args.site_ring;
  const probes: Vec<Mm>[] = [...pts, center];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Vec<Mm>;
    const b = pts[(i + 1) % pts.length] as Vec<Mm>;
    probes.push([Math.trunc((a[0] + b[0]) / 2), Math.trunc((a[1] + b[1]) / 2)]);
  }
  if (!probes.every((p) => inRingInclusive(p, ring))) return false;
  // 대지 꼭짓점이 구획 안에 들어오면(오목 대지) 경계를 넘은 것.
  if (ring.some((v) => strictlyInRing([v[0], v[1]], pts as unknown as Point[]))) return false;
  const poly = rectPoly(pts);
  for (const o of args.obstacles) if (distance(poly, o).d2_mm2 === 0) return false;
  for (const b of others) if (distance(poly, rectPoly(b.pts)).d2_mm2 === 0) return false;
  return true;
}

function bayAt(f: EdgeFrame, s: number, w: Mm): { pts: Vec<Mm>[]; center: Vec<Mm> } {
  return {
    pts: [at(f, s, 0), at(f, s + w, 0), at(f, s + w, BAY_DEPTH), at(f, s, BAY_DEPTH)],
    center: at(f, s + w / 2, BAY_DEPTH / 2),
  };
}

/** 한 변에서 demand 앞에서부터 배치. 놓은 구획을 돌려준다(demand는 호출자가 소비). */
function fillEdge(edge: number, f: EdgeFrame, demand: BayKind[], args: ParkingArgs, placedAll: readonly Bay[]): Bay[] {
  const mine: Bay[] = [];
  // 다른 변에 이미 놓인 구획과는 닿아도 안 된다. 같은 변의 이웃끼리는 변이 맞닿는 것이 정상이라 검사 대상이 아니다.
  let cursor = 0;
  while (demand.length > 0) {
    const kind = demand[0] as BayKind;
    const w = kind === "accessible" ? BAY_W_ACCESSIBLE : BAY_W_GENERAL;
    if (cursor + w > f.len) break;
    const { pts, center } = bayAt(f, cursor, w);
    if (fits(pts, center, args, placedAll)) {
      mine.push({ kind, edge, seq: mine.length, pts, center });
      demand.shift();
      cursor += w;
    } else {
      cursor += SCAN_STEP;
    }
  }
  return mine;
}

export function planParking(args: ParkingArgs): ParkingPlan {
  const total = Math.max(0, args.total);
  const acc = Math.min(Math.max(0, args.accessible), total);
  const n = args.site_ring.length;
  const frames: Array<EdgeFrame | null> = [];
  for (let i = 0; i < n; i++) frames.push(edgeFrame(args.site_ring, i));
  const roadSet = new Set(args.road_edges);
  const valid = (i: number) => frames[i] !== null;
  // 여유 = 일반 구획만 놓았을 때 들어가는 수(빈 대지 기준이 아니라 장애물 반영).
  const capacity = (i: number): number => {
    const f = frames[i] as EdgeFrame;
    const probe: BayKind[] = Array.from({ length: Math.floor(f.len / BAY_W_GENERAL) }, () => "general");
    return fillEdge(i, f, probe, args, []).length;
  };
  const rank = (ids: number[]) =>
    ids
      .map((i) => ({ i, cap: capacity(i), len: (frames[i] as EdgeFrame).len }))
      .sort((x, y) => y.cap - x.cap || y.len - x.len || x.i - y.i)
      .map((r) => r.i);
  const allEdges = Array.from({ length: n }, (_, i) => i).filter(valid);
  const roads = allEdges.filter((i) => roadSet.has(i));
  const others = allEdges.filter((i) => !roadSet.has(i));
  const order = [...rank(roads), ...rank(others)];

  const demand: BayKind[] = [...Array<BayKind>(acc).fill("accessible"), ...Array<BayKind>(total - acc).fill("general")];
  const bays: Bay[] = [];
  if (total > 0) {
    for (const i of order) {
      if (demand.length === 0) break;
      bays.push(...fillEdge(i, frames[i] as EdgeFrame, demand, args, bays));
    }
  }
  let anchor: Vec<Mm> | null = null;
  const first = order[0];
  if (first !== undefined) {
    const f = frames[first] as EdgeFrame;
    anchor = at(f, Math.trunc(f.len / 2), BAY_DEPTH + 1_000);
  }
  return { bays, placed: bays.length, shortfall: demand.length, anchor, edge_order: order };
}
