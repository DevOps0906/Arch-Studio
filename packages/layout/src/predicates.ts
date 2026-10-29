// 정수 판정자(layout 내부용). geometry는 다각형 연산(union·area2·normalizePolygon)만 내보내므로
// 겹침·포함의 빠른 경로에 필요한 방향·교차·점 포함 판정을 여기 둔다. 좌표 |v| ≤ 10^7mm, 2배 좌표 차의 곱 < 2^53 → number로 정확.
import type { Polygon } from "@arch-studio/domain";

export type Pt = readonly [number, number];
export type Box = [number, number, number, number]; // minX, minY, maxX, maxY

/** a→b 기준 c: >0 왼쪽, <0 오른쪽, 0 일직선. */
export function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Pt, b: Pt, c: Pt): boolean {
  if (orient(a, b, c) !== 0) return false;
  return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
}

/** 두 선분 내부가 한 점에서 가로지른다(끝점·일직선 접촉 제외). */
export function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = Math.sign(orient(c, d, a));
  const d2 = Math.sign(orient(c, d, b));
  const d3 = Math.sign(orient(a, b, c));
  const d4 = Math.sign(orient(a, b, d));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 두 닫힌 선분이 한 점이라도 공유한다. */
export function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (properCross(a, b, c, d)) return true;
  return onSegment(c, d, a) || onSegment(c, d, b) || onSegment(a, b, c) || onSegment(a, b, d);
}

/** 2배 좌표 점 p2가 고리(원래 좌표) 안: 1 안, -1 밖, 0 경계 위. */
export function pointInRing2(p2: Pt, ring: readonly Pt[]): -1 | 0 | 1 {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ri = ring[i] as Pt;
    const rj = ring[j] as Pt;
    const a: Pt = [rj[0] * 2, rj[1] * 2];
    const b: Pt = [ri[0] * 2, ri[1] * 2];
    if (onSegment(a, b, p2)) return 0;
    if (a[1] > p2[1] !== b[1] > p2[1]) {
      const o = orient(a, b, p2);
      if (b[1] > a[1] ? o > 0 : o < 0) inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

/** 다각형(구멍 포함) 기준 2배 좌표 점의 위치. */
export function pointInPolygon2(p2: Pt, poly: Polygon): -1 | 0 | 1 {
  const o = pointInRing2(p2, poly.outer);
  if (o !== 1) return o;
  for (const h of poly.holes ?? []) {
    const s = pointInRing2(p2, h);
    if (s === 0) return 0;
    if (s === 1) return -1;
  }
  return 1;
}

/** 여러 다각형(서로 내부가 겹치지 않는 합집합 결과) 기준 위치. */
export function pointInPolygons2(p2: Pt, polys: readonly Polygon[]): -1 | 0 | 1 {
  let best: -1 | 0 | 1 = -1;
  for (const p of polys) {
    const s = pointInPolygon2(p2, p);
    if (s === 1) return 1;
    if (s === 0) best = 0;
  }
  return best;
}

export function ringsOf(p: Polygon): Pt[][] {
  return [p.outer, ...(p.holes ?? [])];
}

export function boxOf(polys: readonly Polygon[]): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) {
    for (const [x, y] of p.outer) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  }
  return b;
}

/** 상자 내부(넓이 > 0)가 겹친다. 변·꼭짓점 접촉은 겹침이 아니다. */
export function boxInteriorsOverlap(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** 닫힌 상자가 만난다(접촉 포함). */
export function boxesTouch(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** 다각형 표본점(2배 좌표): 꼭짓점과 변 중점. 다각형의 닫힌 영역에 속하고 내부에 가까운 점들이다. */
export function samplePoints2(p: Polygon): Pt[] {
  const out: Pt[] = [];
  for (const ring of ringsOf(p)) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as Pt;
      const b = ring[(i + 1) % ring.length] as Pt;
      out.push([a[0] * 2, a[1] * 2], [a[0] + b[0], a[1] + b[1]]);
    }
  }
  return out;
}

/** 두 고리 묶음 사이에 내부 교차(proper crossing)가 있는가. touch=true면 접촉까지. */
export function anyEdgeHit(ra: readonly Pt[][], rb: readonly Pt[][], touch: boolean): boolean {
  for (const r1 of ra) {
    for (let i = 0; i < r1.length; i++) {
      const a = r1[i] as Pt;
      const b = r1[(i + 1) % r1.length] as Pt;
      const ax0 = Math.min(a[0], b[0]);
      const ax1 = Math.max(a[0], b[0]);
      const ay0 = Math.min(a[1], b[1]);
      const ay1 = Math.max(a[1], b[1]);
      for (const r2 of rb) {
        for (let j = 0; j < r2.length; j++) {
          const c = r2[j] as Pt;
          const d = r2[(j + 1) % r2.length] as Pt;
          if (Math.max(c[0], d[0]) < ax0 || Math.min(c[0], d[0]) > ax1 || Math.max(c[1], d[1]) < ay0 || Math.min(c[1], d[1]) > ay1) continue;
          if (touch ? segmentsTouch(a, b, c, d) : properCross(a, b, c, d)) return true;
        }
      }
    }
  }
  return false;
}
