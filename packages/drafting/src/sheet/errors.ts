// 도면 엔진 불변식 위반(호출자·뷰 생성기 버그). 사용자 안내 코드(AR050 등)는 결과 값으로 돌려주고 예외로 쓰지 않는다.
export type DraftingErrorCode =
  | "INVALID_ARGUMENT" // 형식이 계약과 다름(정수 아님, 빈 키 등)
  | "DUPLICATE_KEY" // 같은 컨테이너 안 key·anno_id 중복(결정적 정렬 불가)
  | "NUMERIC_TEXT_SOURCE" // 수치 TEXT에 source_ref 없음
  | "DISCLAIMER_MISSING"; // 표제란 고정 고지 없음

export class DraftingError extends Error {
  readonly code: DraftingErrorCode;
  constructor(code: DraftingErrorCode, message: string) {
    super(message);
    this.name = "DraftingError";
    this.code = code;
  }
}
