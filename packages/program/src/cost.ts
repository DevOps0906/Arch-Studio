// 개략 공사비(AR-F-012): 구조·마감 등급별 단가 카탈로그 × 면적. 결정적 순수 함수, 금액은 정수(원).
// 단가 수치는 코드에 두지 않는다. 카탈로그는 GET /api/cost-catalogs/latest({ version, basis_date, items, source_note })를 입력으로 받는다.
//
// 반올림 규칙(정수 연산만):
//   행 공급가 = 단가(원/m2, 정수) × 면적(0.01 m2 정수) / 100 → 원 미만 반올림(0.5원 이상 올림)
//   공급가액 = 행 공급가의 합
//   부가세   = 공급가액 × 세율(bp) / 10000 → 원 미만 반올림(0.5원 이상 올림). 행별이 아니라 공급가액에 한 번만 적용
//   합계     = 공급가액 + 부가세
import { m2ToHundredths, type ProgramTarget } from "./program.ts";

/** 부가가치세 기본 세율 10%(부가가치세법 제30조), 베이시스 포인트(1bp = 0.01%). */
export const KR_VAT_RATE_BP = 1000;

export interface CostCatalogItem {
  structure: string;
  finish_grade: string;
  /** 없으면 같은 구조·등급의 기본 단가. 있으면 그 용도 행에만 우선 적용. */
  use?: string;
  unit_price_won_per_m2: number;
}

export interface CostCatalog {
  version: string;
  /** 단가 기준일 YYYY-MM-DD. */
  basis_date: string;
  /** 단가 출처. */
  source_note: string;
  items: CostCatalogItem[];
}

export interface EstimateCostInput {
  catalog: CostCatalog;
  structure: string;
  finish_grade: string;
  rows: ProgramTarget[];
  /** 기본 KR_VAT_RATE_BP. */
  vat_rate_bp?: number;
}

export interface CostLine {
  name: string;
  use: string;
  area_m2_hundredths: number;
  unit_price_won_per_m2: number;
  supply_won: number;
}

export interface CostEstimate {
  structure: string;
  finish_grade: string;
  lines: CostLine[];
  /** 단가를 찾지 못한 행 이름(공급가액에서 제외). */
  unpriced_rows: string[];
  supply_won: number;
  vat_rate_bp: number;
  vat_won: number;
  total_won: number;
  catalog_version: string;
  basis_date: string;
  source_note: string;
}

const BP_DENOMINATOR = 10_000;

function assertSafeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label}는 0 이상의 안전한 정수여야 합니다: ${value}`);
}

/** 0 이상 안전 정수 a·b·d에 대해 round(a × b / d), 0.5 이상 올림. 중간값은 BigInt로 계산해 2^53 초과 오차를 막는다. */
function mulDivRoundHalfUp(a: number, b: number, d: number, label: string): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  const q = num / den;
  const result = (num % den) * 2n >= den ? q + 1n : q;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label}가 안전한 정수 범위를 넘습니다`);
  return Number(result);
}

function findUnitPrice(catalog: CostCatalog, structure: string, grade: string, use: string): number | undefined {
  let fallback: number | undefined;
  for (const item of catalog.items) {
    if (item.structure !== structure || item.finish_grade !== grade) continue;
    if (item.use === use) return item.unit_price_won_per_m2;
    if (item.use === undefined && fallback === undefined) fallback = item.unit_price_won_per_m2;
  }
  return fallback;
}

/** 면적표 행과 단가 카탈로그로 개략 공사비를 계산한다. 결과에 카탈로그 버전·기준일·출처를 싣는다. */
export function estimateCost(input: EstimateCostInput): CostEstimate {
  const { catalog } = input;
  const vatRateBp = input.vat_rate_bp ?? KR_VAT_RATE_BP;
  assertSafeInt(vatRateBp, "부가세율(bp)");
  for (const item of catalog.items) assertSafeInt(item.unit_price_won_per_m2, "단가(원/m2)");

  const lines: CostLine[] = [];
  const unpriced: string[] = [];
  let supply = 0;
  for (const row of input.rows) {
    const unitPrice = findUnitPrice(catalog, input.structure, input.finish_grade, row.use);
    if (unitPrice === undefined) {
      unpriced.push(row.name);
      continue;
    }
    const area = m2ToHundredths(row.target_area_m2);
    const lineSupply = mulDivRoundHalfUp(unitPrice, area, 100, "행 공급가");
    lines.push({
      name: row.name,
      use: row.use,
      area_m2_hundredths: area,
      unit_price_won_per_m2: unitPrice,
      supply_won: lineSupply,
    });
    supply += lineSupply;
    assertSafeInt(supply, "공급가액");
  }
  const vat = mulDivRoundHalfUp(supply, vatRateBp, BP_DENOMINATOR, "부가세");
  const total = supply + vat;
  assertSafeInt(total, "합계");

  return {
    structure: input.structure,
    finish_grade: input.finish_grade,
    lines,
    unpriced_rows: unpriced,
    supply_won: supply,
    vat_rate_bp: vatRateBp,
    vat_won: vat,
    total_won: total,
    catalog_version: catalog.version,
    basis_date: catalog.basis_date,
    source_note: catalog.source_note,
  };
}
