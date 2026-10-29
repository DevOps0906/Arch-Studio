// DXF 가져오기 오류. 공개 API는 예외 대신 { ok:false, error } 구조화 결과를 돌려준다(importDxf가 잡아서 변환).

export type DxfImportErrorCode =
  | "AR055" // 파일 크기 초과(04_API 7.3, 20MB)
  | "DXF_BINARY" // 바이너리 DXF(지원하지 않음 — ASCII DXF로 저장해 달라고 안내)
  | "DXF_MALFORMED" // 헤더·그룹 코드·값 형식 오류(DXF가 아니거나 손상)
  | "DXF_TRUNCATED" // 파일이 중간에 끊김(EOF 표지 없음)
  | "DXF_EMPTY" // 읽을 수 있는 도면 요소(선·폴리라인·호·원)가 하나도 없음
  | "DXF_TOO_MANY_ENTITIES" // 엔티티 수 또는 펼친 뒤 수·꼭짓점 수 상한 초과
  | "DXF_NESTING_TOO_DEEP" // INSERT 중첩 깊이 상한(8) 초과
  | "DXF_CIRCULAR_BLOCK" // 블록이 자기 자신을 (간접 포함) 참조
  | "DXF_COORD_OUT_OF_RANGE" // 좌표가 ±10km(geometry COORD_LIMIT)를 넘거나 유한하지 않음
  | "DXF_INVALID_OPTION" // 호출 인자 오류(알 수 없는 단위 등)
  | "DXF_INTERNAL"; // 예상 못 한 내부 오류(발생하면 버그 — 퍼징 테스트가 0건을 확인한다)

export interface DxfImportError {
  code: DxfImportErrorCode;
  /** 사람용 한국어 설명(좌표·파일 경로 없음 — 오류 보고에 그대로 실려도 안전). */
  message: string;
  /** 오류 위치의 줄 번호(1부터). 파싱 단계 오류만. */
  line?: number;
  /** 상한 오류일 때 상한 값. */
  limit?: number;
}

/** 내부 전파용. 공개 경계(importDxf)에서 DxfImportError로 바뀐다. */
export class DxfFail extends Error {
  readonly info: DxfImportError;
  constructor(code: DxfImportErrorCode, message: string, extra: { line?: number; limit?: number } = {}) {
    super(`[${code}] ${message}`);
    this.name = "DxfFail";
    this.info = { code, message, ...extra };
  }
}
