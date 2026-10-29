// DXF 가져오기 자원 상한(외부 파일이므로 보안 상한이다 — 09_SECURITY_PLAN T-2, 02_ARCHITECTURE 위험 "외부 파일 파싱").
// 호출자는 options.limits로 상한을 낮출 수만 있고 올릴 수는 없다.

/** 파일 크기 상한(바이트). ADR-001·PRD 9.5절 값(20MB). Rust fs.rs가 먼저 검사하고 여기서 한 번 더 막는다. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 파싱한 엔티티 수 상한(ENTITIES + BLOCKS 정의, VERTEX·SEQEND 제외). */
export const MAX_ENTITIES = 500_000;
/** 블록 펼침 뒤 방문하는 엔티티 수 상한(INSERT 중첩·배열로 인한 폭증 방지). */
export const MAX_EXPANDED_ENTITIES = 1_000_000;
/** INSERT 중첩 깊이 상한(제안값 8). 최상위 INSERT가 1단계, 그 블록 안의 INSERT가 2단계. */
export const MAX_INSERT_DEPTH = 8;
/** MINSERT(배열 INSERT) 한 개가 만드는 복제 수 상한. */
export const MAX_INSERT_ARRAY = 10_000;
/** 펼친 뒤 꼭짓점 총수 상한(호 근사 점 포함). 좌표 보관 메모리를 막는다. */
export const MAX_TOTAL_VERTICES = 4_000_000;
/** 후보 하나의 꼭짓점 수 상한(자기교차 검사가 O(n²)이므로). */
export const MAX_CANDIDATE_VERTICES = 2_000;
/** 후보 검증(자기교차 검사) 총 작업량 상한: Σ 꼭짓점². 넘으면 남은 후보는 검증하지 않고 통계로 남긴다. */
export const MAX_VALIDATION_WORK = 40_000_000;
/** 후보로 인정하는 최소 면적(mm²) = 1㎡. 문·창 틀, 치수 화살표 같은 작은 닫힌 도형을 거른다. */
export const MIN_CANDIDATE_AREA_MM2 = 1_000_000;
/** 기본 후보 최대 개수. */
export const DEFAULT_MAX_CANDIDATES = 10;
/** 후보 최대 개수의 상한. */
export const HARD_MAX_CANDIDATES = 50;
/** 레이어·블록 이름 길이 상한(초과분은 잘라서 보관한다). */
export const MAX_NAME_LENGTH = 256;
/** 미지원 엔티티 요약에 적는 서로 다른 종류의 최대 수(초과분은 "기타"). */
export const MAX_SKIP_KINDS = 64;

/** 단위 휴리스틱의 대지 최대 변 현실 범위(mm): 3m ~ 1km. 이 밖이면 그 단위는 "그럴듯하지 않다". */
export const PLAUSIBLE_EXTENT_MIN_MM = 3_000;
export const PLAUSIBLE_EXTENT_MAX_MM = 1_000_000;

/** 호·원 근사의 최대 각 간격(도). 현 오차 ≈ 반지름 × 0.015%. */
export const ARC_STEP_DEG = 2;
/** 불룩(bulge) 호를 더 쪼개지 않는 기준: tan(ARC_STEP_DEG/4 도) 이하. */
export const BULGE_FLAT = 0.00873;
/** 불룩 호 재귀 이등분 최대 깊이. */
export const BULGE_MAX_DEPTH = 10;

export interface DxfImportLimits {
  max_file_bytes: number;
  max_entities: number;
  max_expanded_entities: number;
  max_insert_depth: number;
  max_total_vertices: number;
}

export const DEFAULT_LIMITS: DxfImportLimits = {
  max_file_bytes: MAX_FILE_BYTES,
  max_entities: MAX_ENTITIES,
  max_expanded_entities: MAX_EXPANDED_ENTITIES,
  max_insert_depth: MAX_INSERT_DEPTH,
  max_total_vertices: MAX_TOTAL_VERTICES,
};

/** 호출자가 준 상한을 기본 상한 이하로 맞춘다(올릴 수 없음, 정수 아님·음수는 무시). */
export function resolveLimits(over: Partial<DxfImportLimits> | undefined): DxfImportLimits {
  const out = { ...DEFAULT_LIMITS };
  if (!over) return out;
  for (const k of Object.keys(DEFAULT_LIMITS) as Array<keyof DxfImportLimits>) {
    const v = over[k];
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) out[k] = Math.min(v, DEFAULT_LIMITS[k]);
  }
  return out;
}
