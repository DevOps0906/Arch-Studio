// 도면 중립 모델: 단위 mm, 정수 좌표. DXF·SVG·PDF 작성기가 같은 모델을 읽는다.
export type Pt = [number, number];

export type Ent =
  | { t: 'LINE'; layer: string; a: Pt; b: Pt }
  | { t: 'LWPOLYLINE'; layer: string; pts: Pt[]; closed: boolean }
  | { t: 'ARC'; layer: string; c: Pt; r: number; a0: number; a1: number }
  | { t: 'CIRCLE'; layer: string; c: Pt; r: number }
  | { t: 'TEXT'; layer: string; p: Pt; h: number; s: string; anchor?: 'l' | 'c' }
  | { t: 'MTEXT'; layer: string; p: Pt; h: number; w: number; lines: string[] }
  | { t: 'HATCH'; layer: string; pts: Pt[]; color: number }
  | { t: 'INSERT'; layer: string; block: string; p: Pt };

export interface BlockDef { name: string; ents: Ent[] }
export interface Sheet { name: string; ox: number; ents: Ent[] }
export interface Layer { name: string; aci: number; lt: 'CONTINUOUS' | 'DASHED' | 'DASHDOT' }

// PRD 9.6 레이어 표준(D-24)
export const LAYERS: Layer[] = [
  { name: 'A-SITE-BNDY', aci: 1, lt: 'DASHDOT' },
  { name: 'A-SITE-ROAD', aci: 8, lt: 'CONTINUOUS' },
  { name: 'A-SITE-SETB', aci: 3, lt: 'DASHED' },
  { name: 'A-ENVL', aci: 4, lt: 'DASHED' },
  { name: 'A-MASS', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-WALL', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-DOOR', aci: 2, lt: 'CONTINUOUS' },
  { name: 'A-GLAZ', aci: 5, lt: 'CONTINUOUS' },
  { name: 'A-AREA', aci: 6, lt: 'CONTINUOUS' },
  { name: 'A-AREA-IDEN', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-PARK', aci: 3, lt: 'CONTINUOUS' },
  { name: 'A-ANNO-DIMS', aci: 1, lt: 'CONTINUOUS' },
  { name: 'A-ANNO-TEXT', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-ANNO-NRTH', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-TTLB', aci: 7, lt: 'CONTINUOUS' },
  { name: 'A-REFR', aci: 9, lt: 'CONTINUOUS' },
];

export const BLOCKS: BlockDef[] = [
  {
    name: 'DOOR-900',
    ents: [
      { t: 'LINE', layer: 'A-DOOR', a: [0, 0], b: [0, 900] },
      { t: 'ARC', layer: 'A-DOOR', c: [0, 0], r: 900, a0: 0, a1: 90 },
    ],
  },
  {
    name: 'WIN-1200',
    ents: [
      { t: 'LWPOLYLINE', layer: 'A-GLAZ', pts: [[0, -100], [1200, -100], [1200, 100], [0, 100]], closed: true },
      { t: 'LINE', layer: 'A-GLAZ', a: [0, 0], b: [1200, 0] },
    ],
  },
];

// ---- 면적 (정수 mm 좌표 → 신발끈 공식, 2A는 정수) ----
export function twiceArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s);
}
// 2A(mm²*2) → 0.01㎡ 단위 정수(반올림 half-up)
export function area100(twoA: number): number {
  return Math.floor((twoA + 10000) / 20000);
}
export function fmt100(v: number): string {
  return `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;
}
export function fmtArea(pts: Pt[]): string {
  return fmt100(area100(twiceArea(pts)));
}
// 건폐율 % (소수 2자리)
export function fmtRatio(bld: Pt[], site: Pt[]): string {
  return fmt100(Math.round((twiceArea(bld) * 10000) / twiceArea(site)));
}

export interface Sample {
  id: string;
  title: string;
  address: string;
  site: Pt[];
  setback: Pt[];
  building: Pt[];
  roadY: number; // 남측 도로 경계선 y
  roadWidthMm: number;
}

export const SAMPLES: Sample[] = [
  {
    id: 'site1', title: '합정동 근린생활시설 신축', address: '서울특별시 마포구 합정동 123-4',
    site: [[0, 0], [20000, 0], [20000, 25000], [0, 25000]],
    setback: [[1500, 1500], [18500, 1500], [18500, 23500], [1500, 23500]],
    building: [[3000, 3000], [15000, 3000], [15000, 17500], [3000, 17500]],
    roadY: -6000, roadWidthMm: 6000,
  },
  {
    id: 'site2', title: '연남동 다가구주택 신축', address: '서울특별시 마포구 연남동 456-7',
    site: [[0, 0], [24000, 0], [21000, 28000], [2000, 26000]],
    setback: [[2500, 2500], [20500, 2500], [19500, 24500], [3500, 24000]],
    building: [[4000, 4000], [16000, 4000], [16000, 16000], [4000, 16000]],
    roadY: -8000, roadWidthMm: 8000,
  },
  {
    id: 'site3', title: '성수동 사옥 신축', address: '서울특별시 성동구 성수동2가 789-1',
    site: [[0, 0], [30000, 0], [30000, 18000], [22000, 26000], [0, 26000]],
    setback: [[1500, 1500], [28500, 1500], [28500, 17400], [21400, 24500], [1500, 24500]],
    building: [[3000, 3000], [24000, 3000], [24000, 10000], [12000, 10000], [12000, 20000], [3000, 20000]],
    roadY: -10000, roadWidthMm: 10000,
  },
];

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---- 시트 구성: 모델 1:1, 용지 요소는 축척 분모를 곱해 모델 공간에 놓는다 ----
export const SCALE = 200;
export const A3: Pt = [420 * SCALE, 297 * SCALE];
export const SHEET_PITCH = A3[0] + 20000;
const TXT = 3 * SCALE; // 용지 3mm 글자
const TXT_S = 2.5 * SCALE;
const SHIFT_X = 16000; // 대지 원점을 도곽 안쪽으로 옮기는 양
const SHIFT_Y = 24000;

function frame(s: Sample, sheetName: string, siteArea: string, bldArea: string, ratio: string, ox: number): Ent[] {
  const e: Ent[] = [];
  const m = 10 * SCALE;
  const x0 = ox + m, y0 = m, x1 = ox + A3[0] - m, y1 = A3[1] - m;
  e.push({ t: 'LWPOLYLINE', layer: 'A-TTLB', pts: [[ox, 0], [ox + A3[0], 0], [ox + A3[0], A3[1]], [ox, A3[1]]], closed: true });
  e.push({ t: 'LWPOLYLINE', layer: 'A-TTLB', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
  const tw = 110 * SCALE, th = 40 * SCALE;
  const tx = x1 - tw, ty = y0;
  e.push({ t: 'LWPOLYLINE', layer: 'A-TTLB', pts: [[tx, ty], [x1, ty], [x1, ty + th], [tx, ty + th]], closed: true });
  for (let i = 1; i < 4; i++) e.push({ t: 'LINE', layer: 'A-TTLB', a: [tx, ty + (th / 4) * i], b: [x1, ty + (th / 4) * i] });
  const rowH = th / 4, pad = 2 * SCALE;
  const rows = [
    `도면명: ${sheetName}`,
    `사업명: ${s.title}`,
    `축척: 1/${SCALE}  단위: mm`,
    `대지면적 ${siteArea}㎡ / 건축면적 ${bldArea}㎡ / 건폐율 ${ratio}%`,
  ];
  rows.forEach((r, i) => e.push({ t: 'TEXT', layer: 'A-TTLB', p: [tx + pad, ty + th - rowH * (i + 1) + (rowH - TXT_S) / 2], h: TXT_S, s: r }));
  return e;
}

// 분해된 치수: 치수선 + 보조선 + 문자(DIMENSION 엔티티 미사용)
function dims(s: Sample, px: number, py: number): Ent[] {
  const xs = s.site.map((p) => p[0]), ys = s.site.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dy = py + minY - 1500;
  const dx = px + maxX + 1500;
  return [
    { t: 'LINE', layer: 'A-ANNO-DIMS', a: [px + minX, dy], b: [px + maxX, dy] },
    { t: 'LINE', layer: 'A-ANNO-DIMS', a: [px + minX, py + minY - 200], b: [px + minX, dy - 300] },
    { t: 'LINE', layer: 'A-ANNO-DIMS', a: [px + maxX, py + minY - 200], b: [px + maxX, dy - 300] },
    { t: 'TEXT', layer: 'A-ANNO-DIMS', p: [px + (minX + maxX) / 2, dy + 200], h: TXT_S, s: String(maxX - minX), anchor: 'c' },
    { t: 'LINE', layer: 'A-ANNO-DIMS', a: [dx, py + minY], b: [dx, py + maxY] },
    { t: 'TEXT', layer: 'A-ANNO-DIMS', p: [dx + 200, py + (minY + maxY) / 2], h: TXT_S, s: String(maxY - minY) },
  ];
}

function north(x: number, y: number): Ent[] {
  return [
    { t: 'CIRCLE', layer: 'A-ANNO-NRTH', c: [x, y], r: 1200 },
    { t: 'LINE', layer: 'A-ANNO-NRTH', a: [x, y - 1200], b: [x, y + 1200] },
    { t: 'LWPOLYLINE', layer: 'A-ANNO-NRTH', pts: [[x, y + 1200], [x - 350, y + 300], [x + 350, y + 300]], closed: true },
    { t: 'TEXT', layer: 'A-ANNO-NRTH', p: [x, y + 1500], h: TXT, s: 'N', anchor: 'c' },
  ];
}

export function buildSheets(s: Sample): { sheets: Sheet[]; siteArea: string; bldArea: string; ratio: string } {
  if (!s.building.every((p) => inside(p, s.site))) throw new Error(`${s.id}: 건물이 대지 밖`);
  const siteArea = fmtArea(s.site), bldArea = fmtArea(s.building), ratio = fmtRatio(s.building, s.site);
  const maxX = Math.max(...s.site.map((p) => p[0]));
  const maxY = Math.max(...s.site.map((p) => p[1]));

  const mk = (ox: number) => {
    const px = ox + SHIFT_X;
    const P = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x + px, y + SHIFT_Y]);
    return { px, site: P(s.site), sb: P(s.setback), bl: P(s.building) };
  };

  // --- 배치도 ---
  const a = mk(0);
  const e0: Ent[] = [];
  e0.push({ t: 'LWPOLYLINE', layer: 'A-SITE-BNDY', pts: a.site, closed: true });
  e0.push({ t: 'LINE', layer: 'A-SITE-ROAD', a: [a.px - 4000, SHIFT_Y + s.roadY], b: [a.px + maxX + 6000, SHIFT_Y + s.roadY] });
  e0.push({ t: 'LINE', layer: 'A-SITE-ROAD', a: [a.px - 4000, SHIFT_Y - 3000], b: [a.px + maxX + 6000, SHIFT_Y - 3000] });
  e0.push({ t: 'TEXT', layer: 'A-ANNO-TEXT', p: [a.px + 500, SHIFT_Y + s.roadY + 800], h: TXT, s: `도로 폭 ${s.roadWidthMm / 1000}m` });
  e0.push({ t: 'LWPOLYLINE', layer: 'A-SITE-SETB', pts: a.sb, closed: true });
  e0.push({ t: 'LWPOLYLINE', layer: 'A-MASS', pts: a.bl, closed: true });
  const [bx, by] = a.bl[0]; // 건물 첫 변 = 남측 외벽
  e0.push({ t: 'INSERT', layer: 'A-DOOR', block: 'DOOR-900', p: [bx + 2000, by] });
  e0.push({ t: 'INSERT', layer: 'A-GLAZ', block: 'WIN-1200', p: [bx + 5000, by] });
  e0.push({ t: 'TEXT', layer: 'A-ANNO-TEXT', p: [a.px + 500, SHIFT_Y + maxY + 1200], h: TXT, s: `${s.address} 대지` });
  e0.push(...dims(s, a.px, SHIFT_Y));
  e0.push(...north(a.px + maxX + 5000, SHIFT_Y + 20000));
  e0.push(...frame(s, '배치도', siteArea, bldArea, ratio, 0));

  // --- 면적 산정도 ---
  const b = mk(SHEET_PITCH);
  const e1: Ent[] = [];
  e1.push({ t: 'LWPOLYLINE', layer: 'A-SITE-BNDY', pts: b.site, closed: true });
  e1.push({ t: 'HATCH', layer: 'A-AREA', pts: b.bl, color: 6 });
  e1.push({ t: 'LWPOLYLINE', layer: 'A-AREA', pts: b.bl, closed: true });
  const cx = Math.round(b.bl.reduce((m, p) => m + p[0], 0) / b.bl.length);
  e1.push({ t: 'TEXT', layer: 'A-AREA-IDEN', p: [cx, SHIFT_Y + 1200], h: TXT, s: `건축면적 ${bldArea}㎡`, anchor: 'c' });
  e1.push({ t: 'TEXT', layer: 'A-AREA-IDEN', p: [b.px + 500, SHIFT_Y + maxY + 1200], h: TXT, s: `대지면적 ${siteArea}㎡` });
  e1.push({
    t: 'MTEXT', layer: 'A-ANNO-TEXT', p: [b.px + maxX + 3000, SHIFT_Y + 22000], h: TXT_S, w: 30000,
    lines: ['면적 산정 (샘플)', `대지면적 = ${siteArea}㎡`, `건축면적 = ${bldArea}㎡`, `건폐율 = ${bldArea} / ${siteArea} × 100 = ${ratio}%`],
  });
  e1.push(...north(b.px + maxX + 5000, SHIFT_Y + 8000));
  e1.push(...frame(s, '면적 산정도', siteArea, bldArea, ratio, SHEET_PITCH));

  return { sheets: [{ name: '배치도', ox: 0, ents: e0 }, { name: '면적 산정도', ox: SHEET_PITCH, ents: e1 }], siteArea, bldArea, ratio };
}
