// area_plan 골든 케이스 정의(테스트·골든 갱신 스크립트 전용, 배포 코드에서 import하지 않는다).
import type { DesignModelV1, JudgmentResult, Polygon } from "@arch-studio/domain";
import { buildSheet } from "../../sheet/build.ts";
import type { DraftingInput, SheetModel } from "../../sheet/types.ts";
import { validateDraftingInput } from "../../sheet/validate.ts";
import { sampleInput, sampleModel } from "../../sheet/test-fixtures.ts";
import { buildAreaPlanView, type AreaPlanInput } from "./index.ts";

export interface AreaGoldenCase {
  id: string;
  note: string;
  input(): AreaPlanInput;
}

export const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  outer: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ],
});

const BASIS = [{ law: "건축법 시행령", article: "제119조", effective_from: "2026-01-01", ordinance: false }];

export function judgmentOf(model: DesignModelV1, items: JudgmentResult["items"], pending = 0): JudgmentResult {
  return {
    engine_version: "0.0.0",
    rule_pack_version: model.rule_context.rule_pack_version,
    application_date: model.rule_context.application_date,
    items,
    pending_changes: pending,
  };
}

export function areaInput(model: DesignModelV1, judgment: JudgmentResult, over: Partial<AreaPlanInput> = {}): AreaPlanInput {
  const base = sampleInput(model);
  return { ...base, judgment, sheet: { ...base.sheet, kind: "area_plan" }, ...over };
}

/** 대지 20×15m에 매스를 직접 지정한 모델. */
export function modelWith(masses: DesignModelV1["masses"], pack = "2026.10.0"): DesignModelV1 {
  const m = sampleModel();
  return { ...m, masses, floor_layouts: [], rule_context: { ...m.rule_context, rule_pack_version: pack } };
}

const floor = (id: string, level: number, use: string) => ({ id, level, height_mm: 3_000, use });
const flat = { type: "flat" as const };

const single = (): AreaPlanInput => {
  const model = modelWith([{ id: "m1", footprint: rect(2_000, 2_000, 10_000, 8_000), base_level_mm: 0, floors: [floor("m1-1", 1, "단독주택")], roof: flat }]);
  return areaInput(
    model,
    judgmentOf(model, [
      { key: "coverage", verdict: "PASS", value: 26.67, limit: 60, unit: "pct", basis: BASIS },
      { key: "far", verdict: "PASS", value: 26.67, limit: 200, unit: "pct", basis: BASIS },
    ]),
  );
};

const multi = (): AreaPlanInput => {
  const model = modelWith([
    {
      id: "m1",
      footprint: { outer: [[2_000, 2_000], [14_333, 2_000], [14_333, 9_777], [2_000, 9_777]] },
      base_level_mm: 0,
      floors: [floor("m1-b1", -1, "주차장"), floor("m1-1", 1, "제2종근린생활시설"), floor("m1-2", 2, "제2종근린생활시설"), floor("m1-3", 3, "제2종근린생활시설")],
      roof: flat,
    },
  ]);
  return areaInput(
    model,
    judgmentOf(model, [
      { key: "coverage", verdict: "PASS", value: 41.1, limit: 60, unit: "pct", basis: BASIS },
      { key: "far", verdict: "PASS", value: 123.31, limit: 200, unit: "pct", basis: BASIS },
    ]),
    { sheet: { ...sampleInput().sheet, kind: "area_plan", paper: "A2" } },
  );
};

const multiUse = (): AreaPlanInput => {
  const model = modelWith([
    {
      id: "m1",
      footprint: rect(1_000, 1_000, 9_000, 7_000),
      base_level_mm: 0,
      floors: [floor("m1-1", 1, "근린생활시설"), floor("m1-2", 2, "단독주택")],
      roof: flat,
    },
    // m1과 겹치는 부속 매스: 같은 1층 면적은 합집합, 용도별은 매스 면적 합.
    { id: "m2", footprint: rect(8_000, 5_000, 6_000, 6_000), base_level_mm: 0, floors: [floor("m2-1", 1, "창고")], roof: flat },
  ]);
  return areaInput(
    model,
    judgmentOf(model, [
      { key: "coverage", verdict: "PASS", value: 33.3, limit: 60, unit: "pct", basis: BASIS },
      { key: "far", verdict: "PASS", value: 45.12, limit: 200, unit: "pct", basis: BASIS },
    ]),
    { sheet: { ...sampleInput().sheet, kind: "area_plan", paper: "A2" } },
  );
};

const packVersion = (): AreaPlanInput => {
  const model = modelWith(
    [{ id: "m1", footprint: rect(2_000, 2_000, 9_999, 7_001), base_level_mm: 0, floors: [floor("m1-1", 1, "단독주택"), floor("m1-2", 2, "단독주택")], roof: flat }],
    "2026.10.0-draft",
  );
  return areaInput(
    model,
    judgmentOf(
      model,
      [
        { key: "coverage", verdict: "WARN", value: 23.33, unit: "pct", basis: BASIS },
        { key: "far", verdict: "WARN", value: 46.66, unit: "pct", basis: BASIS },
        // 근거 조항이 비어 있으면 표에 올리지 않는다.
        { key: "height", verdict: "WARN", value: 6000, unit: "mm", basis: [] },
        { key: "parking", verdict: "NA", unit: "count", basis: BASIS },
      ],
      2,
    ),
    { license: { drafting_watermark: false, fallback_revisions: 2 } },
  );
};

export const CASES: AreaGoldenCase[] = [
  { id: "area_plan-single-floor", note: "단층 단독주택, A3 가로, 건폐율·용적률 판정 행", input: single },
  { id: "area_plan-multi-floor", note: "지하1~지상3층 근린생활시설, A2, 소수 둘째 자리 반올림(홀수 mm 좌표)", input: multi },
  { id: "area_plan-multi-use", note: "층·매스별 용도 여러 개, 겹치는 매스(층 면적은 합집합)", input: multiUse },
  { id: "area_plan-rule-pack-unverified", note: "규칙 팩 버전 표기, 미확인(WARN) 항목 참고값 표시, 근거 없는 행 생략, 폴백 개정 건수", input: packVersion },
];

/** 검증(AR050 없음) → 뷰 → 시트. */
export function buildAreaSheet(raw: AreaPlanInput): SheetModel {
  const v = validateDraftingInput(raw);
  if (!v.ok) throw new Error(`${v.code}: ${v.issues.join("; ")}`);
  const input: AreaPlanInput = { ...(v.input as DraftingInput), ...(raw.area_breakdown ? { area_breakdown: raw.area_breakdown } : {}) };
  return buildSheet(input, buildAreaPlanView(input)).sheet;
}
