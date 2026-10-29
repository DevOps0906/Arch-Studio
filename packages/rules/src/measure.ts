// DesignModel 측정값(법규 수치 없음): 대지면적·건축면적·연면적·높이·층수·용도별 바닥면적·변별 최단거리.
// 면적은 2배 면적(mm², 정확한 정수, bigint)으로 들고 다닌다. 거리는 정확한 제곱 거리 num/den(compareDistance 입력).
// 산정 가정(법령 원문 대조 전, 팀장 확인 필요):
//  - 건축면적 = 지상층(level ≥ 1)이 있는 매스 바닥 외곽의 합집합 면적(수평투영, 처마·발코니 제외 규정 미반영).
//  - 층 바닥면적 = 층마다 같은 level 매스 외곽 합집합. 지상(level ≥ 1)·지하 합을 따로 낸다 — 용적률 산정 제외 항목은 팩(judge)이 고른다.
//  - 연면적 = 모든 층(지하 포함). 지하층 전용 매스는 건축면적·대지 밖 검사·이격 측정에서 뺀다.
//  - 높이 = max(base_level_mm + 지상층 층고 합). 지붕 경사·옥탑 미반영.
import type { DesignModelV1, Point, Polygon } from "@arch-studio/domain";
import { area2, union } from "@arch-studio/geometry";
import { RulesError } from "./errors.ts";

export interface ExactD2 {
  num: bigint;
  den: bigint;
}

export interface EdgeMeasure {
  /** 원래(정규화 전) 외곽 변 번호: outer[i] → outer[(i+1) % n]. */
  index: number;
  edge_class: "road" | "adjacent";
  /** 매스 외곽까지 정확한 제곱 거리. 매스가 없으면 null. */
  d2: ExactD2 | null;
}

export interface Measurements {
  site_area2: bigint;
  building_area2: bigint;
  /** 지상층(level ≥ 1) 바닥면적 합. */
  above_area2: bigint;
  /** 지하층(level ≤ 0) 바닥면적 합. */
  below_area2: bigint;
  gross_area2: bigint;
  height_mm: number;
  /** 지상 최고 층 번호(level). 지상층이 없으면 0. */
  above_floors: number;
  /** 용도별 바닥면적(2배 mm², 모든 층). 키 사전순. */
  floor_area2_by_use: [string, bigint][];
  edges: EdgeMeasure[];
  /** 매스 외곽이 대지 밖으로 나가면 true(이격은 0으로 본다). */
  mass_outside_site: boolean;
}

function sumArea2(polygons: readonly Polygon[]): bigint {
  return polygons.reduce((s, p) => s + BigInt(area2(p)), 0n);
}

/** 겹칠 수 있는 외곽들의 합집합 면적. 1개면 그대로(정확), 여럿이면 union(교차점 정수 스냅). */
function unionArea2(footprints: readonly Polygon[]): bigint {
  if (footprints.length === 0) return 0n;
  if (footprints.length === 1) return BigInt(area2(footprints[0] as Polygon));
  return sumArea2(union(footprints));
}

type Seg = readonly [Point, Point];

function segments(p: Polygon): Seg[] {
  const out: Seg[] = [];
  for (const ring of [p.outer, ...(p.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) out.push([ring[i] as Point, ring[(i + 1) % ring.length] as Point]);
  }
  return out;
}

/** (b-a)×(c-a). 좌표 ±10^7이라 곱 ≤ 8×10^14 < 2^53, 정확. */
function orient(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function within(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  );
}

function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = Math.sign(orient(a, b, c));
  const o2 = Math.sign(orient(a, b, d));
  const o3 = Math.sign(orient(c, d, a));
  const o4 = Math.sign(orient(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (o1 === 0 && within(a, b, c)) || (o2 === 0 && within(a, b, d)) || (o3 === 0 && within(c, d, a)) || (o4 === 0 && within(c, d, b))
  );
}

interface Cand {
  approx: number;
  exact: () => ExactD2;
}

/** 점 p와 선분 a-b의 제곱 거리(근사 + 정확값 지연 계산). */
function pointSeg(p: Point, a: Point, b: Point): Cand {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy;
  const len2 = dx * dx + dy * dy;
  if (t <= 0 || t >= len2) {
    const q = t <= 0 ? a : b;
    const ex = p[0] - q[0];
    const ey = p[1] - q[1];
    const d2 = ex * ex + ey * ey;
    return { approx: d2, exact: () => ({ num: BigInt(d2), den: 1n }) };
  }
  const cr = orient(a, b, p);
  return { approx: (cr * cr) / len2, exact: () => ({ num: BigInt(cr) * BigInt(cr), den: BigInt(len2) }) };
}

const REL = 1e-9;

/** 선분 e와 다각형들의 경계 사이 정확한 최단 제곱 거리. 만나면 0. */
function edgeToPolygons(e: Seg, segs: readonly Seg[]): ExactD2 {
  let best: ExactD2 | null = null;
  let bestApprox = Number.POSITIVE_INFINITY;
  const consider = (c: Cand) => {
    if (c.approx > bestApprox * (1 + REL)) return;
    const x = c.exact();
    if (best && x.num * best.den >= best.num * x.den) return;
    best = x;
    bestApprox = c.approx;
  };
  for (const [c, d] of segs) {
    if (segmentsMeet(e[0], e[1], c, d)) return { num: 0n, den: 1n };
    consider(pointSeg(e[0], c, d));
    consider(pointSeg(e[1], c, d));
    consider(pointSeg(c, e[0], e[1]));
    consider(pointSeg(d, e[0], e[1]));
  }
  return best as ExactD2 | null ?? { num: 0n, den: 1n };
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/** sqrt(num/den)을 half-away 반올림한 mm(표시용 — 판정 비교는 compareDistance). */
export function displayDistanceMm(d2: ExactD2): number {
  const r = isqrt(d2.num / d2.den);
  const up = 4n * d2.num >= (2n * r + 1n) * (2n * r + 1n) * d2.den;
  return Number(up ? r + 1n : r);
}

/** DesignModel 측정. 대지·매스 다각형은 geometry가 검사한다(GeometryError). */
export function measure(model: DesignModelV1): Measurements {
  const { site } = model;
  const outer = site.boundary.outer;
  const roadEdges = new Set<number>();
  for (const road of site.roads) {
    if (road.edge_index >= outer.length) {
      throw new RulesError("INVALID_INPUT", `도로 변 번호 ${road.edge_index}가 대지 외곽 변 수(${outer.length})를 넘습니다`);
    }
    roadEdges.add(road.edge_index);
  }
  const site_area2 = BigInt(area2(site.boundary));

  const aboveMasses = model.masses.filter((m) => m.floors.some((f) => f.level >= 1));
  const footprints = aboveMasses.map((m) => m.footprint);
  const building_area2 = unionArea2(footprints);

  const levels = new Map<number, Polygon[]>();
  const useArea = new Map<string, bigint>();
  let height_mm = 0;
  let above_floors = 0;
  for (const m of model.masses) {
    const a2 = BigInt(area2(m.footprint));
    let h = m.base_level_mm;
    for (const f of m.floors) {
      levels.set(f.level, [...(levels.get(f.level) ?? []), m.footprint]);
      useArea.set(f.use, (useArea.get(f.use) ?? 0n) + a2);
      if (f.level >= 1) {
        h += f.height_mm;
        above_floors = Math.max(above_floors, f.level);
      }
    }
    if (m.floors.some((f) => f.level >= 1)) height_mm = Math.max(height_mm, h);
  }
  let above_area2 = 0n;
  let below_area2 = 0n;
  let gross_area2 = 0n;
  for (const level of [...levels.keys()].sort((a, b) => a - b)) {
    const a = unionArea2(levels.get(level) as Polygon[]);
    gross_area2 += a;
    if (level >= 1) above_area2 += a;
    else below_area2 += a;
  }

  const mass_outside_site =
    footprints.length > 0 && sumArea2(union([site.boundary, ...footprints])) > site_area2;
  const massSegs = footprints.flatMap(segments);
  const edges: EdgeMeasure[] = outer.map((p, i) => {
    const e: Seg = [p, outer[(i + 1) % outer.length] as Point];
    const d2 = massSegs.length === 0 ? null : mass_outside_site ? { num: 0n, den: 1n } : edgeToPolygons(e, massSegs);
    return { index: i, edge_class: roadEdges.has(i) ? "road" : "adjacent", d2 };
  });

  return {
    site_area2,
    building_area2,
    above_area2,
    below_area2,
    gross_area2,
    height_mm,
    above_floors,
    floor_area2_by_use: [...useArea.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    edges,
    mass_outside_site,
  };
}
