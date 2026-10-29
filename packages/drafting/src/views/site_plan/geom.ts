// site_plan 보조 기하: 변 방향·안쪽 법선, 점-고리 포함, 가장 가까운 변. 정수 mm, sqrt·사칙연산만.
import type { Point } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import type { Mm, Vec } from "../../sheet/types.ts";

/** 고리의 부호 있는 2배 면적(양수 = 반시계). */
export function signedArea2(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i] as Point;
    const [x1, y1] = ring[(i + 1) % ring.length] as Point;
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

export interface EdgeFrame {
  a: Vec<Mm>;
  b: Vec<Mm>;
  len: number;
  /** 변 진행 방향 단위벡터. */
  t: [number, number];
  /** 대지 안쪽 단위 법선. */
  inward: [number, number];
}

/** 원본 고리(입력 순서 그대로) i번째 변의 좌표계. 길이 0이면 null. */
export function edgeFrame(ring: readonly Point[], i: number): EdgeFrame | null {
  const a = ring[i] as Point | undefined;
  const b = ring[(i + 1) % ring.length] as Point | undefined;
  if (a === undefined || b === undefined) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  const t: [number, number] = [dx / len, dy / len];
  // 반시계면 안쪽 = 진행 방향의 왼쪽(-ty, tx), 시계면 오른쪽.
  const ccw = signedArea2(ring) > 0;
  const inward: [number, number] = ccw ? [-t[1], t[0]] : [t[1], -t[0]];
  return { a: [a[0], a[1]], b: [b[0], b[1]], len, t, inward };
}

export function at(f: EdgeFrame, s: number, d: number): Vec<Mm> {
  return [roundHalfAway(f.a[0] + f.t[0] * s + f.inward[0] * d), roundHalfAway(f.a[1] + f.t[1] * s + f.inward[1] * d)];
}

function onSeg(a: Vec<Mm>, b: Vec<Mm>, p: Vec<Mm>): boolean {
  const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return (
    cr === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])
  );
}

/** 점이 고리 안이거나 경계 위면 true(정수 교차수 판정). */
export function inRingInclusive(p: Vec<Mm>, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    if (onSeg(a, b, p)) return true;
    if (a[1] > p[1] !== b[1] > p[1]) {
      // p에서 +x 방향 반직선이 변과 만나는지: 부등식을 곱셈으로(정확).
      const lhs = (p[0] - a[0]) * (b[1] - a[1]);
      const rhs = (b[0] - a[0]) * (p[1] - a[1]);
      if (b[1] > a[1] ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside;
}

/** 점이 고리 안(경계 제외)에 엄격히 있으면 true. */
export function strictlyInRing(p: Vec<Mm>, ring: readonly Point[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    if (onSeg(ring[i] as Point, ring[(i + 1) % ring.length] as Point, p)) return false;
  }
  return inRingInclusive(p, ring);
}

/** 점에서 가장 가까운 변의 번호(동률은 작은 번호). 부동소수 거리지만 비교용 선택에만 쓴다. */
export function nearestEdge(ring: readonly Point[], p: Vec<Mm>): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let u = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    u = Math.max(0, Math.min(1, u));
    const ex = a[0] + u * dx - p[0];
    const ey = a[1] + u * dy - p[1];
    const d = ex * ex + ey * ey;
    if (d < bestD - 1e-9) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
