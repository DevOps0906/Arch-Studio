// site_plan 골든·테스트 공용 케이스(테스트 전용, 배포 코드에서 import하지 않는다).
import type { DesignModelV1, JudgmentResult, Polygon } from "@arch-studio/domain";
import type { DraftingInput } from "../../sheet/types.ts";
import { sampleInput, sampleModel } from "../../sheet/test-fixtures.ts";
import type { SitePlanExtras } from "./index.ts";

export interface SitePlanCase {
  id: string;
  note: string;
  input: DraftingInput;
  extras: SitePlanExtras;
}

export const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

type Item = JudgmentResult["items"][number];
const basis = [{ law: "건축법", article: "제55조", effective_from: "2026-01-01", ordinance: false }];

export function judgmentOf(items: Item[], model: DesignModelV1): JudgmentResult {
  return {
    engine_version: "0.0.0",
    rule_pack_version: model.rule_context.rule_pack_version,
    application_date: model.rule_context.application_date,
    items,
    pending_changes: 0,
  };
}

export const passItems = (over: { setback?: number; parking?: number } = {}): Item[] => [
  { key: "coverage", verdict: "PASS", value: 48.5, limit: 60, unit: "pct", basis },
  { key: "far", verdict: "PASS", value: 142.37, limit: 200, unit: "pct", basis },
  { key: "setback", verdict: "PASS", value: over.setback ?? 3000, limit: 1000, unit: "mm", basis },
  { key: "parking", verdict: "PASS", value: over.parking ?? 6, unit: "count", basis },
];

/** 대지 30m x 20m, 매스는 지정(기본: 중앙부 하나, 아래 변 도로 쪽에 주차 띠가 남는다). */
export function siteModel(masses: Array<{ id: string; fp: Polygon }> = [{ id: "m000", fp: rect(5_000, 8_000, 15_000, 8_000) }]): DesignModelV1 {
  const base = sampleModel({ w: 30_000, h: 20_000 });
  return {
    ...base,
    masses: masses.map((m) => ({
      id: m.id,
      footprint: m.fp,
      base_level_mm: 0,
      floors: [{ id: `${m.id}-f1`, level: 1, height_mm: 3_000, use: "단독주택" }],
      roof: { type: "flat" as const },
    })),
    floor_layouts: [{ floor_id: `${masses[0]?.id ?? "m000"}-f1`, rooms: [], openings: [] }],
  };
}

export function make(model: DesignModelV1, items: Item[]): DraftingInput {
  return sampleInput(model, { judgment: judgmentOf(items, model) });
}

const failItems = (): Item[] => [
  { key: "coverage", verdict: "FAIL", value: 63.25, limit: 60, unit: "pct", basis },
  { key: "far", verdict: "PASS", value: 142.37, limit: 200, unit: "pct", basis },
  { key: "setback", verdict: "FAIL", value: 800, limit: 1000, unit: "mm", basis },
  { key: "parking", verdict: "PASS", value: 6, unit: "count", basis },
];

function multiMass(): DraftingInput {
  const model = siteModel([
    { id: "m000", fp: rect(5_000, 8_000, 8_000, 8_000) },
    { id: "m001", fp: rect(11_000, 10_000, 8_000, 6_000) },
    { id: "m002", fp: rect(22_000, 9_000, 5_000, 7_000) },
  ]);
  model.site = {
    ...model.site,
    parcel: { pnu: "1100000000000000000", address_label: "서울 종로구 ○○동 1-1" },
    zoning: { ...model.site.zoning, building_line: [[0, 1_000], [30_000, 1_000]] },
  };
  return make(model, passItems({ setback: 2000, parking: 4 }));
}

export const CASES: SitePlanCase[] = [
  {
    id: "site_plan-basic",
    note: "기본: 매스 1개, 도로 6m, 주차 6대(장애인 1), 모두 PASS",
    input: make(siteModel(), passItems()),
    extras: { parking_accessible: 1 },
  },
  {
    id: "site_plan-fail-items",
    note: "FAIL 항목(건폐율·이격): 요약표와 도면에 검토 필요 표시, 이격 점 쌍 직접 지정",
    input: make(siteModel(), failItems()),
    extras: { parking_accessible: 1, setback_pair: [[5_000, 12_000], [0, 12_000]] },
  },
  {
    id: "site_plan-parking-shortage",
    note: "주차 40대: 자리 부족 → 대수 유지 + 배치 공간 부족 경고",
    input: make(siteModel(), passItems({ parking: 40 })),
    extras: { parking_accessible: 2 },
  },
  {
    id: "site_plan-multi-mass",
    note: "매스 3개(겹침 포함): 합집합 투영, 지번 라벨, 건축선",
    input: multiMass(),
    extras: {},
  },
];
