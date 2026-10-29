// 솔리드 래퍼 전용 오류. geometry errors.ts의 코드 목록(범위 밖)을 늘리지 않고 따로 둔다.
export type SolidErrorCode = "SOLID_DEGENERATE"; // 정수화 뒤 메시가 닫히지 않음(변마다 정확히 두 면 공유가 깨짐)

export class SolidError extends Error {
  readonly code: SolidErrorCode;

  constructor(code: SolidErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SolidError";
    this.code = code;
  }
}
