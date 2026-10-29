// DXF 대지 가져오기 상태기계(03장 2.4절, 5.3절 AR053~AR055, tasks/logs/AR-06-029.md 결과 형식).
// 조용한 추정 금지: 단위가 모호하면(`needs_unit`) 또는 범위 추정이면(`unit.needs_confirmation`) 반드시 단위 대화상자 단계를 거친다.
// 후보 선택 단계("choose")로는 단위가 확정된 결과(선언 일치·사용자 선택·사용자 확인)에서만 간다. 순수 함수(node --test 대상).
import type { DxfImportResult, DxfUnit, SiteCandidate, UnitOption } from "@arch-studio/io";
import type { Point } from "@arch-studio/domain";
import { formatMm, type SiteCandidateView } from "./model.ts";

export const UNIT_LABEL: Readonly<Record<DxfUnit, string>> = { mm: "mm", cm: "cm", m: "m", in: "inch", ft: "ft" };

/** 5.3절 문구. */
export const DXF_TEXT = {
  AR053: "도면 단위를 판별하지 못했습니다. 이 도면의 단위를 골라 주세요.",
  confirm: (unit: DxfUnit) => `좌표 범위로 보아 도면 단위를 ${UNIT_LABEL[unit]}로 추정했습니다. 맞는지 확인해 주세요.`,
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
  | { readonly step: "confirm_unit"; readonly message: string; readonly unit: DxfUnit; readonly pending: Extract<DxfImportResult, { status: "ok" }> }
  | { readonly step: "choose"; readonly unit: DxfUnit; readonly candidates: readonly SiteCandidate[]; readonly warning: string | null }
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
  if (result.unit.needs_confirmation && !userChoseUnit) {
    return { step: "confirm_unit", message: DXF_TEXT.confirm(result.unit.unit), unit: result.unit.unit, pending: result };
  }
  if (result.candidates.length === 0) return { step: "error", message: DXF_TEXT.noClosed };
  return { step: "choose", unit: result.unit.unit, candidates: result.candidates, warning: warningOf(result) };
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

/** 단위 대화상자에서 고를 수 있는 단위. confirm 단계는 mm·m(03장 2.4 "[mm] [m]") + 추정 단위. */
export function unitChoices(flow: DxfFlow): DxfUnit[] {
  if (flow.step === "ask_unit") return flow.options.map((o) => o.unit);
  if (flow.step === "confirm_unit") return [...new Set<DxfUnit>([flow.unit, "mm", "m"])];
  return [];
}

/** io 후보 → 화면 후보(같은 모양). */
export function candidateFromDxf(c: SiteCandidate): SiteCandidateView {
  return {
    origin: "dxf",
    outer: c.polygon.outer.map((p) => [p[0], p[1]] as Point),
    area_mm2: c.area_mm2,
    perimeter_mm: c.perimeter_mm,
    label: `${c.rank}순위 · 레이어 ${c.layer || "0"}`,
    notes: c.layer_hint === "site" ? ["대지 경계 레이어 이름과 맞습니다."] : [],
  };
}

/** 순위로 후보 고르기(없으면 null). */
export function pickCandidate(flow: DxfFlow, rank: number): SiteCandidate | null {
  if (flow.step !== "choose") return null;
  return flow.candidates.find((c) => c.rank === rank) ?? null;
}
