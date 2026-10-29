// 입력 다각형 검사·정규화(계약 ①): mm 정수, |x|,|y| ≤ 10km, 고리 3점 이상, 면적 0·자기교차 거부.
// 정규화는 방향만 바꾼다(외곽 반시계·구멍 시계). 꼭짓점을 빼거나 옮기지 않는다.
import { MM_COORD_LIMIT, type Point, type Polygon } from "@arch-studio/domain";
import { GeometryError } from "./errors.ts";
import {
  collinearOverlap,
  orient,
  pointInRing2,
  properCross,
  ptKey,
  ringArea2,
  samePt,
  segmentsTouch,
  type Pt,
} from "./predicates.ts";

export const COORD_LIMIT = MM_COORD_LIMIT;

/** 점 개수(3 이상)와 좌표(mm 정수, ±10km)만 검사한다 — 자기교차 검사가 필요 없는 면적 계산용. */
export function assertRingCoords(ring: readonly Pt[], label: string): void {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new GeometryError("TOO_FEW_POINTS", `${label}: 꼭짓점이 3개 미만입니다`);
  }
  checkCoords(ring, label);
}

function checkCoords(ring: readonly Pt[], label: string): void {
  for (const p of ring) {
    for (const v of p) {
      if (!Number.isSafeInteger(v)) throw new GeometryError("INVALID_COORDINATE", `${label}: mm 정수가 아닙니다 (${v})`);
      if (v > COORD_LIMIT || v < -COORD_LIMIT) {
        throw new GeometryError("OUT_OF_RANGE", `${label}: |좌표| ≤ ${COORD_LIMIT}mm 를 넘습니다 (${v})`);
      }
    }
  }
}

function bboxApart(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  );
}

/** 고리 하나: 점 개수·좌표·이웃 중복·면적 0·자기교차(접촉 포함). 부호 면적(2배)을 돌려준다. */
function checkRing(ring: readonly Pt[], label: string): bigint {
  assertRingCoords(ring, label);
  const n = ring.length;
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const p = ring[i] as Pt;
    if (samePt(p, ring[(i + 1) % n] as Pt)) {
      throw new GeometryError("DUPLICATE_POINT", `${label}: ${i}번 변의 길이가 0입니다(닫는 점 중복 포함)`);
    }
    const k = ptKey(p);
    if (seen.has(k)) throw new GeometryError("SELF_INTERSECTION", `${label}: 꼭짓점 (${k})가 반복됩니다`);
    seen.add(k);
  }
  const a2 = ringArea2(ring);
  if (a2 === 0n) throw new GeometryError("ZERO_AREA", `${label}: 면적이 0입니다`);
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    // 이웃 변: 공유점에서 같은 방향으로 되돌아가면(스파이크) 겹침
    const c = ring[(i + 2) % n] as Pt;
    if (orient(a, b, c) === 0 && (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0) {
      throw new GeometryError("SELF_INTERSECTION", `${label}: ${i + 1}번 꼭짓점에서 변이 되돌아갑니다`);
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 이웃(마지막 변과 첫 변)
      const c1 = ring[j] as Pt;
      const d1 = ring[(j + 1) % n] as Pt;
      if (bboxApart(a, b, c1, d1)) continue;
      if (segmentsTouch(a, b, c1, d1)) {
        throw new GeometryError("SELF_INTERSECTION", `${label}: ${i}번 변과 ${j}번 변이 만납니다`);
      }
    }
  }
  return a2;
}

/** 고리 r의 변 중점(2배 좌표) 가운데 고리 other의 경계 위가 아닌 것 하나. */
function probe(r: readonly Pt[], other: readonly Pt[]): -1 | 0 | 1 {
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as Pt;
    const b = r[(i + 1) % r.length] as Pt;
    const side = pointInRing2([a[0] + b[0], a[1] + b[1]], other);
    if (side !== 0) return side;
  }
  return 0;
}

/** 고리 사이: 내부 교차·일직선 겹침 금지(한 점 접촉은 허용 — 합집합 결과에서 생긴다). */
function checkRingPair(r1: readonly Pt[], r2: readonly Pt[], label: string): void {
  for (let i = 0; i < r1.length; i++) {
    const a = r1[i] as Pt;
    const b = r1[(i + 1) % r1.length] as Pt;
    for (let j = 0; j < r2.length; j++) {
      const c = r2[j] as Pt;
      const d = r2[(j + 1) % r2.length] as Pt;
      if (bboxApart(a, b, c, d)) continue;
      if (properCross(a, b, c, d) || collinearOverlap(a, b, c, d)) {
        throw new GeometryError("SELF_INTERSECTION", `${label}: 고리끼리 교차하거나 겹칩니다`);
      }
    }
  }
}

function orientRing(ring: readonly Pt[], area2: bigint, wantCcw: boolean): Point[] {
  const out: Point[] = ring.map((p) => [p[0] + 0, p[1] + 0]);
  if (area2 > 0n !== wantCcw) {
    // [p0, p(n-1), …, p1]: 시작점은 유지
    out.push(...(out.splice(1).reverse() as Point[]));
  }
  return out;
}

/**
 * 다각형을 검사하고 방향을 정규화한 새 객체를 돌려준다(외곽 반시계, 구멍 시계, holes 항상 배열).
 * 방향을 뒤집으면 꼭짓점 순서는 [p0, p(n-1), …, p1]이 된다(변 번호가 바뀌므로 호출 쪽 주의).
 * 거부 사유는 GeometryError.code.
 */
export function normalizePolygon(polygon: Polygon): Polygon {
  if (polygon === null || typeof polygon !== "object" || !Array.isArray(polygon.outer)) {
    throw new GeometryError("INVALID_ARGUMENT", "다각형이 아닙니다");
  }
  const outerA2 = checkRing(polygon.outer, "외곽");
  const holes = polygon.holes ?? [];
  if (!Array.isArray(holes)) throw new GeometryError("INVALID_ARGUMENT", "holes는 배열이어야 합니다");
  const holeA2 = holes.map((h, i) => checkRing(h, `구멍 ${i}`));
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i] as Pt[];
    checkRingPair(polygon.outer, h, `외곽-구멍 ${i}`);
    if (probe(h, polygon.outer) !== 1) throw new GeometryError("HOLE_OUTSIDE", `구멍 ${i}가 외곽 안에 있지 않습니다`);
    for (let j = 0; j < i; j++) {
      const g = holes[j] as Pt[];
      checkRingPair(g, h, `구멍 ${j}-구멍 ${i}`);
      if (probe(h, g) === 1 || probe(g, h) === 1) {
        throw new GeometryError("HOLE_OUTSIDE", `구멍 ${i}와 구멍 ${j}가 포개집니다`);
      }
    }
  }
  return {
    outer: orientRing(polygon.outer, outerA2, true),
    holes: holes.map((h, i) => orientRing(h, holeA2[i] as bigint, false)),
  };
}

/** 검사만 한다: 통과하면 null, 아니면 오류 코드. */
export function validatePolygon(polygon: Polygon): GeometryError["code"] | null {
  try {
    normalizePolygon(polygon);
    return null;
  } catch (e) {
    if (e instanceof GeometryError) return e.code;
    throw e;
  }
}
