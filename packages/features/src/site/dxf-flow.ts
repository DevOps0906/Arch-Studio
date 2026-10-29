// DXF 대지 가져오기 상태기계(03장 2.4절, 5.3절 AR053~AR055, tasks/logs/AR-06-029.md 결과 형식).
// 조용한 추정 금지: 단위가 모호하면(`needs_unit`) 또는 범위 추정이면(`unit.needs_confirmation`) 반드시 단위 대화상자 단계를 거친다.
// 후보 선택 단계("choose")로는 단위가 확정된 결과(선언 일치·사용자 선택·사용자 확인)에서만 간다. 순수 함수(node --test 대상).
import type { DxfImportResult, DxfUnit, SiteCandidate, UnitInfo, UnitOption } from "@arch-studio/io";
import type { Point } from "@arch-studio/domain";
import { formatMm, type SiteCandidateView } from "./model.ts";

export const UNIT_LABEL: Readonly<Record<DxfUnit, string>> = { mm: "mm", cm: "cm", m: "m", in: "inch", ft: "ft" };

/** 5.3절 문구. */
export const DXF_TEXT = {
  AR053: "도면 단위를 판별하지 못했습니다. 이 도면의 단위를 골라 주세요.",
  confirm: (unit: DxfUnit) => `좌표 범위로 보아 도면 단위를 ${UNIT_LABEL[unit]}로 추정했습니다. 맞는지 확인해 주세요.`,
  /** 헤더 선언 단위를 그대로 믿지 않고 확인받는 문구(mm가 아니거나 다른 단위로도 대지 크기로 읽힐 때). */
  confirmHeader: (unit: DxfUnit, ambiguous: boolean) =>
    `도면 헤더는 단위를 ${UNIT_LABEL[unit]}로 선언했습니다. ${ambiguous ? "다른 단위로 읽어도 대지 크기로 보일 수 있어" : "mm가 아닌 단위는 면적이 크게 달라질 수 있어"} 실제 크기를 보고 맞는 단위를 골라 주세요.`,
  AR054: (n: number, kinds: string) => `지원하지 않는 요소 ${formatMm(n)}개(${kinds})를 건너뛰었습니다. 나머지로 계속합니다.`,
  AR055: "파일이 20MB를 넘습니다. 필요한 레이어만 남겨 다시 저장하세요.",
  unreadable: "이 파일에서 도면 요소를 읽지 못했습니다.",
  noClosed: "닫힌 선만 대지 경계로 쓸 수 있습니다. 대지 경계가 닫힌 폴리라인인지 확인하세요.",
} as const;

export type DxfFlow =
  | { readonly step: "idle" }
  | { readonly step: "reading" }
  /** AR053: 후보 없음. 사용자가 단위를 골라야 다시 파싱한다. */
  | { readonly step: "ask_unit"; readonly message: string; readonly options: readonly UnitOption[] }
  /** 범위 추정 단위: 사용자가 확인(또는 다른 단위 선택)해야 후보를 보인다. 후보는 보관만 한다. */
  | {
      readonly step: "confirm_unit";
      readonly message: string;
      readonly unit: DxfUnit;
      /** io가 계산한 단위별 환산 크기(선택지 전체). */
      readonly options: readonly UnitOption[];
      readonly pending: Extract<DxfImportResult, { status: "ok" }>;
    }
  | {
      readonly step: "choose";
      readonly unit: DxfUnit;
      readonly info: UnitInfo;
      readonly candidates: readonly SiteCandidate[];
      readonly warning: string | null;
    }
  | { readonly step: "error"; readonly message: string };

function warningOf(result: Extract<DxfImportResult, { ok: true }>): string | null {
  const w = result.warnings.find((x) => x.code === "AR054");
  if (!w) return null;
  const entries = Object.entries(w.skipped_entities);
  const n = entries.reduce((s, [, c]) => s + c, 0);
  return n > 0 ? DXF_TEXT.AR054(n, entries.map(([k]) => k).join(", ")) : null;
}

/** 파서 결과 → 다음 단계. `userChoseUnit`이면 사용자가 고른 단위로 다시 부른 결과라 확인을 다시 묻지 않는다. */
export function dxfNext(result: DxfImportResult, userChoseUnit = false): DxfFlow {
  if (!result.ok) return { step: "error", message: result.error.code === "AR055" ? DXF_TEXT.AR055 : DXF_TEXT.unreadable };
  if (result.status === "needs_unit") {
    // 그럴듯한 단위를 앞에(사용자 판단 보조, 자동 선택은 하지 않는다)
    const options = [...result.options].sort((a, b) => Number(b.plausible) - Number(a.plausible));
    return { step: "ask_unit", message: DXF_TEXT.AR053, options };
  }
  if (!userChoseUnit) {
    const { unit } = result.unit;
    // 헤더 선언도 그대로 믿지 않는다: mm가 아니거나, 선언 외 다른 단위도 대지 크기로 그럴듯하면 확인 단계를 거친다.
    const otherPlausible = result.unit.options.some((o) => o.unit !== unit && o.plausible && o.fits_coord_limit);
    const headerNeedsCheck = result.unit.source === "insunits" && (unit !== "mm" || otherPlausible);
    if (result.unit.needs_confirmation || headerNeedsCheck) {
      const message = result.unit.source === "insunits" ? DXF_TEXT.confirmHeader(unit, otherPlausible) : DXF_TEXT.confirm(unit);
      return { step: "confirm_unit", message, unit, options: result.unit.options, pending: result };
    }
  }
  if (result.candidates.length === 0) return { step: "error", message: DXF_TEXT.noClosed };
  return { step: "choose", unit: result.unit.unit, info: result.unit, candidates: result.candidates, warning: warningOf(result) };
}

/**
 * 단위 확인 대화상자의 답. 추정 단위를 그대로 확인하면 보관한 결과로 후보 단계, 다른 단위를 고르면 그 단위로 다시 파싱해야 한다.
 */
export function confirmUnit(flow: Extract<DxfFlow, { step: "confirm_unit" }>, chosen: DxfUnit): { next: DxfFlow } | { rerun: DxfUnit } {
  if (chosen !== flow.unit) return { rerun: chosen };
  return { next: dxfNext(flow.pending, true) };
}

/** 대화상자를 띄워야 하는 단계인가(화면은 이 값이 true면 Dialog를 연다). */
export function needsUnitDialog(flow: DxfFlow): boolean {
  return flow.step === "ask_unit" || flow.step === "confirm_unit";
}

/** 단위 대화상자에서 고를 수 있는 단위: io가 준 options 전체(mm·cm·m, 필요하면 in·ft). 추정 단위가 먼저. */
export function unitChoices(flow: DxfFlow): DxfUnit[] {
  if (flow.step === "ask_unit") return flow.options.map((o) => o.unit);
  if (flow.step === "confirm_unit") return [flow.unit, ...flow.options.map((o) => o.unit).filter((u) => u !== flow.unit)];
  return [];
}

const HEADER_UNIT_BY_INSUNITS: Readonly<Record<number, DxfUnit>> = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" };

/** 후보 단계에 항상 보이는 "적용 단위" 문구. 헤더와 다른 단위를 쓰면 그 차이(declared_mismatch)를 함께 적는다. */
export function appliedUnitText(info: UnitInfo): string {
  const label = UNIT_LABEL[info.unit];
  const source = info.source === "insunits" ? "헤더" : info.source === "caller" ? "직접 선택" : "범위 추정";
  let text = `적용 단위: ${label}(${source})`;
  if (info.declared_mismatch) {
    const header = info.declared_insunits !== null ? HEADER_UNIT_BY_INSUNITS[info.declared_insunits] : undefined;
    text += header ? ` · 헤더 선언은 ${UNIT_LABEL[header]}과(와) 다릅니다` : " · 헤더 선언과 다릅니다";
  }
  return text;
}

/** io 후보 → 화면 후보(같은 모양). */
export function candidateFromDxf(c: SiteCandidate, info?: UnitInfo): SiteCandidateView {
  const xs = c.polygon.outer.map((p) => p[0]);
  const ys = c.polygon.outer.map((p) => p[1]);
  const extent_mm: [number, number] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  return {
    origin: "dxf",
    outer: c.polygon.outer.map((p) => [p[0], p[1]] as Point),
    area_mm2: c.area_mm2,
    perimeter_mm: c.perimeter_mm,
    label: `${c.rank}순위 · 레이어 ${c.layer || "0"}`,
    notes: c.layer_hint === "site" ? ["대지 경계 레이어 이름과 맞습니다."] : [],
    extent_mm,
    ...(info ? { unit_text: appliedUnitText(info) } : {}),
  };
}

/** 순위로 후보 고르기(없으면 null). */
export function pickCandidate(flow: DxfFlow, rank: number): SiteCandidate | null {
  if (flow.step !== "choose") return null;
  return flow.candidates.find((c) => c.rank === rank) ?? null;
}
