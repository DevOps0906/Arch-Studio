// .3dm 가져오기 오류. 공개 API는 예외 대신 { ok:false, error } 구조화 결과를 돌려준다(import3dm이 잡아서 변환).

export type Rhino3dmImportErrorCode =
  | "AR055" // 파일 크기 초과(04_API 7.3, 20MB)
  | "R3DM_MALFORMED" // .3dm이 아니거나 손상(rhino3dm이 읽지 못함)
  | "R3DM_EMPTY" // 메시 객체가 하나도 없음(Brep·곡선 등만 있음 — Rhino에서 메시로 바꿔 저장하라고 안내)
  | "R3DM_TOO_MANY_OBJECTS" // 객체 수 상한 초과
  | "R3DM_TOO_MANY_VERTICES" // 꼭짓점 총수 상한 초과
  | "R3DM_TOO_MANY_FACES" // 면 총수 상한 초과
  | "R3DM_MEMORY_LIMIT" // wasm 메모리 상한 초과(커널을 버려야 함)
  | "R3DM_DECOMPRESSION_LIMIT" // 가져오기 중 늘어난 메모리가 입력의 10배 초과(압축 폭탄 의심, 커널을 버려야 함)
  | "R3DM_WASM_TRAP" // wasm 실행 중단(트랩·abort) — 커널 상태를 믿을 수 없으니 버려야 함
  | "R3DM_COORD_OUT_OF_RANGE" // mm 환산 좌표가 ±10km(geometry COORD_LIMIT)를 넘거나 유한하지 않음
  | "R3DM_INVALID_OPTION" // 호출 인자 오류(알 수 없는 단위 등)
  | "R3DM_INTERNAL"; // 예상 못 한 내부 오류(발생하면 버그 — 퍼징 테스트가 0건을 확인한다)

export interface Rhino3dmImportError {
  code: Rhino3dmImportErrorCode;
  /** 사람용 한국어 설명(좌표·파일 경로 없음 — 오류 보고에 그대로 실려도 안전). */
  message: string;
  /** 상한 오류일 때 상한 값. */
  limit?: number;
  /** true면 이 커널(wasm 인스턴스)을 버리고 새로 load3dmKernel 해야 한다(메모리가 줄지 않거나 상태가 깨짐). */
  discard_kernel?: boolean;
}

/** 내부 전파용. 공개 경계(import3dm)에서 Rhino3dmImportError로 바뀐다. */
export class Rhino3dmFail extends Error {
  readonly info: Rhino3dmImportError;
  constructor(code: Rhino3dmImportErrorCode, message: string, extra: { limit?: number; discard_kernel?: boolean } = {}) {
    super(`[${code}] ${message}`);
    this.name = "Rhino3dmFail";
    this.info = { code, message, ...extra };
  }
}
