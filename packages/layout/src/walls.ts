// 벽 두께 적용(AR-F-032 "벽 두께 자동", 02_ARCHITECTURE.md floor_plan 행 "외벽 200·내벽 100mm 오프셋").
// 가정: 실 다각형과 층 외곽은 벽 중심선이다(area_plan "매스 외곽 = 외벽 중심선 가정"과 같은 정의 → 실 면적 = 중심선 면적).
// 외벽 = 층 외곽 경계 전체, 내벽 = 실 변 중 외곽 경계에 놓이지 않은 부분. 같은 직선 위 겹치는 변은 하나로 합친다(공유 내벽 1번).
// 직선은 정수 원시 방향 u(gcd 1, 부호 고정)와 c = u × p로 묶고, 직선 위 위치는 t = u · p(정수 꼭짓점이면 정수)로 잰다.
import type { Point, Polygon } from "@arch-studio/domain";
import { roundHalfAway, union } from "@arch-studio/geometry";
import { ringsOf, type Pt } from "./predicates.ts";
import type { OpeningPlacement, WallKind, WallSegment, WallSpec } from "./types.ts";

export interface LineInfo {
  key: string;
  ux: number;
  uy: number;
  c: number;
  /** |u|². */
  l2: number;
}

/** 직선 위 구간 [lo, hi](t 단위). */
export type Iv = [number, number];

export interface WallPiece {
  line: LineInfo;
  kind: WallKind;
  lo: number;
  hi: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** 선분 a→b가 놓인 직선과 a·b의 t. 길이 0이면 null. */
export function lineOf(a: Pt, b: Pt): { line: LineInfo; ta: number; tb: number } | null {
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return null;
  const g = gcd(dx, dy);
  dx /= g;
  dy /= g;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const c = dx * a[1] - dy * a[0];
  const line: LineInfo = { key: `${dx},${dy},${c}`, ux: dx, uy: dy, c, l2: dx * dx + dy * dy };
  return { line, ta: dx * a[0] + dy * a[1], tb: dx * b[0] + dy * b[1] };
}

/** 직선 위 t의 점(실수). 정수 꼭짓점의 t면 정확한 정수. */
export function pointAt(line: LineInfo, t: number): [number, number] {
  return [(t * line.ux - line.c * line.uy) / line.l2, (t * line.uy + line.c * line.ux) / line.l2];
}

function mergeIv(ivs: Iv[]): Iv[] {
  const s = [...ivs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Iv[] = [];
  for (const [lo, hi] of s) {
    const last = out[out.length - 1];
    if (last !== undefined && lo <= last[1]) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

/** ivs − cuts(둘 다 병합된 정렬 구간). 결과 조각마다 양 끝이 원래 끝인지(true) 잘린 끝인지(false). */
export function subtractIv(ivs: readonly Iv[], cuts: readonly Iv[]): Array<{ lo: number; hi: number; keepLo: boolean; keepHi: boolean }> {
  const out: Array<{ lo: number; hi: number; keepLo: boolean; keepHi: boolean }> = [];
  for (const [lo, hi] of ivs) {
    let cur = lo;
    let keepLo = true;
    for (const [c0, c1] of cuts) {
      if (c1 <= cur || c0 >= hi) continue;
      if (c0 > cur) out.push({ lo: cur, hi: c0, keepLo, keepHi: false });
      cur = Math.max(cur, c1);
      keepLo = false;
      if (cur >= hi) break;
    }
    if (cur < hi) out.push({ lo: cur, hi, keepLo, keepHi: true });
  }
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function addRings(map: Map<string, { line: LineInfo; ivs: Iv[] }>, rings: readonly (readonly Pt[])[]): void {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const l = lineOf(ring[i] as Pt, ring[(i + 1) % ring.length] as Pt);
      if (l === null) continue;
      const e = map.get(l.line.key) ?? { line: l.line, ivs: [] };
      e.ivs.push([Math.min(l.ta, l.tb), Math.max(l.ta, l.tb)]);
      map.set(l.line.key, e);
    }
  }
}

/** 벽 조각(중심선 구간). 직선 키 사전순 → 외벽 먼저 → t 오름차순. */
export function wallPieces(rooms: readonly Polygon[], outline: readonly Polygon[]): WallPiece[] {
  const ext = new Map<string, { line: LineInfo; ivs: Iv[] }>();
  const int = new Map<string, { line: LineInfo; ivs: Iv[] }>();
  addRings(ext, outline.flatMap(ringsOf));
  addRings(int, rooms.flatMap(ringsOf));
  const keys = [...new Set([...ext.keys(), ...int.keys()])].sort(cmp);
  const out: WallPiece[] = [];
  for (const k of keys) {
    const e = ext.get(k);
    const i = int.get(k);
    const line = (e ?? i)?.line as LineInfo;
    const eIv = e ? mergeIv(e.ivs) : [];
    for (const [lo, hi] of eIv) out.push({ line, kind: "exterior", lo, hi });
    if (i) for (const p of subtractIv(mergeIv(i.ivs), eIv)) out.push({ line, kind: "interior", lo: p.lo, hi: p.hi });
  }
  return out;
}

export const thicknessOf = (kind: WallKind, walls: WallSpec) => (kind === "exterior" ? walls.exterior_mm : walls.interior_mm);

const rp = (v: [number, number]): Point => [roundHalfAway(v[0]), roundHalfAway(v[1])];

/** 벽 중심선 조각(외벽·내벽, 두께 포함). */
export function wallSegments(rooms: readonly Polygon[], outline: readonly Polygon[], walls: WallSpec): WallSegment[] {
  return wallPieces(rooms, outline).map((p) => ({
    key: `${p.kind}:${p.line.key}:${p.lo}`,
    kind: p.kind,
    thickness_mm: thicknessOf(p.kind, walls),
    a: rp(pointAt(p.line, p.lo)),
    b: rp(pointAt(p.line, p.hi)),
  }));
}

/** 직선 위 [lo, hi] 띠(두께 thk)의 사각형. 양 끝 ext(t 단위)만큼 늘인다. 꼭짓점은 half-away 반올림. */
function band(line: LineInfo, lo: number, hi: number, thk: number, extLo: number, extHi: number): Polygon | null {
  const len = Math.sqrt(line.l2);
  const nx = -line.uy / len;
  const ny = line.ux / len;
  const h = thk / 2;
  const p0 = pointAt(line, lo - extLo);
  const p1 = pointAt(line, hi + extHi);
  const pts: Point[] = [
    rp([p0[0] - nx * h, p0[1] - ny * h]),
    rp([p1[0] - nx * h, p1[1] - ny * h]),
    rp([p1[0] + nx * h, p1[1] + ny * h]),
    rp([p0[0] + nx * h, p0[1] + ny * h]),
  ];
  // 반올림으로 꼭짓점이 겹치거나 넓이가 0이면 버린다.
  const a2 = (pts[1]![0] - pts[0]![0]) * (pts[3]![1] - pts[0]![1]) - (pts[1]![1] - pts[0]![1]) * (pts[3]![0] - pts[0]![0]);
  return a2 === 0 ? null : { outer: pts };
}

/**
 * 벽 띠 다각형(합집합). 문·창 자리는 벽을 끊는다(끊긴 끝은 늘이지 않음, 원래 끝은 두께/2 늘여 모서리를 메운다).
 * 결과는 geometry.union 정규형(외곽 반시계·구멍 시계, 정렬)이라 결정적이다.
 */
export function wallBands(rooms: readonly Polygon[], outline: readonly Polygon[], placements: readonly OpeningPlacement[], walls: WallSpec): Polygon[] {
  const cuts = new Map<string, Iv[]>();
  for (const pl of placements) {
    const list = cuts.get(pl.line_key) ?? [];
    list.push([Math.min(pl.t[0], pl.t[1]), Math.max(pl.t[0], pl.t[1])]);
    cuts.set(pl.line_key, list);
  }
  const rects: Polygon[] = [];
  for (const p of wallPieces(rooms, outline)) {
    const thk = thicknessOf(p.kind, walls);
    const ext = (thk / 2) * Math.sqrt(p.line.l2);
    for (const s of subtractIv([[p.lo, p.hi]], mergeIv(cuts.get(p.line.key) ?? []))) {
      const r = band(p.line, s.lo, s.hi, thk, s.keepLo ? ext : 0, s.keepHi ? ext : 0);
      if (r) rects.push(r);
    }
  }
  return rects.length === 0 ? [] : union(rects);
}
