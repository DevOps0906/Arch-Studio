// 새 프로젝트 창 지도 스타일(순수 함수, 표시 전용): 선택 대지 반투명 채움 + 굵은 경계, 배경은 서버 타일(Bearer) 또는 로컬 모눈.
// 모눈 모드는 외부 요청 0(글리프·스프라이트·타일 URL 없음 — 데모·타일 없음 확인용). 색은 호출자가 토큰(CSS 변수)에서 읽어 넘긴다.
import type { StyleSpecification } from "maplibre-gl";
import { epsg5186ToLngLat } from "./geo5186.ts";

export type TileLayer = "base" | "gray";

/** 지도 배경: 로컬 모눈(데모) 또는 서버 타일. 타일 URL·토큰은 앱이 넘긴다(외부 URL·키를 여기서 만들지 않는다). */
export type SiteMapSource =
  | { readonly kind: "grid" }
  | {
      readonly kind: "tiles";
      /** 예: `${baseUrl}/api/site/tiles/base/{z}/{x}/{y}`. */
      readonly tileUrl: (layer: TileLayer) => string;
      readonly token: () => Promise<string | null>;
    };

export interface SiteMapColors {
  readonly background: string;
  readonly grid: string;
  readonly fill: string;
  readonly line: string;
}

/** 모눈 간격(m). */
export const GRID_STEP_M = 10;
export const SITE_FILL_OPACITY = 0.35;
export const SITE_LINE_WIDTH = 3;
export const TILE_MAX_ZOOM = 19;

type Ring = readonly (readonly [number, number])[];

/** 경위도 경계(닫힌 고리) + 외접 사각형 [[서, 남], [동, 북]]. */
export function siteGeometry(ringM: Ring): { ring: [number, number][]; bounds: [[number, number], [number, number]] } {
  const ring = ringM.map((p) => epsg5186ToLngLat(p));
  const first = ring[0];
  if (first) ring.push([first[0], first[1]]);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { ring, bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] };
}

/** 대지 주변 모눈(투영 좌표에서 GRID_STEP_M 간격 직선 → 경위도). 대지 크기만큼 여유를 둔다. */
export function gridLines(ringM: Ring): [number, number][][] {
  const xs = ringM.map((p) => p[0]);
  const ys = ringM.map((p) => p[1]);
  const pad = Math.max(40, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const x0 = Math.floor((Math.min(...xs) - pad) / GRID_STEP_M) * GRID_STEP_M;
  const x1 = Math.ceil((Math.max(...xs) + pad) / GRID_STEP_M) * GRID_STEP_M;
  const y0 = Math.floor((Math.min(...ys) - pad) / GRID_STEP_M) * GRID_STEP_M;
  const y1 = Math.ceil((Math.max(...ys) + pad) / GRID_STEP_M) * GRID_STEP_M;
  const lines: [number, number][][] = [];
  for (let x = x0; x <= x1; x += GRID_STEP_M) lines.push([epsg5186ToLngLat([x, y0]), epsg5186ToLngLat([x, y1])]);
  for (let y = y0; y <= y1; y += GRID_STEP_M) lines.push([epsg5186ToLngLat([x0, y]), epsg5186ToLngLat([x1, y])]);
  return lines;
}

export function buildSiteMapStyle(ringM: Ring, source: SiteMapSource, layer: TileLayer, colors: SiteMapColors): StyleSpecification {
  const { ring } = siteGeometry(ringM);
  const site: StyleSpecification["sources"][string] = { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } } };
  const background: StyleSpecification["layers"] = [{ id: "background", type: "background", paint: { "background-color": colors.background } }];
  const siteLayers: StyleSpecification["layers"] = [
    { id: "site-fill", type: "fill", source: "site", paint: { "fill-color": colors.fill, "fill-opacity": SITE_FILL_OPACITY } },
    { id: "site-line", type: "line", source: "site", paint: { "line-color": colors.line, "line-width": SITE_LINE_WIDTH }, layout: { "line-join": "round" } },
  ];
  if (source.kind === "grid") {
    const grid: StyleSpecification["sources"][string] = { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: gridLines(ringM) } } };
    return {
      version: 8,
      sources: { grid, site },
      layers: [...background, { id: "grid", type: "line", source: "grid", paint: { "line-color": colors.grid, "line-width": 1 } }, ...siteLayers],
    };
  }
  return {
    version: 8,
    sources: { tiles: { type: "raster", tiles: [source.tileUrl(layer)], tileSize: 256, maxzoom: TILE_MAX_ZOOM }, site },
    layers: [...background, { id: "tiles", type: "raster", source: "tiles" }, ...siteLayers],
  };
}
