// area_plan 면적 집계. 값은 정수(㎡ × 100, "h100")로만 들고 다닌다 — 부동소수 누적 금지.
// 정의는 판정 엔진 측정(rules/measure.ts)과 같다: 건축면적 = 지상층 있는 매스 외곽 합집합, 층 바닥면적 = 같은 층 매스 외곽 합집합,
// 연면적 = 모든 층, 용도별 = 층 용도가 같은 매스 외곽 면적의 합. 호출자가 판정 엔진 값(area_breakdown)을 넘기면 그 값을 그대로 쓴다.
import type { DesignModelV1, Polygon } from "@arch-studio/domain";
import { area2, roundRatioHalfAway, union } from "@arch-studio/geometry";
import { DraftingError } from "../../sheet/errors.ts";

/** 판정 엔진이 계산한 면적(㎡ × 100 정수). 있으면 표는 이 값을 그대로 옮긴다. */
export interface AreaBreakdown {
  /** 건축면적. */
  building_h100: number;
  /** 연면적(지하 포함). */
  gross_h100: number;
  /** 용적률 산정 연면적. */
  far_gross_h100: number;
  floors: Array<{ level: number; area_h100: number; uses: Array<{ use: string; area_h100: number }> }>;
  /** 용도별 합(모든 층). */
  uses: Array<{ use: string; area_h100: number }>;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 2배 면적(mm², 정확한 정수) → ㎡ × 100 (half-away). 0.01㎡ = 10^4 mm², 2배 면적이라 2×10^4. */
export function h100OfArea2(a2: bigint): number {
  return roundRatioHalfAway(a2, 20_000n);
}

/** 겹칠 수 있는 외곽들의 합집합(도형용). */
export function unionOf(footprints: readonly Polygon[]): Polygon[] {
  if (footprints.length === 0) return [];
  return union(footprints);
}

function unionArea2(footprints: readonly Polygon[]): bigint {
  if (footprints.length === 0) return 0n;
  if (footprints.length === 1) return BigInt(area2(footprints[0] as Polygon));
  return union(footprints).reduce((s, p) => s + BigInt(area2(p)), 0n);
}

/** level별 매스 외곽(오름차순 level). */
export function footprintsByLevel(model: DesignModelV1): Array<{ level: number; footprints: Polygon[] }> {
  const levels = new Map<number, Polygon[]>();
  for (const m of model.masses) {
    for (const f of m.floors) levels.set(f.level, [...(levels.get(f.level) ?? []), m.footprint]);
  }
  return [...levels.keys()].sort((a, b) => a - b).map((level) => ({ level, footprints: levels.get(level) as Polygon[] }));
}

/** 판정 엔진 값이 없을 때 DesignModel에서 geometry로 집계(판정 엔진 measure와 같은 정의). */
export function deriveAreas(model: DesignModelV1): AreaBreakdown {
  const aboveFootprints = model.masses.filter((m) => m.floors.some((f) => f.level >= 1)).map((m) => m.footprint);
  const building = unionArea2(aboveFootprints);

  const floorUses = new Map<number, Map<string, bigint>>();
  const totalUse = new Map<string, bigint>();
  for (const m of model.masses) {
    const a2 = BigInt(area2(m.footprint));
    for (const f of m.floors) {
      const byUse = floorUses.get(f.level) ?? new Map<string, bigint>();
      byUse.set(f.use, (byUse.get(f.use) ?? 0n) + a2);
      floorUses.set(f.level, byUse);
      totalUse.set(f.use, (totalUse.get(f.use) ?? 0n) + a2);
    }
  }
  let gross = 0n;
  let above = 0n;
  const floors: AreaBreakdown["floors"] = [];
  for (const { level, footprints } of footprintsByLevel(model)) {
    const a2 = unionArea2(footprints);
    gross += a2;
    if (level >= 1) above += a2;
    const uses = [...(floorUses.get(level) as Map<string, bigint>).entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([use, u2]) => ({ use, area_h100: h100OfArea2(u2) }));
    floors.push({ level, area_h100: h100OfArea2(a2), uses });
  }
  return {
    building_h100: h100OfArea2(building),
    gross_h100: h100OfArea2(gross),
    far_gross_h100: h100OfArea2(above), // 지하층 제외 가정(판정 엔진 기본값)
    floors,
    uses: [...totalUse.entries()].sort(([a], [b]) => cmp(a, b)).map(([use, u2]) => ({ use, area_h100: h100OfArea2(u2) })),
  };
}

function needH100(v: number, where: string): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new DraftingError("INVALID_ARGUMENT", `${where}: 0 이상 정수(㎡×100)여야 합니다 (${v})`);
}

export function checkBreakdown(b: AreaBreakdown): void {
  needH100(b.building_h100, "area_breakdown.building_h100");
  needH100(b.gross_h100, "area_breakdown.gross_h100");
  needH100(b.far_gross_h100, "area_breakdown.far_gross_h100");
  for (const f of b.floors) {
    needH100(f.area_h100, `area_breakdown.floors[${f.level}]`);
    for (const u of f.uses) needH100(u.area_h100, `area_breakdown.floors[${f.level}].uses[${u.use}]`);
  }
  for (const u of b.uses) needH100(u.area_h100, `area_breakdown.uses[${u.use}]`);
}

/** ㎡ × 100 정수 → "12.34". */
export function formatH100(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new DraftingError("INVALID_ARGUMENT", `면적은 0 이상 정수(㎡×100)여야 합니다: ${n}`);
  const frac = n % 100;
  return `${(n - frac) / 100}.${frac < 10 ? "0" : ""}${frac}`;
}

/** ㎡ × 100 정수 → ㎡ 수(소수 둘째 자리). 나눗셈 한 번이라 모든 엔진에서 같은 값. */
export function m2OfH100(n: number): number {
  return n / 100;
}

/** 층 번호 → 표시 이름. */
export function floorName(level: number): string {
  if (level >= 1) return `${level}층`;
  if (level < 0) return `지하${-level}층`;
  return "0층";
}
