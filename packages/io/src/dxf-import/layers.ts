// 레이어 이름 → 대지 경계 가능성 힌트. 순위 매기기와 단위 판별 기준 도형 선택에 쓴다.
// 작성기(021) 표준 레이어 A-SITE-BNDY가 "site", 그 밖의 A-* 표준 레이어(건물·치수·표제란·도로·건축선)는 "non_site"다.
import type { LayerHint } from "./types.ts";

const NON_SITE_TOKENS = new Set([
  "TTLB", "TITLE", "FRAME", "BORDER", "SHEET", "VIEWPORT", "DEFPOINTS", "TEXT", "ANNO", "DIM", "DIMS", "HATCH", "GRID",
  "ROAD", "SETB", "SETBACK", "ENVL", "MASS", "WALL", "DOOR", "GLAZ", "WINDOW", "PARK", "AREA", "IDEN", "NRTH", "REFR",
]);
const SITE_TOKENS = new Set(["SITE", "BNDY", "BOUNDARY", "BOUND", "LOT", "PARCEL", "PROPERTY", "PROP", "LAND"]);
const NON_SITE_KO = ["표제", "도곽", "치수", "도로", "건축선", "이격", "건물", "매스"];
const SITE_KO = ["대지", "지적", "경계", "부지", "토지", "필지"];

export function layerHint(name: string): LayerHint {
  const tokens = name.toUpperCase().split(/[^A-Z0-9]+/);
  if (tokens.some((t) => NON_SITE_TOKENS.has(t)) || NON_SITE_KO.some((k) => name.includes(k))) return "non_site";
  if (tokens.some((t) => SITE_TOKENS.has(t)) || SITE_KO.some((k) => name.includes(k))) return "site";
  return "neutral";
}

/** 정렬용 숫자(작을수록 먼저). */
export function hintClass(h: LayerHint): number {
  return h === "site" ? 0 : h === "neutral" ? 1 : 2;
}
