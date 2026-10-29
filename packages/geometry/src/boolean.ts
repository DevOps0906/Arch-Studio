// 다각형 합집합(계약 ③): 입력 검사·정규화 → 정수 배치 → Polygon[](빈 배열 허용).
import type { Point, Polygon } from "@arch-studio/domain";
import { fillPositive, type Seg } from "./arrangement.ts";
import { GeometryError } from "./errors.ts";
import { COORD_LIMIT, normalizePolygon } from "./validate.ts";

export function pushRing(segs: Seg[], ring: readonly Point[]): void {
  for (let i = 0; i < ring.length; i++) {
    segs.push({ a: ring[i] as Point, b: ring[(i + 1) % ring.length] as Point, w: 1 });
  }
}

/** 결과 좌표도 ±10km 안이어야 한다(오프셋이 넘길 수 있다). */
export function assertResultRange(polygons: Polygon[]): Polygon[] {
  for (const p of polygons) {
    for (const ring of [p.outer, ...(p.holes ?? [])]) {
      for (const [x, y] of ring) {
        if (Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) {
          throw new GeometryError("OUT_OF_RANGE", `결과 좌표가 ±${COORD_LIMIT}mm 를 넘습니다 (${x}, ${y})`);
        }
      }
    }
  }
  return polygons;
}

/** 합집합. 결과는 외곽 반시계·구멍 시계, 일직선 꼭짓점 없음, 사전순 최소 꼭짓점에서 시작, 정렬됨. */
export function union(polygons: readonly Polygon[]): Polygon[] {
  if (!Array.isArray(polygons)) throw new GeometryError("INVALID_ARGUMENT", "다각형 배열이 아닙니다");
  const segs: Seg[] = [];
  for (const polygon of polygons) {
    const p = normalizePolygon(polygon);
    pushRing(segs, p.outer);
    for (const h of p.holes ?? []) pushRing(segs, h);
  }
  return assertResultRange(fillPositive(segs));
}
