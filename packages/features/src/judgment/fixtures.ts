// 판정 패널 미리보기 시나리오. 규칙 팩 2026.10.0은 전 규칙이 미확인이라 엔진을 돌려서는 PASS·FAIL 행이 나오지 않는다.
// 그래서 PASS·FAIL 모양은 "[예시]"를 붙인 가짜 확정 규칙으로 만든 행으로만 본다(측정값은 실제 엔진 출력 그대로).
// 이 파일은 미리보기와 테스트만 import한다(릴리스 번들에 들어가지 않는 개발 라우트 뒤).
import type { JudgmentResult } from "@arch-studio/domain";
import { ENGINE_OUTPUTS, type EngineOutputFixture } from "./fixtures.engine.ts";
import type { JudgmentData, JudgmentDetailLike, JudgmentWarningLike } from "./model.ts";

export { ENGINE_OUTPUTS };

type Item = JudgmentResult["items"][number];

export const PREVIEW_TODAY = "2026-10-29";

/** 엔진 출력 → 패널 데이터. */
export function toData(out: EngineOutputFixture, extra: { pendingChanges?: number; elapsedMs?: number; warnings?: readonly JudgmentWarningLike[] } = {}): JudgmentData {
  return {
    result: { ...out.result, pending_changes: extra.pendingChanges ?? out.result.pending_changes },
    details: out.details,
    warnings: extra.warnings ?? out.warnings,
    modelRev: "preview-1",
    elapsedMs: extra.elapsedMs ?? 38,
  };
}

const EX_BASIS = (article: string, ordinance = false) => [{ law: "[예시] 법령명", article: `[예시] ${article}`, effective_from: "2026-01-01", ordinance }];

function detail(key: Item["key"], reasons: string[], edge?: "road" | "adjacent"): JudgmentDetailLike {
  return { key, status: "confirmed", reasons, ...(edge ? { edge_class: edge } : {}) };
}

/**
 * 가짜 확정 규칙 시나리오(모양 확인용). 측정값 value는 실제 엔진 출력 그대로 쓰고 한도·근거만 "[예시]"로 채운다.
 * mode "fail": 높이 초과·도로 이격 부족 / "warn": 조례 미확인·일부 통과.
 */
export function exampleConfirmed(out: EngineOutputFixture, mode: "fail" | "warn"): JudgmentData {
  const measured = (key: Item["key"], idx = 0): number | undefined => out.result.items.filter((i) => i.key === key)[idx]?.value;
  const cov = measured("coverage") ?? 30;
  const far = measured("far") ?? 60;
  const height = measured("height") ?? 6300;
  const road = measured("setback", 0) ?? 5000;
  const adj = measured("setback", 1) ?? 4000;
  const items: Item[] = [];
  const details: JudgmentDetailLike[] = [];
  const push = (it: Item, d: JudgmentDetailLike) => {
    items.push(it);
    details.push(d);
  };
  push({ key: "coverage", verdict: "PASS", value: cov, limit: 60, unit: "pct", basis: EX_BASIS("제00조") }, detail("coverage", []));
  push(
    { key: "far", verdict: mode === "fail" ? "PASS" : "WARN", value: far, limit: 150, unit: "pct", basis: EX_BASIS("제00조", true) },
    detail("far", mode === "fail" ? [] : ["ORDINANCE_UNVERIFIED"]),
  );
  push(
    { key: "height", verdict: mode === "fail" ? "FAIL" : "PASS", value: height, limit: mode === "fail" ? height - 450 : height + 3000, unit: "mm", basis: EX_BASIS("제00조") },
    detail("height", []),
  );
  push({ key: "sunlight", verdict: "WARN", unit: "mm", basis: EX_BASIS("제00조") }, detail("sunlight", ["NOT_COMPUTED_HERE"]));
  push(
    { key: "setback", verdict: mode === "fail" ? "FAIL" : "PASS", value: road, limit: mode === "fail" ? road + 1200 : road - 500, unit: "mm", basis: EX_BASIS("제00조") },
    detail("setback", [], "road"),
  );
  push({ key: "setback", verdict: "PASS", value: adj, limit: adj - 1000, unit: "mm", basis: EX_BASIS("제00조") }, detail("setback", [], "adjacent"));
  push({ key: "parking", verdict: "NA", value: 2, unit: "count", basis: EX_BASIS("제00조", true) }, detail("parking", ["CALCULATION_ONLY"]));
  push({ key: "seismic", verdict: "WARN", value: 1, unit: "bool", basis: EX_BASIS("제00조") }, detail("seismic", ["TARGET"]));
  push({ key: "zero_energy", verdict: "NA", value: 0, unit: "bool", basis: EX_BASIS("제00조") }, detail("zero_energy", ["NOT_TARGET"]));
  push({ key: "supervision", verdict: "NA", value: 0, unit: "bool", basis: EX_BASIS("제00조") }, detail("supervision", ["NOT_TARGET"]));
  const warnings: JudgmentWarningLike[] = [
    { code: "SCHEDULED_RULES", message: "신청 예정일 뒤에 시행되는 예정 규칙 1건이 있습니다(참고 표시만).", rule_ids: ["example.scheduled"] },
  ];
  return {
    result: { engine_version: out.result.engine_version, rule_pack_version: "[예시] 2000.01.1", application_date: out.result.application_date, items, pending_changes: 0 },
    details,
    warnings,
    modelRev: "preview-1",
    elapsedMs: 41,
  };
}

/** 근거 없는 행이 섞인 입력(표시 규칙 확인용): 건폐율은 근거가 비어 있어 행이 나오면 안 된다. */
export function withMissingBasis(data: JudgmentData): JudgmentData {
  return {
    ...data,
    result: {
      ...data.result,
      items: data.result.items.map((it, i) => (i === 0 ? { ...it, basis: [] } : it)),
    },
  };
}
