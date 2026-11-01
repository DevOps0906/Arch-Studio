// 최소 면적 회전 직사각형(회전 캘리퍼스): 외곽의 볼록 껍질 각 변 방향마다 외접 직사각형을 재고 면적이 가장 작은 것을 고른다.
// 투영·외적은 정수(좌표 ≤ 10^7 → 값 < 2^53), 면적 비교는 bigint 교차곱으로 정확하다. 변 길이만 sqrt·나눗셈 후 half-away 반올림(IEEE 정확 반올림 → 결정적).
// 구멍은 보지 않는다(외곽만). 같은 면적이면 껍질 시작점(최소 x, 다음 최소 y)에서 반시계로 먼저 만난 변을 쓴다.
import type { Point, Polygon } from "@arch-studio/domain";
import { roundHalfAway, roundRatioHalfAway } from "./round.ts";
import { normalizePolygon } from "./validate.ts";

export interface OrientedRect {
  /** 가로(mm 정수): 두 변 중 방향이 x축에 더 가까운 변의 길이(45°면 껍질 변 방향 쪽). */
  readonly widthMm: number;
  /** 세로(mm 정수): 나머지 변의 길이. */
  readonly depthMm: number;
  /** 네 꼭짓점(mm 정수로 반올림, 반시계). 표시용. */
  readonly corners: readonly [Point, Point, Point, Point];
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** 볼록 껍질(Andrew monotone chain, 반시계, 일직선 점 제외). */
function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Point, lower[lower.length - 1] as Point, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as Point;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Point, upper[upper.length - 1] as Point, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * 최소 면적 회전 직사각형. 입력은 normalizePolygon으로 검사한다(자기교차·퇴화·범위 밖은 GeometryError).
 * 같은 입력 → 같은 결과(초월함수 없음).
 */
export function minAreaRect(polygon: Polygon): OrientedRect {
  const hull = convexHull(normalizePolygon(polygon).outer);
  const o = hull[0] as Point;
  let best: { dx: number; dy: number; l2: number; s0: number; s1: number; t0: number; t1: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i] as Point;
    const b = hull[(i + 1) % hull.length] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const p of hull) {
      const px = p[0] - o[0];
      const py = p[1] - o[1];
      const s = px * dx + py * dy;
      const t = dx * py - dy * px;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
    // 면적 = (s1-s0)(t1-t0)/l2. 분모를 교차로 곱해 비교: R_i·l2_best < R_best·l2_i
    if (best === null || BigInt(s1 - s0) * BigInt(t1 - t0) * BigInt(best.l2) < BigInt(best.s1 - best.s0) * BigInt(best.t1 - best.t0) * BigInt(l2)) {
      best = { dx, dy, l2, s0, s1, t0, t1 };
    }
  }
  const { dx, dy, l2, s0, s1, t0, t1 } = best as NonNullable<typeof best>;
  const len = Math.sqrt(l2);
  const along = roundHalfAway((s1 - s0) / len);
  const across = roundHalfAway((t1 - t0) / len);
  // p = o + (s·u + t·n)/l2, u = (dx,dy), n = (-dy,dx)
  const at = (s: number, t: number): Point => [
    o[0] + roundRatioHalfAway(BigInt(s) * BigInt(dx) - BigInt(t) * BigInt(dy), BigInt(l2)),
    o[1] + roundRatioHalfAway(BigInt(s) * BigInt(dy) + BigInt(t) * BigInt(dx), BigInt(l2)),
  ];
  const corners: [Point, Point, Point, Point] = [at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)];
  const alongIsX = Math.abs(dx) >= Math.abs(dy);
  return { widthMm: alongIsX ? along : across, depthMm: alongIsX ? across : along, corners };
}
