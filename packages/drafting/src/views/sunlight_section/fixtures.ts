// 테스트·골든 전용 고정 입력(배포 코드에서 import하지 않는다). 엔벨로프 출력은 rules의 가짜 팩(envelope/test-fixtures.ts)과 같은 가짜 수치를
// 손으로 옮긴 구조적 값이다 — 법령명·조문·수치·날짜는 모두 가짜(실제 법규 값 아님).
import type { DesignModelV1 } from "@arch-studio/domain";
import { sampleInput, sampleModel } from "../../sheet/test-fixtures.ts";
import type { DraftingInput } from "../../sheet/types.ts";
import type { SunlightBandInput, SunlightEnvelopeInput } from "./types.ts";

/** 가짜 구 기준(시행 2000-01-01): 3m까지 거리 1m, 그 위는 거리 ≥ 높이. */
export const OLD_BANDS: SunlightBandInput[] = [
  { up_to_mm: 3000, min_distance_mm: 1000 },
  { up_to_mm: null, distance_ratio: { num: 1, den: 1 } },
];

/** 가짜 신 기준(시행 2000-07-01): 4m까지 1.2m, 7m까지 3m, 그 위는 거리 ≥ 높이 × 2/3. */
export const NEW_BANDS: SunlightBandInput[] = [
  { up_to_mm: 4000, min_distance_mm: 1200 },
  { up_to_mm: 7000, min_distance_mm: 3000 },
  { up_to_mm: null, distance_ratio: { num: 2, den: 3 } },
];

export function envelopeOf(
  kind: "old" | "new" | "unverified",
  over: { application_date?: string; top_mm?: number; bands?: SunlightBandInput[] } = {},
): SunlightEnvelopeInput {
  const date = over.application_date ?? (kind === "old" ? "2000-06-30" : "2000-08-01");
  const common = { rule_pack_version: "2000.01.1", application_date: date, top_mm: over.top_mm ?? 12000 };
  if (kind === "unverified") {
    return {
      ...common,
      constraints: [
        { key: "sunlight", status: "unverified", applied: false, rule_ids: ["sunlight.unverified"], basis: [], reasons: ["UNVERIFIED_RULE"] },
      ],
    };
  }
  return {
    ...common,
    constraints: [
      {
        key: "sunlight",
        status: "applied",
        applied: true,
        rule_ids: [kind === "old" ? "sunlight.fake-old" : "sunlight.fake-new"],
        basis: [
          kind === "old"
            ? { law: "가짜 건축법 시행령", article: "제86조(구)", effective_from: "2000-01-01", ordinance: false }
            : { law: "가짜 건축법 시행령", article: "제86조(신)", effective_from: "2000-07-01", ordinance: false },
        ],
        reasons: [],
        applied_params: { bands: over.bands ?? (kind === "old" ? OLD_BANDS : NEW_BANDS), road_edges: "exempt" },
      },
    ],
  };
}

const rect = (x: number, y: number, w: number, h: number) => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as Array<[number, number]>,
});

/** 대지 20m×15m(남쪽 변이 도로, 북쪽 경계 y=15000), 매스 하나(x 2000~14000, y 2000~12000, 3m 층 floors개). */
export function sectionModel(opts: { floors?: number; date?: string; north_angle_deg?: number; y1?: number } = {}): DesignModelV1 {
  const m = sampleModel({ w: 20_000, h: 15_000 });
  const n = opts.floors ?? 2;
  m.masses = [
    {
      id: "m1",
      footprint: rect(2000, 2000, 12_000, (opts.y1 ?? 12_000) - 2000),
      base_level_mm: 0,
      floors: Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, level: i + 1, height_mm: 3000, use: "단독주택" })),
      roof: { type: "flat" },
    },
  ];
  m.floor_layouts = [];
  m.site.north_angle_deg = opts.north_angle_deg ?? 0;
  m.rule_context = { ...m.rule_context, application_date: opts.date ?? "2000-08-01", rule_pack_version: "2000.01.1" };
  return m;
}

export function sectionInput(model: DesignModelV1, over: Partial<DraftingInput["sheet"]> = {}): DraftingInput {
  const base = sampleInput(model);
  return {
    ...base,
    sheet: { ...base.sheet, kind: "sunlight_section", ...over },
    judgment: { ...base.judgment, application_date: model.rule_context.application_date, rule_pack_version: model.rule_context.rule_pack_version },
  };
}
