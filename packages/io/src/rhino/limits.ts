// .3dm 가져오기 자원 상한(외부 파일이므로 보안 상한이다 — 09_SECURITY_PLAN T-2, 02_ARCHITECTURE 위험 "외부 파일 파싱").
// 호출자는 options.limits로 상한을 낮출 수만 있고 올릴 수는 없다(dxf-import/limits.ts와 같은 규칙).
// rhino3dm은 동기 wasm이라 한 번 호출하면 중간에 끊을 수 없다. 메모리 상한은 "호출 뒤" 검사이고,
// 실제 차단(워커 격리·시간 상한 terminate)은 호출 쪽(앱) 책임이다.

/** 파일 크기 상한(바이트). DXF와 같은 20MB(PRD 9.5절·04_API AR055). */
export const MAX_3DM_FILE_BYTES = 20 * 1024 * 1024;
/** 파일 안 객체 수 상한(메시가 아닌 객체 포함). */
export const MAX_3DM_OBJECTS = 10_000;
/** 메시 꼭짓점 총수 상한. */
export const MAX_3DM_TOTAL_VERTICES = 2_000_000;
/** 메시 면 총수 상한(사각형 면은 1개로 센다). */
export const MAX_3DM_TOTAL_FACES = 4_000_000;
/** wasm 선형 메모리 상한(바이트). 가져오기 뒤 이보다 크면 실패로 돌리고 커널을 버리라고 알린다. */
export const MAX_WASM_MEMORY_BYTES = 512 * 1024 * 1024;
/** 압축 해제 상한: 가져오기 한 번에 늘어난 wasm 메모리 ≤ 입력 바이트 × 이 배수(06_AGENT_PLAN 제안값 10배). */
export const DECOMPRESS_RATIO = 10;
/** 위 배수 검사의 바닥값(바이트). 작은 파일도 테이블·기본 객체 할당으로 메모리 페이지가 늘 수 있어서 둔다. */
export const MIN_GROWTH_ALLOWANCE_BYTES = 64 * 1024 * 1024;
/** 객체 이름 길이 상한(초과분은 잘라서 보관한다). */
export const MAX_3DM_NAME_LENGTH = 256;

export interface Rhino3dmImportLimits {
  max_file_bytes: number;
  max_objects: number;
  max_total_vertices: number;
  max_total_faces: number;
  max_wasm_memory_bytes: number;
}

export const DEFAULT_3DM_LIMITS: Rhino3dmImportLimits = {
  max_file_bytes: MAX_3DM_FILE_BYTES,
  max_objects: MAX_3DM_OBJECTS,
  max_total_vertices: MAX_3DM_TOTAL_VERTICES,
  max_total_faces: MAX_3DM_TOTAL_FACES,
  max_wasm_memory_bytes: MAX_WASM_MEMORY_BYTES,
};

/** 호출자가 준 상한을 기본 상한 이하로 맞춘다(올릴 수 없음, 정수 아님·음수는 무시). */
export function resolve3dmLimits(over: Partial<Rhino3dmImportLimits> | undefined): Rhino3dmImportLimits {
  const out = { ...DEFAULT_3DM_LIMITS };
  if (!over) return out;
  for (const k of Object.keys(DEFAULT_3DM_LIMITS) as Array<keyof Rhino3dmImportLimits>) {
    const v = over[k];
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) out[k] = Math.min(v, DEFAULT_3DM_LIMITS[k]);
  }
  return out;
}
