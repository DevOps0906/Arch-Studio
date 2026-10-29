// 지오메트리 입력 거부 사유. 화면·판정은 code로 분기한다(메시지는 사람용).

export type GeometryErrorCode =
  | "INVALID_COORDINATE" // 정수가 아님(소수·NaN·Infinity)
  | "OUT_OF_RANGE" // |x|,|y| > 10,000,000mm (결과 좌표 포함)
  | "TOO_FEW_POINTS" // 고리 꼭짓점 3개 미만
  | "DUPLICATE_POINT" // 이웃 꼭짓점이 같음(길이 0 변, 닫는 점 중복 포함)
  | "ZERO_AREA" // 고리 면적 0
  | "SELF_INTERSECTION" // 고리 자기교차·접촉, 고리끼리 교차·겹침
  | "HOLE_OUTSIDE" // 구멍이 외곽 밖이거나 다른 구멍 안
  | "INVALID_ARGUMENT" // 오프셋 거리·옵션 등 인자 오류
  | "NUMERIC_FAILURE"; // 정수 스냅이 수렴하지 않음(발생하면 버그로 보고)

export class GeometryError extends Error {
  readonly code: GeometryErrorCode;

  constructor(code: GeometryErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "GeometryError";
    this.code = code;
  }
}
