// 단위 계약 (04_API.md 4.7.1): 좌표·길이는 mm 정수, 면적 표시는 m2 소수 둘째 자리. 순수 함수만.
import { z } from "zod";

/** 모델 길이 단위. 항상 정수 mm. */
export type Mm = number;

/** 좌표·길이 상한(mm). 로컬 원점 기준 ±10km. 넘으면 geometry가 OUT_OF_RANGE로 거부한다. */
export const MM_COORD_LIMIT = 10_000_000;

/** mm 정수 스키마. 소수·NaN·Infinity·±10km 초과는 거부한다(상한 안이면 safe int). */
export const mmSchema = z.number().int().min(-MM_COORD_LIMIT).max(MM_COORD_LIMIT);

const MM2_PER_M2_HUNDREDTH = 10_000; // 0.01 m2 = 10,000 mm2

/** 값이 mm 정수인지 확인한다. */
export function isMm(value: unknown): value is Mm {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * m 값을 mm 정수로 바꾼다(0에서 먼 쪽 반올림).
 * `meters * 1000`의 부동소수 오차(1.0005 → 1000.4999…)를 피하려고 최단 10진 표기(String, ES 명세로 고정)의
 * 자릿수를 옮겨 10진 자리에서 반올림한다. 결과가 safe int를 넘으면 RangeError.
 */
export function mToMm(meters: number): Mm {
  if (!Number.isFinite(meters)) throw new RangeError(`유한한 수가 아닙니다: ${meters}`);
  const [mantissa = "0", exp = "0"] = String(Math.abs(meters)).split("e");
  const [intPart = "0", fracPart = ""] = mantissa.split(".");
  const digits = intPart + fracPart;
  const point = intPart.length + Number(exp) + 3; // ×1000
  const whole = point <= 0 ? "0" : digits.slice(0, point).padEnd(point, "0");
  const next = point < 0 ? "0" : (digits[point] ?? "0");
  const mm = Number(whole) + (next >= "5" ? 1 : 0);
  if (!Number.isSafeInteger(mm)) throw new RangeError(`mm 정수 범위를 넘습니다: ${meters}`);
  return mm === 0 ? 0 : meters < 0 ? -mm : mm;
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
