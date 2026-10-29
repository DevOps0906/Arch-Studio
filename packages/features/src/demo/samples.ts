// 데모 샘플 프로젝트 3개(개발 전용, 릴리스 번들 0 — demo/index.ts 주석). 값은 [예시]이며 판정 결과를 약속하지 않는다.
// 모두 DesignModel v1(04_API 4.7.1) 계약을 만족한다(demo.test.ts가 packages/domain zod 스키마로 검증). 단위 mm 정수, 외곽 반시계.
import type { DesignModelV1 } from "@arch-studio/domain";

/** 릴리스 번들 검사 표식(apps/desktop/scripts/check-release-bundle.mjs). 이 문자열이 릴리스 산출물에 있으면 실패한다. */
export const DEMO_MARKER = "arch-demo-data-v1";

export interface DemoProject {
  readonly id: string;
  readonly name: string;
  readonly siteLabel: string;
  readonly clientName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly model: DesignModelV1;
}

const META = { created_by_engine_version: "0.0.0-demo" } as const;
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** ① 단독주택 2층: 대지 18×22m(396㎡), 제1종일반주거, 남측 6m 도로. 건축면적 120㎡(건폐 약 30%). */
const house: DesignModelV1 = {
  schema_version: 1,
  units: "mm",
  site: {
    boundary: { outer: rect(0, 0, 18000, 22000) },
    north_angle_deg: 0,
    roads: [{ edge_index: 0, width_mm: 6000 }],
    zoning: { use_district: "제1종일반주거지역", districts: ["지구단위계획구역"] },
    parcel: { address_label: "[예시] 경기 성남시 분당구 운중동 000-0" },
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-12-01", municipality_code: "41135", ordinance_applied: true },
  masses: [
    {
      id: "m-house",
      footprint: { outer: rect(4000, 5000, 14000, 17000) },
      base_level_mm: 0,
      floors: [
        { id: "f1", level: 1, height_mm: 3300, use: "단독주택" },
        { id: "f2", level: 2, height_mm: 3000, use: "단독주택" },
      ],
      roof: { type: "gable", pitch: 0.4 },
    },
  ],
  floor_layouts: [
    {
      floor_id: "f1",
      rooms: [
        { id: "r-living", name: "거실", use: "거실", polygon: { outer: rect(4000, 5000, 10000, 10500) } },
        { id: "r-kitchen", name: "주방·식당", use: "주방", polygon: { outer: rect(10000, 5000, 14000, 10500) } },
        { id: "r-bed1", name: "안방", use: "침실", polygon: { outer: rect(4000, 10500, 9000, 14500) } },
        { id: "r-bath1", name: "욕실", use: "욕실", polygon: { outer: rect(9000, 10500, 11500, 13000) } },
        { id: "r-hall", name: "현관·계단", use: "현관", polygon: { outer: rect(11500, 10500, 14000, 17000) } },
      ],
      openings: [
        { id: "o-entry", kind: "door", host: { room_id: "r-hall", edge_index: 1 }, offset_mm: 1500, width_mm: 1000, swing: "left" },
        { id: "o-living-w", kind: "window", host: { room_id: "r-living", edge_index: 0 }, offset_mm: 1000, width_mm: 3600 },
      ],
    },
    {
      floor_id: "f2",
      rooms: [
        { id: "r-bed2", name: "침실 2", use: "침실", polygon: { outer: rect(4000, 5000, 8500, 9500) } },
        { id: "r-bed3", name: "침실 3", use: "침실", polygon: { outer: rect(8500, 5000, 14000, 9500) } },
        { id: "r-family", name: "가족실", use: "거실", polygon: { outer: rect(4000, 9500, 11500, 17000) } },
      ],
      openings: [],
    },
  ],
  program: {
    checklist_answers: { households: 1, family_size: 4, garage: true, budget_band: "중" },
    targets: [
      { name: "거실", use: "거실", target_area_m2: 33 },
      { name: "주방·식당", use: "주방", target_area_m2: 22 },
      { name: "안방", use: "침실", target_area_m2: 20 },
      { name: "침실 2", use: "침실", target_area_m2: 20 },
      { name: "침실 3", use: "침실", target_area_m2: 24 },
    ],
    user_locked_rows: ["거실"],
  },
  meta: META,
};

/** ② 점포겸용 주택 3층: 대지 15×25m(375㎡), 제2종일반주거, 동측 8m 도로. 1층 근린생활시설, 2~3층 주택. */
const mixed: DesignModelV1 = {
  schema_version: 1,
  units: "mm",
  site: {
    boundary: { outer: rect(0, 0, 15000, 25000) },
    north_angle_deg: 12,
    roads: [{ edge_index: 1, width_mm: 8000 }],
    zoning: { use_district: "제2종일반주거지역", districts: [] },
    parcel: { address_label: "[예시] 인천 연수구 송도동 00-0" },
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2026-11-15", municipality_code: "28185", ordinance_applied: true },
  masses: [
    {
      id: "m-mixed",
      footprint: { outer: rect(2000, 3000, 13000, 19000) },
      base_level_mm: 0,
      floors: [
        { id: "f1", level: 1, height_mm: 4000, use: "제2종근린생활시설" },
        { id: "f2", level: 2, height_mm: 2900, use: "다가구주택" },
        { id: "f3", level: 3, height_mm: 2900, use: "다가구주택" },
      ],
      roof: { type: "flat" },
    },
  ],
  floor_layouts: [
    {
      floor_id: "f1",
      rooms: [
        { id: "r-shop", name: "점포", use: "근린생활시설", polygon: { outer: rect(2000, 3000, 13000, 14000) } },
        { id: "r-core", name: "계단실", use: "계단", polygon: { outer: rect(2000, 14000, 6000, 19000) } },
      ],
      openings: [{ id: "o-shop", kind: "door", host: { room_id: "r-shop", edge_index: 1 }, offset_mm: 3000, width_mm: 1800, swing: "right" }],
    },
  ],
  program: {
    checklist_answers: { households: 2, shop: true, parking_spaces: 3 },
    targets: [
      { name: "점포", use: "근린생활시설", target_area_m2: 110 },
      { name: "주택 A", use: "주거", target_area_m2: 85 },
      { name: "주택 B", use: "주거", target_area_m2: 85 },
    ],
    user_locked_rows: [],
  },
  meta: META,
};

/** ③ 다세대주택 4층: 모서리 가각(3m) 대지 20×24m − 4.5㎡ = 475.5㎡, 제2종일반주거, 남측 6m·서측 4m 도로. L자 매스. */
const multi: DesignModelV1 = {
  schema_version: 1,
  units: "mm",
  site: {
    boundary: {
      outer: [
        [3000, 0],
        [20000, 0],
        [20000, 24000],
        [0, 24000],
        [0, 3000],
      ],
    },
    north_angle_deg: -8,
    roads: [
      { edge_index: 0, width_mm: 6000 },
      { edge_index: 3, width_mm: 4000 },
    ],
    zoning: { use_district: "제2종일반주거지역", districts: ["가로구역별 최고높이 지정구역"] },
    parcel: { address_label: "[예시] 서울 강남구 역삼동 000-00" },
  },
  rule_context: { rule_pack_version: "2026.10.0", application_date: "2027-01-10", municipality_code: "11680", ordinance_applied: false },
  masses: [
    {
      id: "m-multi",
      footprint: {
        outer: [
          [3000, 4000],
          [17000, 4000],
          [17000, 12000],
          [11000, 12000],
          [11000, 19000],
          [3000, 19000],
        ],
      },
      base_level_mm: 0,
      floors: [
        { id: "f1", level: 1, height_mm: 3000, use: "필로티·주차장" },
        { id: "f2", level: 2, height_mm: 2800, use: "다세대주택" },
        { id: "f3", level: 3, height_mm: 2800, use: "다세대주택" },
        { id: "f4", level: 4, height_mm: 2800, use: "다세대주택" },
      ],
      roof: { type: "flat" },
    },
  ],
  floor_layouts: [],
  program: {
    checklist_answers: { households: 6, parking_spaces: 6, elevator: true },
    targets: [
      { name: "세대 1·2층", use: "주거", target_area_m2: 59 },
      { name: "세대 3·4층", use: "주거", target_area_m2: 59 },
    ],
    user_locked_rows: [],
  },
  meta: META,
};

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    id: "0192f0a0-1c00-7a01-8a01-000000000001",
    name: "운중동 단독주택",
    siteLabel: "제1종일반주거 · 396㎡",
    clientName: "[예시] 김 건축주",
    createdAt: "2026-10-20T01:00:00.000Z",
    updatedAt: "2026-10-28T06:30:00.000Z",
    model: house,
  },
  {
    id: "0192f0a0-1c00-7a01-8a01-000000000002",
    name: "송도 점포겸용 주택",
    siteLabel: "제2종일반주거 · 375㎡",
    clientName: null,
    createdAt: "2026-10-18T02:00:00.000Z",
    updatedAt: "2026-10-27T09:10:00.000Z",
    model: mixed,
  },
  {
    id: "0192f0a0-1c00-7a01-8a01-000000000003",
    name: "역삼동 다세대주택",
    siteLabel: "제2종일반주거 · 475.5㎡",
    clientName: "[예시] 역삼 시행",
    createdAt: "2026-10-10T03:00:00.000Z",
    updatedAt: "2026-10-22T04:45:00.000Z",
    model: multi,
  },
];
