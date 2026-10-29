// sunlight_section 입력 타입. drafting은 @arch-studio/rules를 의존하지 않으므로(package.json), 엔벨로프 출력(rules의 EnvelopeOutput)에서
// 이 뷰가 읽는 필드만 구조적 타입으로 둔다. EnvelopeOutput은 이 타입에 그대로 대입된다(필드 이름·모양 동일, 읽기 전용으로 받음).

/** rules의 SunlightBand와 같은 모양: 높이 z가 (앞 구간 up_to_mm, up_to_mm]이면 정북 거리 ≥ max(min_distance_mm, z × num / den). */
export interface SunlightBandInput {
  /** 구간 상한(포함). null = 그 위 전부(마지막 구간). */
  up_to_mm: number | null;
  min_distance_mm?: number;
  distance_ratio?: { num: number; den: number };
}

export interface SunlightBasisInput {
  law: string;
  article: string;
  effective_from: string;
  ordinance: boolean;
}

/** EnvelopeConstraint 중 이 뷰가 읽는 필드. applied_params는 제약마다 모양이 달라 unknown으로 받고 여기서 검사한다. */
export interface SunlightConstraintInput {
  key: string;
  edge_class?: string;
  status: string;
  applied: boolean;
  rule_ids: ReadonlyArray<string>;
  basis: ReadonlyArray<SunlightBasisInput>;
  reasons: ReadonlyArray<string>;
  applied_params?: unknown;
}

/** EnvelopeOutput 중 이 뷰가 읽는 필드. */
export interface SunlightEnvelopeInput {
  rule_pack_version: string;
  /** 신청 예정일(YYYY-MM-DD). 신·구 기준은 이 날짜로 규칙 팩이 이미 골랐다. */
  application_date: string;
  /** 볼륨 상한 높이(mm). 사선을 이 높이까지 그린다. */
  top_mm: number;
  constraints: ReadonlyArray<SunlightConstraintInput>;
}

export interface SunlightSectionOptions {
  /**
   * 적용된 기준이 시행일 전후 어느 쪽인지(규칙 팩이 신청일로 고른 결과를 호출자가 넘긴다). 엔벨로프 출력에는 신·구 표시가 없어
   * 호출자가 모를 때는 생략하고, 라벨에는 조문·시행일·신청일만 나온다.
   */
  standard?: "new" | "old";
}
