// EPSG:5186(Korea 2000 / Central Belt 2010, GRS80 횡메르카토르, m) → WGS84 경위도(도). **표시 전용**: 새 프로젝트 창 지도에 대지를 칠할 때만 쓴다.
// 모델 저장·mm 변환(domain mToMm, site/model.ts candidateFromLookup, new-project.ts) 경로에서 import하지 않는다(projects.test.ts가 검사).
// 식: Snyder, "Map Projections — A Working Manual"(USGS PP 1395) 8장 횡메르카토르 역변환(EPSG 지침 7-2의 USGS 식과 같다).
// Korea 2000 측지계는 GRS80·ITRF 기반이라 WGS84와 화면 표시 수준(수 cm)에서 같다고 보고 측지계 변환은 하지 않는다. 의존성 없음.

export interface TmParams {
  /** 장반경(m). */
  readonly a: number;
  /** 편평률 역수. */
  readonly invF: number;
  /** 원점 위도·중앙 경선(도). */
  readonly lat0: number;
  readonly lon0: number;
  readonly k0: number;
  readonly falseE: number;
  readonly falseN: number;
}

/** EPSG:5186 매개변수(EPSG 등록값). */
export const EPSG_5186: TmParams = Object.freeze({ a: 6378137, invF: 298.257222101, lat0: 38, lon0: 127, k0: 1, falseE: 200000, falseN: 600000 });

const RAD = Math.PI / 180;

/** 자오선 호 길이 M(φ). */
function meridianArc(a: number, e2: number, phi: number): number {
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

/** 횡메르카토르 역변환: 투영 좌표(m) [E, N] → [경도, 위도](도). */
export function tmInverse(p: TmParams, east: number, north: number): [number, number] {
  const f = 1 / p.invF;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const m = meridianArc(p.a, e2, p.lat0 * RAD) + (north - p.falseN) / p.k0;
  const mu = m / (p.a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const s = Math.sqrt(1 - e2);
  const e1 = (1 - s) / (1 + s);
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const c1 = ep2 * cos1 * cos1;
  const t1 = tan1 * tan1;
  const w = 1 - e2 * sin1 * sin1;
  const n1 = p.a / Math.sqrt(w);
  const r1 = (p.a * (1 - e2)) / (w * Math.sqrt(w));
  const d = (east - p.falseE) / (n1 * p.k0);
  const lat = phi1 - ((n1 * tan1) / r1) * ((d * d) / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = p.lon0 * RAD + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / cos1;
  return [lon / RAD, lat / RAD];
}

/** EPSG:5186 [x, y](m) → [경도, 위도](도). 지도 표시에만 쓴다. */
export function epsg5186ToLngLat([x, y]: readonly [number, number]): [number, number] {
  return tmInverse(EPSG_5186, x, y);
}
