// 테스트 전용 고정 입력(배포 코드에서 import하지 않는다). 판정 필수 필드를 모두 채운 최소 DesignModel v1.
import type { DesignModelV1 } from "./design-model.ts";

export function validDesignModel(): DesignModelV1 {
  return {
    schema_version: 1,
    units: "mm",
    site: {
      boundary: {
        outer: [
          [0, 0],
          [20000, 0],
          [20000, 15000],
          [0, 15000],
        ],
      },
      north_angle_deg: 0,
      roads: [{ edge_index: 0, width_mm: 6000 }],
      zoning: { use_district: "제2종일반주거지역", districts: [] },
      parcel: { pnu: "1100000000000000000" },
    },
    rule_context: {
      rule_pack_version: "2026.10.0",
      application_date: "2026-11-01",
      municipality_code: "11000",
      ordinance_applied: true,
    },
    masses: [
      {
        id: "m1",
        footprint: {
          outer: [
            [2000, 2000],
            [12000, 2000],
            [12000, 10000],
            [2000, 10000],
          ],
        },
        base_level_mm: 0,
        floors: [{ id: "f1", level: 1, height_mm: 3000, use: "단독주택" }],
        roof: { type: "flat" },
      },
    ],
    floor_layouts: [
      {
        floor_id: "f1",
        rooms: [
          {
            id: "r1",
            name: "거실",
            use: "거실",
            polygon: {
              outer: [
                [2000, 2000],
                [8000, 2000],
                [8000, 6000],
                [2000, 6000],
              ],
            },
          },
        ],
        openings: [
          { id: "o1", kind: "door", host: { room_id: "r1", edge_index: 0 }, offset_mm: 500, width_mm: 900, swing: "left" },
        ],
      },
    ],
    program: {
      checklist_answers: { households: 1, garage: true },
      targets: [{ name: "거실", use: "거실", target_area_m2: 24 }],
      user_locked_rows: [],
    },
    meta: { created_by_engine_version: "0.0.0" },
  };
}
