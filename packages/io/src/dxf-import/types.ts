// DXF 가져오기 공개 타입. 이 패키지는 DesignModel을 만들거나 고치지 않는다 — 결과는 "후보"일 뿐이고
// 사용자가 확정한 뒤에야 호출자(features/site)가 DesignModel.site에 반영한다(PRD 9장, 06_AGENT_PLAN AR-06-029).
import type { Polygon } from "@arch-studio/domain";
import type { DxfImportError } from "./errors.ts";
import type { DxfImportLimits } from "./limits.ts";

/** 변환 가능한 도면 단위. 04_API의 'mm'|'m'에 cm·in·ft를 더했다($INSUNITS가 선언한 경우 대응). */
export type DxfUnit = "mm" | "cm" | "m" | "in" | "ft";

/** 단위 → mm 배율. */
export const UNIT_TO_MM: Readonly<Record<DxfUnit, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export interface DxfImportOptions {
  /** 사용자가 고른 단위. 주면 판별을 건너뛰고 이 단위로 mm 환산한다(AR053 답변). */
  unit?: DxfUnit;
  /** 후보 최대 개수(기본 10, 최대 50). */
  max_candidates?: number;
  /** 끝점 이음 허용 오차(mm 정수, 0 또는 1, 기본 1). 선분 연결 루프 추출에만 쓴다. */
  join_tolerance_mm?: 0 | 1;
  /** 자원 상한을 더 낮추기(올릴 수 없음). */
  limits?: Partial<DxfImportLimits>;
}

/** 후보 폴리곤의 대지 경계 가능성 힌트(레이어 이름 기준). */
export type LayerHint = "site" | "neutral" | "non_site";

export interface SiteCandidate {
  /** 순위(1부터). 1순위가 가장 대지 경계답다 — 레이어 힌트(site > neutral > non_site) 다음 면적 큰 순. */
  rank: number;
  /** 외곽 반시계, 구멍 없음, mm 정수. 시작점은 (x, y) 사전순 최소 꼭짓점. */
  polygon: Polygon;
  /** 면적(mm², geometry area()의 half-away 정수). */
  area_mm2: number;
  /** 둘레(mm, 변 길이 합의 half-away 정수). */
  perimeter_mm: number;
  vertex_count: number;
  /** 대표 레이어(구성 요소 수가 가장 많은 레이어, 동률은 이름순). */
  layer: string;
  /** 구성 요소가 놓인 모든 레이어(정렬). */
  layers: string[];
  layer_hint: LayerHint;
  /** 출처: 닫힌 폴리라인 / 원 / 선분·호를 이어 만든 루프. */
  source: "closed_polyline" | "circle" | "connected_lines";
}

export interface UnitOption {
  unit: DxfUnit;
  /** 이 단위라면 기준 도형의 가장 긴 변이 대지로 그럴듯한가(3m~1km). */
  plausible: boolean;
  /** 이 단위일 때 기준 도형의 가장 긴 변(mm 정수, 근거 표시용). */
  reference_extent_mm: number;
  /** 이 단위로 환산해도 모든 좌표가 ±10km 안인가. */
  fits_coord_limit: boolean;
}

export interface UnitInfo {
  unit: DxfUnit;
  /** caller: 호출자가 지정 / insunits: 헤더 $INSUNITS 선언 / range_heuristic: 좌표 범위로 추정. */
  source: "caller" | "insunits" | "range_heuristic";
  /** true면 화면이 단위 확인 대화상자를 반드시 보여야 한다(추정이므로). */
  needs_confirmation: boolean;
  /** 헤더 $INSUNITS 값(없으면 null). */
  declared_insunits: number | null;
  /** 호출자 지정 단위가 헤더 선언과 다르면 true. */
  declared_mismatch: boolean;
}

/** AR054: 지원하지 않아 무시한 엔티티 요약. */
export interface DxfWarning {
  code: "AR054";
  detail: string;
  /** 종류 → 개수(종류 이름 사전순). */
  skipped_entities: Record<string, number>;
}

export interface DxfImportStats {
  file_bytes: number;
  /** 파싱한 엔티티 수(ENTITIES + BLOCKS 정의). */
  entities_parsed: number;
  /** 블록 펼침 뒤 방문한 엔티티 수. */
  entities_expanded: number;
  /** 펼친 뒤 선·폴리라인 조각(체인) 수. */
  chains: number;
  vertices: number;
  closed_chains: number;
  open_chains: number;
  /** 배치 공간(paper space) 엔티티 수 — 무시. */
  paper_space_entities: number;
  /** 꺼짐·동결 레이어 엔티티 수 — 무시. */
  hidden_layer_entities: number;
  /** TEXT·MTEXT 등 의도적으로 무시한 주석 수(경고 아님). */
  ignored_annotations: number;
  /** 폭이 작아(1㎡ 미만) 후보에서 뺀 닫힌 도형 수. */
  loops_below_min_area: number;
  /** 자기교차·퇴화·꼭짓점 과다로 후보가 될 수 없는 도형 수. */
  loops_rejected: number;
  /** 검증 작업량 상한 때문에 검사하지 못한 도형 수. */
  loops_unchecked: number;
  /** 같은 모양이 중복돼 합친 수. */
  duplicates_removed: number;
}

export type DxfImportResult =
  | {
      ok: true;
      status: "ok";
      unit: UnitInfo;
      candidates: SiteCandidate[];
      warnings: DxfWarning[];
      stats: DxfImportStats;
    }
  | {
      ok: true;
      /** 단위 판별 실패·모호: 후보를 만들지 않는다. options.unit을 정해 다시 호출한다. */
      status: "needs_unit";
      code: "AR053";
      reason: string;
      declared_insunits: number | null;
      options: UnitOption[];
      warnings: DxfWarning[];
      stats: DxfImportStats;
    }
  | { ok: false; error: DxfImportError };
