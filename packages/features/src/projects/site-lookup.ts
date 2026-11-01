// 새 프로젝트 창 대지 조회(03장 3.3절 "새 프로젝트 창" 행): 조회 후보(site/model.ts candidateFromLookup) → 창에 보일 요약(순수 함수).
// 가로·세로는 경계의 최소 면적 회전 직사각형 두 변(@arch-studio/geometry minAreaRect, mm 정수). 좌표는 조회 결과만 쓴다(추정·LLM 없음).
import { formatAreaM2, type Point } from "@arch-studio/domain";
import { minAreaRect } from "@arch-studio/geometry";
import type { SiteCandidateView } from "../site/model.ts";
import { USE_DISTRICTS, type UseDistrict } from "./new-project.ts";

/** 프로젝트 생성에 쓰는 조회 대지(경계는 정규화된 로컬 mm, 외곽 반시계). */
export interface LookupSite {
  readonly outer: readonly Point[];
  readonly pnu: string | null;
  readonly addressLabel: string | null;
  readonly districts: readonly string[];
}

export interface LookupSummary {
  readonly site: LookupSite;
  /** domain formatAreaM2 결과(㎡ 붙이기 전). */
  readonly areaText: string;
  readonly widthMm: number;
  readonly depthMm: number;
  /** 회전 직사각형 네 꼭짓점(표시용, 반시계). */
  readonly rect: readonly [Point, Point, Point, Point];
  /** 조회 용도지역 원문(지적도 기준, 입력 후보). 없으면 null. */
  readonly useDistrictText: string | null;
  /** 21종 목록에 있는 값이면 그 값(폼 기본값으로 쓴다), 아니면 null. */
  readonly useDistrict: UseDistrict | null;
  readonly notice: string;
  readonly notes: readonly string[];
}

export function summarizeLookup(c: SiteCandidateView, notice: string): LookupSummary {
  const r = minAreaRect({ outer: c.outer.map((p) => [p[0], p[1]] as Point) });
  const text = c.use_district ?? null;
  const known = text !== null && (USE_DISTRICTS as readonly string[]).includes(text) ? (text as UseDistrict) : null;
  return {
    site: { outer: c.outer, pnu: c.parcel?.pnu ?? null, addressLabel: c.parcel?.address_label ?? null, districts: c.districts ?? [] },
    areaText: formatAreaM2(c.area_mm2),
    widthMm: r.widthMm,
    depthMm: r.depthMm,
    rect: r.corners,
    useDistrictText: text,
    useDistrict: known,
    notice,
    notes: c.notes,
  };
}


/** 조회가 폼에 채운 값(""은 채우지 않음). 사용자가 그 뒤 고친 값과 구분하려고 기억한다. */
export interface LookupFill {
  readonly siteLabel: string;
  readonly useDistrict: string;
}

export const NO_FILL: LookupFill = Object.freeze({ siteLabel: "", useDistrict: "" });

/**
 * 조회 결과를 폼에 반영(새 결과·실패·결과 지우기 공통, summary=null이면 되돌리기만).
 * ① 이전 조회가 채운 값이 그대로면 비운다(사용자가 고친 값은 둔다) ② 새 결과가 있으면 빈 칸에만 채운다:
 * 대지 이름 = 주소 라벨, 용도지역 = 21종 목록 안의 값(목록 밖·없음이면 빈 값 → 사용자가 직접 고른다).
 */
export function applyLookupFill<F extends { readonly siteLabel: string; readonly useDistrict: string }>(form: F, prev: LookupFill, summary: LookupSummary | null): { form: F; fill: LookupFill } {
  let siteLabel = prev.siteLabel !== "" && form.siteLabel === prev.siteLabel ? "" : form.siteLabel;
  let useDistrict = prev.useDistrict !== "" && form.useDistrict === prev.useDistrict ? "" : form.useDistrict;
  const fill = { siteLabel: "", useDistrict: "" };
  if (summary) {
    if (siteLabel.trim() === "" && summary.site.addressLabel) siteLabel = fill.siteLabel = summary.site.addressLabel;
    if (useDistrict === "" && summary.useDistrict) useDistrict = fill.useDistrict = summary.useDistrict;
  }
  return { form: { ...form, siteLabel, useDistrict }, fill };
}
