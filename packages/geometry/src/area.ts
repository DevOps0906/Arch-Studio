// 면적: 정수 좌표 신발끈 공식(bigint 누적, 정확). rules·drafting이 같은 함수를 쓴다(02_ARCHITECTURE.md 2장).
import type { Polygon } from "@arch-studio/domain";
import { ringArea2 } from "./predicates.ts";
import { roundRatioHalfAway } from "./round.ts";
import { assertRingCoords, normalizePolygon } from "./validate.ts";

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/**
 * 검사 없는 2배 면적(좌표·점 개수만 확인, O(n)). 이미 검사한 다각형(엔진 내부 결과)용 — index에서 내보내지 않는다.
 */
export function area2Unchecked(polygon: Polygon): number {
  assertRingCoords(polygon.outer, "외곽");
  let s = abs(ringArea2(polygon.outer));
  (polygon.holes ?? []).forEach((h, i) => {
    assertRingCoords(h, `구멍 ${i}`);
    s -= abs(ringArea2(h));
  });
  return Number(s); // ≤ 2 × (2×10^7)^2 < 2^53
}

/**
 * 다각형 면적의 2배(mm², 정확한 정수) = |외곽| − Σ|구멍|. 방향과 무관하다.
 * 입력은 normalizePolygon으로 검사한다(자기교차·퇴화·범위 밖은 GeometryError).
 */
export function area2(polygon: Polygon): number {
  return area2Unchecked(normalizePolygon(polygon));
}

/** 다각형 면적(mm² 정수): 2배 면적의 절반을 half-away 반올림. 검사는 area2와 같다. */
export function area(polygon: Polygon): number {
  return roundRatioHalfAway(BigInt(area2(polygon)), 2n);
}
