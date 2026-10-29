// 단위 판별. 조용한 추정 금지(PRD 3절 :379, 1000배 오류 방지): 선언(헤더 $INSUNITS)이 그럴듯하면 쓰고,
// 선언이 없거나 도형 크기와 모순이거나 범위로도 하나로 좁혀지지 않으면 AR053으로 사용자에게 묻는다.
// 범위 추정은 mm·m 두 가지만 자동 후보로 삼고(두 범위가 겹치지 않는다), 추정으로 정한 경우 needs_confirmation=true를 돌려준다.
import { COORD_LIMIT } from "@arch-studio/geometry";
import { DxfFail } from "./errors.ts";
import { PLAUSIBLE_EXTENT_MAX_MM, PLAUSIBLE_EXTENT_MIN_MM } from "./limits.ts";
import type { FlatResult } from "./flatten.ts";
import { layerHint } from "./layers.ts";
import { UNIT_TO_MM, type DxfUnit, type UnitInfo, type UnitOption } from "./types.ts";

/** $INSUNITS → 지원 단위(1 인치, 2 피트, 4 mm, 5 cm, 6 m). 0·그 밖(km·마일 등)은 null. */
export function declaredUnit(insunits: number | null): DxfUnit | null {
  switch (insunits) {
    case 1:
      return "in";
    case 2:
      return "ft";
    case 4:
      return "mm";
    case 5:
      return "cm";
    case 6:
      return "m";
    default:
      return null;
  }
}

export type UnitDecision =
  | { kind: "resolved"; info: UnitInfo }
  | { kind: "ask"; reason: string; options: UnitOption[] };

interface Extent {
  /** 대지가 아닌 레이어(표제란·치수 등)를 뺀 도형 전체의 가장 긴 변(도면 단위). */
  reference: number;
  /** 모든 좌표의 최대 절댓값(도면 단위). */
  maxAbs: number;
}

function measure(flat: FlatResult): Extent {
  const nonSite = flat.layerNames.map((n) => layerHint(n) === "non_site");
  const bbox = (skipNonSite: boolean): [number, number, number, number, boolean] => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let any = false;
    for (let c = 0; c < flat.start.length; c++) {
      if (skipNonSite && nonSite[flat.layer[c] as number]) continue;
      const s = flat.start[c] as number;
      const e = s + (flat.len[c] as number);
      for (let i = s; i < e; i++) {
        const x = flat.xs[i] as number;
        const y = flat.ys[i] as number;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      any = true;
    }
    return [x0, y0, x1, y1, any];
  };
  let [x0, y0, x1, y1, any] = bbox(true);
  if (!any) [x0, y0, x1, y1, any] = bbox(false);
  const [ax0, ay0, ax1, ay1] = bbox(false);
  const maxAbs = Math.max(Math.abs(ax0), Math.abs(ay0), Math.abs(ax1), Math.abs(ay1));
  return { reference: Math.max(x1 - x0, y1 - y0), maxAbs };
}

/** 정수 mm로 표시할 근거 값. 유한하지 않거나 안전 정수를 넘으면 상한값으로 자른다. */
function toMmInt(v: number): number {
  if (!Number.isFinite(v)) return Number.MAX_SAFE_INTEGER;
  return Math.min(Math.round(v), Number.MAX_SAFE_INTEGER);
}

export function decideUnit(
  flat: FlatResult,
  insunits: number | null,
  measurement: number | null,
  chosen: DxfUnit | undefined,
): UnitDecision {
  const ext = measure(flat);
  const declared = declaredUnit(insunits);
  const units: DxfUnit[] = ["mm", "cm", "m"];
  if (declared === "in" || declared === "ft" || chosen === "in" || chosen === "ft" || measurement === 0) units.push("in", "ft");
  const options: UnitOption[] = units.map((unit) => {
    const f = UNIT_TO_MM[unit];
    const size = ext.reference * f;
    return {
      unit,
      plausible: size >= PLAUSIBLE_EXTENT_MIN_MM && size <= PLAUSIBLE_EXTENT_MAX_MM,
      reference_extent_mm: toMmInt(size),
      fits_coord_limit: Number.isFinite(ext.maxAbs * f) && ext.maxAbs * f <= COORD_LIMIT,
    };
  });
  if (!options.some((o) => o.fits_coord_limit)) {
    throw new DxfFail("DXF_COORD_OUT_OF_RANGE", `어떤 단위로 읽어도 좌표가 ±${COORD_LIMIT}mm 범위를 넘습니다`, { limit: COORD_LIMIT });
  }
  const mk = (unit: DxfUnit, source: UnitInfo["source"], confirm: boolean): UnitDecision => ({
    kind: "resolved",
    info: {
      unit,
      source,
      needs_confirmation: confirm,
      declared_insunits: insunits,
      declared_mismatch: declared !== null && declared !== unit,
    },
  });
  if (chosen !== undefined) return mk(chosen, "caller", false);
  if (declared !== null) {
    const o = options.find((x) => x.unit === declared) as UnitOption;
    if (o.plausible && o.fits_coord_limit) return mk(declared, "insunits", false);
    return { kind: "ask", reason: `헤더 단위(${declared})로 읽으면 도형 크기가 대지로 보기 어렵습니다(3m~1km 밖). 단위를 확인해 주세요`, options };
  }
  const auto = options.filter((o) => (o.unit === "mm" || o.unit === "m") && o.plausible && o.fits_coord_limit);
  if (auto.length === 1) return mk((auto[0] as UnitOption).unit, "range_heuristic", true);
  const why = insunits === 0 ? "헤더에 단위가 없고" : insunits === null ? "헤더에 단위 정보가 없고" : "헤더 단위를 지원하지 않고";
  return { kind: "ask", reason: `${why} 좌표 범위만으로 mm와 m를 가를 수 없습니다. 단위를 선택해 주세요`, options };
}
