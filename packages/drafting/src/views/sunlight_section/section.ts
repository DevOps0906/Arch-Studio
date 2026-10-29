// sunlight_section 단면 기하: 단면선과 다각형의 교차(짝수-홀수 규칙), 무게중심, 반평면 자르기. 사칙연산·sqrt만(결정적).
import type { Polygon } from "@arch-studio/domain";
import type { Vec } from "../../sheet/types.ts";

export type Pt = [number, number];

export interface Crossing {
  /** 정북 방향 좌표 u = (교점 − 기준점) · 정북. */
  u: number;
  /** 교차한 변이 속한 고리 번호(0 = 외곽 고리). */
  ring: number;
  edge: number;
}

/** 다각형 모든 고리와 단면선(기준점 P, 방향 D)의 교점. 꼭짓점 위를 지날 때 한 번만 세도록 반열림 규칙을 쓴다. */
export function lineCrossings(poly: Polygon, P: Vec<number>, D: Vec<number>, north: Vec<number>): Crossing[] {
  const out: Crossing[] = [];
  const rings = [poly.outer, ...(poly.holes ?? [])];
  rings.forEach((ring, ri) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const A = ring[i] as Vec<number>;
      const B = ring[(i + 1) % n] as Vec<number>;
      const sA = D[0] * (A[1] - P[1]) - D[1] * (A[0] - P[0]);
      const sB = D[0] * (B[1] - P[1]) - D[1] * (B[0] - P[0]);
      if (sA > 0 === sB > 0) continue;
      const t = sA / (sA - sB);
      const x = A[0] + t * (B[0] - A[0]);
      const y = A[1] + t * (B[1] - A[1]);
      out.push({ u: (x - P[0]) * north[0] + (y - P[1]) * north[1], ring: ri, edge: i });
    }
  });
  return out.sort((a, b) => a.u - b.u || a.ring - b.ring || a.edge - b.edge);
}

/** 정렬된 교점을 (0,1), (2,3)… 쌍으로 묶은 안쪽 구간. */
export function insideIntervals(crossings: readonly Crossing[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) out.push([(crossings[i] as Crossing).u, (crossings[i + 1] as Crossing).u]);
  return out;
}

/** 다각형 면적(×2)과 면적 모멘트(x·면적, y·면적). 구멍은 음의 면적. */
export function polygonMoments(poly: Polygon): { area: number; mx: number; my: number } {
  let area = 0;
  let mx = 0;
  let my = 0;
  [poly.outer, ...(poly.holes ?? [])].forEach((ring, ri) => {
    let ra = 0;
    let rx = 0;
    let ry = 0;
    for (let i = 0; i < ring.length; i++) {
      const A = ring[i] as Vec<number>;
      const B = ring[(i + 1) % ring.length] as Vec<number>;
      const cr = A[0] * B[1] - B[0] * A[1];
      ra += cr;
      rx += (A[0] + B[0]) * cr;
      ry += (A[1] + B[1]) * cr;
    }
    if (ra === 0) return;
    const k = ri === 0 ? 1 : -1;
    const s = (ra > 0 ? 1 : -1) * k;
    area += k * Math.abs(ra);
    mx += (s * rx) / 3;
    my += (s * ry) / 3;
  });
  return { area, mx, my };
}

/** f(p) ≥ 0인 쪽만 남기는 반평면 자르기(Sutherland–Hodgman). f는 선형. */
export function clipHalfPlane(poly: readonly Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i] as Pt;
    const next = poly[(i + 1) % poly.length] as Pt;
    const fc = f(cur);
    const fn = f(next);
    if (fc >= 0) out.push(cur);
    if (fc >= 0 !== fn >= 0) {
      const t = fc / (fc - fn);
      out.push([cur[0] + t * (next[0] - cur[0]), cur[1] + t * (next[1] - cur[1])]);
    }
  }
  return out;
}
