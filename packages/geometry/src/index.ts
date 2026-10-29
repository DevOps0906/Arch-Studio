// @arch-studio/geometry — 2D 다각형(합집합·오프셋·면적·최단거리). mm 정수 좌표, 결정적 순수 함수.
// 반올림은 round.ts 한 곳(half-away-from-zero). 초월함수(sin·cos·tan·pow 등) 금지 — sqrt·사칙연산만(geometry.test.ts가 검사).
export { roundHalfAway, roundRatioHalfAway } from "./round.ts";
export { GeometryError, type GeometryErrorCode } from "./errors.ts";
export { COORD_LIMIT, normalizePolygon, validatePolygon } from "./validate.ts";
export { area, area2 } from "./area.ts";
export { union } from "./boolean.ts";
export { offset, type OffsetJoin, type OffsetOptions } from "./offset.ts";
export { compareDistance, distance, type DistanceResult } from "./distance.ts";
