// 판정 엔진 입력 거부 사유. 화면은 code로 분기한다(메시지는 사람용).

export type RulesErrorCode =
  | "INVALID_PACK" // 규칙 팩 형식·불변식 위반(근거 누락, 미확인 규칙에 수치 등)
  | "INVALID_INPUT" // DesignModel·신청 예정일·도로 변 번호 오류
  | "NO_PACK"; // 고를 규칙 팩이 없음

export class RulesError extends Error {
  readonly code: RulesErrorCode;

  constructor(code: RulesErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "RulesError";
    this.code = code;
  }
}
