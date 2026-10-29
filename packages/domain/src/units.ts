// 단위 계약 (04_API.md 4.7.1): 좌표·길이는 mm 정수, 면적 표시는 m2 소수 둘째 자리. 순수 함수만.
import { z } from "zod";

/** 모델 길이 단위. 항상 정수 mm. */
export type Mm = number;

/** mm 정수 스키마. 소수·NaN·Infinity는 거부한다. */
export const mmSchema = z.number().int();

const MM2_PER_M2_HUNDREDTH = 10_000; // 0.01 m2 = 10,000 mm2

/** 값이 mm 정수인지 확인한다. */
export function isMm(value: unknown): value is Mm {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** m 값을 mm 정수로 바꾼다(0에서 먼 쪽 반올림). */
export function mToMm(meters: number): Mm {
  if (!Number.isFinite(meters)) throw new RangeError(`유한한 수가 아닙니다: ${meters}`);
  const mm = Math.round(Math.abs(meters * 1000));
  return mm === 0 ? 0 : Math.sign(meters) * mm;
}

/** mm2 정수 면적 → 0.01 m2 단위 정수(0에서 먼 쪽 반올림, 정수 연산만). */
export function mm2ToM2Hundredths(areaMm2: number): number {
  if (!Number.isSafeInteger(areaMm2)) throw new RangeError(`면적은 mm2 정수여야 합니다: ${areaMm2}`);
  const abs = Math.floor((Math.abs(areaMm2) + MM2_PER_M2_HUNDREDTH / 2) / MM2_PER_M2_HUNDREDTH);
  return abs === 0 ? 0 : Math.sign(areaMm2) * abs;
}

/** mm2 정수 면적 → m2 수치(소수 둘째 자리 반올림). */
export function mm2ToM2(areaMm2: number): number {
  return mm2ToM2Hundredths(areaMm2) / 100;
}

/** mm2 정수 면적 → 표시 문자열 "123.45"(소수 둘째 자리 고정, 천 단위 구분 없음). */
export function formatAreaM2(areaMm2: number): string {
  const h = mm2ToM2Hundredths(areaMm2);
  const abs = Math.abs(h);
  const frac = String(abs % 100).padStart(2, "0");
  return `${h < 0 ? "-" : ""}${Math.floor(abs / 100)}.${frac}`;
}
