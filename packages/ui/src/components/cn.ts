/** 조건부 클래스 이어 붙이기(외부 의존성 없이). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** mm 정수 표기: 천 단위 쉼표. 로캘에 의존하지 않아 서버·브라우저 결과가 같다. */
export function formatInt(value: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.round(Math.abs(value)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
