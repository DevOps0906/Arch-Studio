// 최단거리(계약 ②): 정확한 제곱 거리(유리수, bigint)로 고르고 비교한다. 표시값만 반올림한다.
// 판정은 compareDistance(제곱 거리 정확 비교)를 쓴다 — 반올림한 d_mm로 비교하지 않는다.
import type { Point, Polygon } from "@arch-studio/domain";
import { GeometryError } from "./errors.ts";
import { onSegment, orient, pointInRing2, properCross, type Pt } from "./predicates.ts";
import { isqrt, roundRatioHalfAway } from "./round.ts";
import { normalizePolygon } from "./validate.ts";

export interface DistanceResult {
  /** 제곱 거리(mm²). 가장 가까운 두 점이 모두 격자점이면 정확한 정수, 아니면 정확값을 half-away 반올림. */
  d2_mm2: number;
  /** 표시용 거리(mm), 정확한 거리를 half-away 반올림. */
  d_mm: number;
  /** [a 위의 점, b 위의 점], 각 좌표 half-away 반올림. 겹치면 같은 점. */
  pair: [Point, Point];
  /** 정확한 제곱 거리 num/den(den > 0). compareDistance가 쓴다. */
  d2_exact: { num: bigint; den: bigint };
}

interface Candidate {
  num: bigint;
  den: bigint;
  pa: Point;
  pb: Point;
}

function edges(p: Polygon): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (const ring of [p.outer, ...(p.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) out.push([ring[i] as Pt, ring[(i + 1) % ring.length] as Pt]);
  }
  return out;
}

function insidePolygon(pt: Pt, p: Polygon): boolean {
  const p2: Pt = [pt[0] * 2, pt[1] * 2];
  if (pointInRing2(p2, p.outer) !== 1) return false;
  return (p.holes ?? []).every((h) => pointInRing2(p2, h) === -1);
}

/** 두 다각형의 경계가 만나는 점(반올림) 또는 null. */
function touchPoint(ea: [Pt, Pt][], eb: [Pt, Pt][]): Point | null {
  for (const [a, b] of ea) {
    for (const [c, d] of eb) {
      if (onSegment(c, d, a)) return [a[0], a[1]];
      if (onSegment(c, d, b)) return [b[0], b[1]];
      if (onSegment(a, b, c)) return [c[0], c[1]];
      if (onSegment(a, b, d)) return [d[0], d[1]];
      if (properCross(a, b, c, d)) {
        const rx = b[0] - a[0];
        const ry = b[1] - a[1];
        const qx = d[0] - c[0];
        const qy = d[1] - c[1];
        const den = BigInt(rx * qy - ry * qx);
        const num = BigInt((c[0] - a[0]) * qy - (c[1] - a[1]) * qx);
        return [
          roundRatioHalfAway(BigInt(a[0]) * den + BigInt(rx) * num, den),
          roundRatioHalfAway(BigInt(a[1]) * den + BigInt(ry) * num, den),
        ];
      }
    }
  }
  return null;
}

/** 점 p와 선분 a-b의 정확한 제곱 거리와 가장 가까운 점(반올림). approx는 빠른 거르기용 근사. */
function pointSegment(p: Pt, a: Pt, b: Pt): { approx: number; exact: () => Candidate; foot: () => Point } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = (p[0] - a[0]) * dx + (p[1] - a[1]) * dy; // 정확(정수)
  const len2 = dx * dx + dy * dy;
  const endpoint = (q: Pt) => {
    const ex = p[0] - q[0];
    const ey = p[1] - q[1];
    const d2 = ex * ex + ey * ey; // ≤ 2·(2×10^7)^2 < 2^53, 정확
    return {
      approx: d2,
      exact: (): Candidate => ({ num: BigInt(d2), den: 1n, pa: [0, 0], pb: [0, 0] }),
      foot: (): Point => [q[0], q[1]],
    };
  };
  if (t <= 0) return endpoint(a);
  if (t >= len2) return endpoint(b);
  const cr = orient(a, b, p); // 정확(정수)
  return {
    approx: (cr * cr) / len2,
    exact: (): Candidate => ({ num: BigInt(cr) * BigInt(cr), den: BigInt(len2), pa: [0, 0], pb: [0, 0] }),
    foot: (): Point => {
      const L = BigInt(len2);
      const T = BigInt(t);
      return [
        roundRatioHalfAway(BigInt(a[0]) * L + T * BigInt(dx), L),
        roundRatioHalfAway(BigInt(a[1]) * L + T * BigInt(dy), L),
      ];
    },
  };
}

const REL = 1e-9; // 근사 비교 여유(이 안이면 bigint로 정확히 비교)

/**
 * 두 다각형 사이 최단거리. 겹치거나 닿으면 0(구멍 안에 있는 다각형은 겹침이 아니다).
 * 입력은 normalizePolygon으로 검사한다. 동률이면 a의 변 순서·b의 변 순서상 먼저 나온 쌍을 고른다.
 */
export function distance(a: Polygon, b: Polygon): DistanceResult {
  const pa = normalizePolygon(a);
  const pb = normalizePolygon(b);
  const ea = edges(pa);
  const eb = edges(pb);
  const touch = touchPoint(ea, eb);
  const zero = (pt: Point): DistanceResult => ({
    d2_mm2: 0,
    d_mm: 0,
    pair: [pt, [pt[0], pt[1]]],
    d2_exact: { num: 0n, den: 1n },
  });
  if (touch) return zero(touch);
  const a0 = pa.outer[0] as Point;
  const b0 = pb.outer[0] as Point;
  if (insidePolygon(b0, pa)) return zero([b0[0], b0[1]]);
  if (insidePolygon(a0, pb)) return zero([a0[0], a0[1]]);

  let best: Candidate | null = null;
  let bestApprox = Number.POSITIVE_INFINITY;
  const consider = (r: ReturnType<typeof pointSegment>, fromA: boolean, vertex: Pt): void => {
    if (best && r.approx > bestApprox * (1 + REL)) return;
    const c = r.exact();
    if (best && !(r.approx < bestApprox * (1 - REL))) {
      if (c.num * best.den >= best.num * c.den) return; // 정확 비교: 같거나 크면 먼저 것 유지
    }
    const foot = r.foot();
    const v: Point = [vertex[0], vertex[1]];
    best = { num: c.num, den: c.den, pa: fromA ? v : foot, pb: fromA ? foot : v };
    bestApprox = r.approx;
  };
  for (const [s, e] of ea) {
    for (const [c, d] of eb) {
      consider(pointSegment(s, c, d), true, s);
      consider(pointSegment(e, c, d), true, e);
      consider(pointSegment(c, s, e), false, c);
      consider(pointSegment(d, s, e), false, d);
    }
  }
  const found = best as Candidate | null;
  if (!found) throw new GeometryError("NUMERIC_FAILURE", "최단거리 후보가 없습니다");
  return {
    d2_mm2: roundRatioHalfAway(found.num, found.den),
    d_mm: sqrtHalfAway(found.num, found.den),
    pair: [found.pa, found.pb],
    d2_exact: { num: found.num, den: found.den },
  };
}

/** sqrt(num/den)을 half-away 반올림(정확): r = floor(sqrt), 4·num ≥ (2r+1)²·den 이면 r+1. */
function sqrtHalfAway(num: bigint, den: bigint): number {
  const r = isqrt(num / den);
  const up = 4n * num >= (2n * r + 1n) * (2n * r + 1n) * den;
  return Number(up ? r + 1n : r);
}

/**
 * 거리 판정 비교: 정확한 거리와 limit_mm(정수)를 비교해 -1(가깝다) / 0(같다) / 1(멀다).
 * 제곱 거리 num/den 과 limit² 를 bigint로 비교한다.
 */
export function compareDistance(result: Pick<DistanceResult, "d2_exact">, limit_mm: number): -1 | 0 | 1 {
  if (!Number.isSafeInteger(limit_mm) || limit_mm < 0) {
    throw new GeometryError("INVALID_ARGUMENT", `기준 거리는 0 이상의 mm 정수여야 합니다 (${limit_mm})`);
  }
  const { num, den } = result.d2_exact;
  const L = BigInt(limit_mm);
  const lhs = num;
  const rhs = L * L * den;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}
