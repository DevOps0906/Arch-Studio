// 판정 엔진(AR-F-004·006·007): DesignModel + 규칙 팩 → JudgmentResult. 결정적 순수 함수.
// 행마다 근거(법령·조문·시행일)와 팩 버전을 싣는다. 근거 없는 행은 만들지 않는다(로더가 basis ≥ 1을 보장).
// PASS·FAIL은 "확정 규칙 + 지원 지역 + (조례 의존이면) 조례 확인 지자체"일 때만. 나머지는 WARN "확인 필요"(11_LEGAL 4절).
import { designModelV1Schema, type DesignModelV1, type JudgmentResult } from "@arch-studio/domain";
import { compareDistance, roundRatioHalfAway } from "@arch-studio/geometry";
import { RulesError } from "./errors.ts";
import { displayDistanceMm, measure, type ExactD2, type Measurements } from "./measure.ts";
import { selectRules, type Rule, type RulePack } from "./pack.ts";

/** 판정 엔진 버전(JudgmentResult.engine_version). 판정 로직이 바뀌면 올리고 골든을 갱신한다. */
export const ENGINE_VERSION = "rules-0.1.0";

type Item = JudgmentResult["items"][number];

/** 행이 WARN·NA가 된 이유. 화면 문구는 REASON_MESSAGES. */
export type ReasonCode =
  | "UNVERIFIED_RULE"
  | "UNSUPPORTED_REGION"
  | "ORDINANCE_UNVERIFIED"
  | "DISTRICT_NOT_IN_PACK"
  | "USE_NOT_IN_PACK"
  | "NOT_COMPUTED_HERE"
  | "CALCULATION_ONLY"
  | "TARGET"
  | "NOT_TARGET"
  | "MASS_OUTSIDE_SITE"
  | "NO_MASS"
  | "FAR_EXCLUSIONS_UNVERIFIED";

export const REASON_MESSAGES: Record<ReasonCode, string> = {
  UNVERIFIED_RULE: "확인 필요: 규칙 팩의 근거 조문·시행일이 미확인입니다(법규 원문 대조 전). 측정값만 참고로 표시합니다.",
  UNSUPPORTED_REGION: "미지원: 직접 확인 필요. 규칙 팩의 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다.",
  ORDINANCE_UNVERIFIED: "조례 미확인: 국가 기준 참고값입니다. 조례 기준을 직접 확인하세요.",
  DISTRICT_NOT_IN_PACK: "확인 필요: 이 용도지역의 기준이 규칙 팩에 없습니다.",
  USE_NOT_IN_PACK: "확인 필요: 일부 용도의 주차 기준이 규칙 팩에 없습니다.",
  NOT_COMPUTED_HERE: "확인 필요: 일조사선은 법규 엔벨로프에서 판정합니다.",
  CALCULATION_ONLY: "산정값: 계획 주차대수 입력이 없어 필요 대수만 표시합니다.",
  TARGET: "대상: 해당 설계 기준을 확인하세요.",
  NOT_TARGET: "대상 아님(규칙 팩 기준).",
  MASS_OUTSIDE_SITE: "매스가 대지 경계 밖으로 나갑니다(이격 0으로 판정).",
  NO_MASS: "매스가 없어 측정하지 않았습니다.",
  FAR_EXCLUSIONS_UNVERIFIED: "산정 제외 항목 미확인: 용적률 연면적은 지하층만 뺀 참고값입니다.",
};

export interface JudgmentDetail {
  /** result.items와 같은 순서·같은 길이. */
  key: Item["key"];
  rule_id: string;
  title: string;
  status: Rule["status"];
  edge_class?: "road" | "adjacent";
  reasons: ReasonCode[];
}

export type WarningCode =
  | "MUNICIPALITY_NOT_IN_PACK"
  | "ORDINANCE_UNVERIFIED_MUNICIPALITY"
  | "SCHEDULED_RULES"
  | "PACK_VERSION_MISMATCH";

export interface JudgeWarning {
  code: WarningCode;
  message: string;
  rule_ids?: string[];
}

export interface JudgeOutput {
  result: JudgmentResult;
  details: JudgmentDetail[];
  warnings: JudgeWarning[];
}

export interface JudgeOptions {
  /** 폴백 배너 "이후 개정 n건"(서버 arch.rule_pack_changes 값, 엔진은 계산하지 않는다). */
  pendingChanges?: number;
}

/** 2배 면적 비율 → % 값(소수 둘째 자리 half-away). */
function pct(num2: bigint, den2: bigint): number {
  return den2 === 0n ? 0 : roundRatioHalfAway(num2 * 10_000n, den2) / 100;
}

/** 소수 둘째 자리 수 → ×100 정수(로더가 둘째 자리까지만 허용). */
function h100(x: number): bigint {
  return BigInt(Math.round(x * 100));
}

const M2_TO_AREA2_PER_H100 = 20_000n; // 0.01 ㎡ = 10,000 mm², 2배 면적이라 ×2

interface Verdict {
  verdict: Item["verdict"];
  value?: number;
  limit?: number;
  reasons: ReasonCode[];
}

function minEdge(m: Measurements, cls: "road" | "adjacent"): ExactD2 | null | undefined {
  const ds = m.edges.filter((e) => e.edge_class === cls).map((e) => e.d2);
  if (ds.length === 0) return undefined; // 그 종류의 변이 없음 → 행 없음
  if (ds.some((d) => d === null)) return null; // 매스 없음
  return (ds as ExactD2[]).reduce((a, b) => (b.num * a.den < a.num * b.den ? b : a));
}

/** 규칙 하나의 원판정. 측정·팩 수치만 쓴다. 그 종류의 변이 없는 이격 규칙은 null(행 없음). */
function evaluate(rule: Rule, m: Measurements, district: string): Verdict | null {
  const unverified = rule.status === "unverified";
  switch (rule.key) {
    case "coverage":
    case "far": {
      let num = m.building_area2;
      if (rule.key === "far") {
        // 제외 항목은 확정 규칙 params에서. 없으면(미확인) 지하층만 빼고 "산정 제외 항목 미확인" 표기.
        const excl = rule.params?.far_floor_area_exclusions ?? ["basement"];
        num = m.above_area2 + (excl.includes("basement") ? 0n : m.below_area2);
      }
      const value = pct(num, m.site_area2);
      if (unverified || !rule.params) {
        const reasons: ReasonCode[] = rule.key === "far" ? ["UNVERIFIED_RULE", "FAR_EXCLUSIONS_UNVERIFIED"] : ["UNVERIFIED_RULE"];
        return { verdict: "WARN", value, reasons };
      }
      const limitPct = rule.params.max_pct_by_district[district];
      if (limitPct === undefined) return { verdict: "WARN", value, reasons: ["DISTRICT_NOT_IN_PACK"] };
      const ok = num * 10_000n <= h100(limitPct) * m.site_area2;
      return { verdict: ok ? "PASS" : "FAIL", value, limit: limitPct, reasons: [] };
    }
    case "height": {
      const value = m.height_mm;
      if (unverified || !rule.params) return { verdict: "WARN", value, reasons: ["UNVERIFIED_RULE"] };
      const limit = rule.params.max_mm_by_district[district];
      if (limit === undefined) return { verdict: "WARN", value, reasons: ["DISTRICT_NOT_IN_PACK"] };
      return { verdict: value <= limit ? "PASS" : "FAIL", value, limit, reasons: [] };
    }
    case "setback": {
      const d2 = minEdge(m, rule.edge_class);
      if (d2 === undefined) return null;
      const extra: ReasonCode[] = m.mass_outside_site ? ["MASS_OUTSIDE_SITE"] : [];
      if (d2 === null) {
        return { verdict: "WARN", reasons: unverified ? ["UNVERIFIED_RULE", "NO_MASS"] : ["NO_MASS"] };
      }
      const value = displayDistanceMm(d2);
      if (unverified || !rule.params) return { verdict: "WARN", value, reasons: ["UNVERIFIED_RULE", ...extra] };
      const limit = rule.params.min_mm;
      return { verdict: compareDistance({ d2_exact: d2 }, limit) < 0 ? "FAIL" : "PASS", value, limit, reasons: extra };
    }
    case "parking": {
      if (unverified || !rule.params) return { verdict: "WARN", reasons: ["UNVERIFIED_RULE"] };
      // 필요 대수 = Σ 용도 바닥면적 / 대당 면적(유리수 합) → rounding 한 번.
      let num = 0n;
      let den = 1n;
      let missing = false;
      for (const [use, a2] of m.floor_area2_by_use) {
        const std = rule.params.by_use.find((u) => u.use === use);
        if (!std) {
          missing = true;
          continue;
        }
        const d = h100(std.floor_area_m2_per_space) * M2_TO_AREA2_PER_H100;
        num = num * d + a2 * den;
        den = den * d;
      }
      const q = num / den;
      const r = num - q * den;
      const value = Number(
        rule.params.rounding === "floor" ? q : rule.params.rounding === "ceil" ? (r > 0n ? q + 1n : q) : 2n * r >= den ? q + 1n : q,
      );
      return { verdict: missing ? "WARN" : "NA", value, reasons: missing ? ["USE_NOT_IN_PACK"] : ["CALCULATION_ONLY"] };
    }
    case "seismic":
    case "zero_energy":
    case "supervision": {
      if (unverified || !rule.params) return { verdict: "WARN", reasons: ["UNVERIFIED_RULE"] };
      const { min_floors, min_gross_area_m2 } = rule.params;
      const byFloors = min_floors !== undefined && m.above_floors >= min_floors;
      const byArea = min_gross_area_m2 !== undefined && m.gross_area2 >= h100(min_gross_area_m2) * M2_TO_AREA2_PER_H100;
      const target = byFloors || byArea;
      return { verdict: target ? "WARN" : "NA", value: target ? 1 : 0, reasons: [target ? "TARGET" : "NOT_TARGET"] };
    }
    case "sunlight":
      return { verdict: "WARN", reasons: unverified ? ["UNVERIFIED_RULE", "NOT_COMPUTED_HERE"] : ["NOT_COMPUTED_HERE"] };
  }
}

const UNIT: Record<Item["key"], Item["unit"]> = {
  coverage: "pct",
  far: "pct",
  height: "mm",
  sunlight: "mm",
  setback: "mm",
  parking: "count",
  seismic: "bool",
  zero_energy: "bool",
  supervision: "bool",
};

/**
 * 판정. model.rule_context(신청 예정일·지자체)로 팩 안 규칙을 고른다.
 * 팩 버전이 rule_context와 다르면 경고(PACK_VERSION_MISMATCH)를 남기고 받은 팩으로 판정한다.
 */
export function judge(model: DesignModelV1, pack: RulePack, options: JudgeOptions = {}): JudgeOutput {
  const parsed = designModelV1Schema.safeParse(model);
  if (!parsed.success) {
    throw new RulesError("INVALID_INPUT", `DesignModel 검사 실패 — ${parsed.error.issues[0]?.path.join(".")}`);
  }
  const pendingChanges = options.pendingChanges ?? 0;
  if (!Number.isSafeInteger(pendingChanges) || pendingChanges < 0) {
    throw new RulesError("INVALID_INPUT", `pendingChanges는 0 이상 정수여야 합니다: ${pendingChanges}`);
  }
  const ctx = model.rule_context;
  const { active, scheduled } = selectRules(pack, ctx.application_date, ctx.municipality_code);
  const m = measure(model);
  const district = model.site.zoning.use_district;

  const warnings: JudgeWarning[] = [];
  if (ctx.rule_pack_version !== pack.version) {
    warnings.push({
      code: "PACK_VERSION_MISMATCH",
      message: `프로젝트 기준 팩 ${ctx.rule_pack_version} 대신 ${pack.version}으로 판정했습니다.`,
    });
  }
  const muni = pack.municipalities.find((x) => x.code === ctx.municipality_code);
  if (!muni) {
    warnings.push({
      code: "MUNICIPALITY_NOT_IN_PACK",
      message: `조례 미확인 지자체(${ctx.municipality_code}): 규칙 팩 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다. 직접 확인하세요.`,
    });
  } else if (muni.ordinance === "unverified") {
    warnings.push({
      code: "ORDINANCE_UNVERIFIED_MUNICIPALITY",
      message: `조례 미확인 지자체(${muni.name}): 조례 의존 항목은 국가 기준 참고값으로만 표시합니다.`,
    });
  }
  if (scheduled.length > 0) {
    warnings.push({
      code: "SCHEDULED_RULES",
      message: `신청 예정일(${ctx.application_date}) 뒤에 시행되는 예정 규칙 ${scheduled.length}건이 있습니다(참고 표시만).`,
      rule_ids: scheduled.map((r) => r.id),
    });
  }

  const items: Item[] = [];
  const details: JudgmentDetail[] = [];
  for (const rule of active) {
    const v = evaluate(rule, m, district);
    if (v === null) continue;
    let { verdict } = v;
    const reasons = [...v.reasons];
    // 확정 규칙의 PASS·FAIL·NA(산정·대상 여부)도 지원 지역 밖·조례 미확인이면 WARN + 참고값(11_LEGAL 4절, AR-F-006).
    if (rule.status === "confirmed") {
      if (!muni) {
        verdict = "WARN";
        reasons.push("UNSUPPORTED_REGION");
      } else if (rule.ordinance_dependent && muni.ordinance === "unverified") {
        verdict = "WARN";
        reasons.push("ORDINANCE_UNVERIFIED");
      }
    }
    const item: Item = {
      key: rule.key,
      verdict,
      unit: UNIT[rule.key],
      basis: rule.basis.map((b) => ({ law: b.law, article: b.article, effective_from: b.effective_from, ordinance: b.ordinance })),
    };
    if (v.value !== undefined) item.value = v.value;
    if (v.limit !== undefined) item.limit = v.limit;
    items.push(item);
    const detail: JudgmentDetail = { key: rule.key, rule_id: rule.id, title: rule.title, status: rule.status, reasons };
    if (rule.key === "setback") detail.edge_class = rule.edge_class;
    details.push(detail);
  }

  return {
    result: {
      engine_version: ENGINE_VERSION,
      rule_pack_version: pack.version,
      application_date: ctx.application_date,
      items,
      pending_changes: pendingChanges,
    },
    details,
    warnings,
  };
}
