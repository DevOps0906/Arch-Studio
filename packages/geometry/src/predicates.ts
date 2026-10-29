// 정수 좌표 판정자. 좌표 절댓값 ≤ 2^24 (2배 좌표도 ≤ 2^25)이면 차의 곱이 2^52 미만이라
// number 사칙연산으로 정확하다(arrangement.ts ARRANGEMENT_LIMIT).
import type { Point } from "@arch-studio/domain";

export type Pt = readonly [number, number];

/** a→b 기준 c의 방향: >0 왼쪽(반시계), <0 오른쪽, 0 일직선. */
export function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function samePt(a: Pt, b: Pt): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function ptKey(p: Pt): string {
  return `${p[0]},${p[1]}`;
}

/** 사전순 비교(x 다음 y). */
export function cmpPt(a: Pt, b: Pt): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** c가 a-b 위(끝점 포함)에 있는가. */
export function onSegment(a: Pt, b: Pt, c: Pt): boolean {
  if (orient(a, b, c) !== 0) return false;
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

/** 두 닫힌 선분이 한 점이라도 공유하는가. */
export function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = Math.sign(orient(c, d, a));
  const d2 = Math.sign(orient(c, d, b));
  const d3 = Math.sign(orient(a, b, c));
  const d4 = Math.sign(orient(a, b, d));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return onSegment(c, d, a) || onSegment(c, d, b) || onSegment(a, b, c) || onSegment(a, b, d);
}

/** 내부끼리 한 점에서 교차(끝점·일직선 제외). */
export function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = Math.sign(orient(c, d, a));
  const d2 = Math.sign(orient(c, d, b));
  const d3 = Math.sign(orient(a, b, c));
  const d4 = Math.sign(orient(a, b, d));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** 일직선 두 선분이 길이 > 0 구간을 공유하는가. */
export function collinearOverlap(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  if (orient(a, b, c) !== 0 || orient(a, b, d) !== 0) return false;
  const ax = a[0] !== b[0] ? 0 : 1; // 투영 축
  const lo1 = Math.min(a[ax], b[ax]);
  const hi1 = Math.max(a[ax], b[ax]);
  const lo2 = Math.min(c[ax], d[ax]);
  const hi2 = Math.max(c[ax], d[ax]);
  return Math.min(hi1, hi2) > Math.max(lo1, lo2);
}

/**
 * 점(2배 좌표) p가 고리(원래 좌표) 안에 있는가: 1 안, -1 밖, 0 경계 위.
 * 2배 좌표를 쓰면 변의 중점도 정수로 시험할 수 있다.
 */
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

/** 고리의 2배 부호 면적(정확, bigint 누적). 반시계 양수. */
export function ringArea2(ring: readonly Pt[]): bigint {
  let s = 0n;
  const n = ring.length;
  const o = ring[0] as Pt;
  for (let i = 1; i + 1 < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[i + 1] as Pt;
    s += BigInt(orient(o, a, b));
  }
  return s;
}

export function copyPt(p: Pt): Point {
  return [p[0] + 0, p[1] + 0];
}
