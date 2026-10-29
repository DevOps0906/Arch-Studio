// 표시용 숫자 문구(순수). 면적은 ㎡ × 100 정수(h100)로만 들고 다니며 여기서 글자로 바꾼다.
import { roundHalfAway } from "@arch-studio/geometry";

const group = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 3620 → "36.20" */
export function m2Text(h100: number): string {
  const neg = h100 < 0;
  const v = Math.abs(h100);
  return `${neg ? "-" : ""}${group(Math.floor(v / 100))}.${String(v % 100).padStart(2, "0")}`;
}

/** 부호를 글자로 같이 쓴다(색만으로 구분하지 않음): +0.40 / -1.80 / 0.00 */
export function signedM2Text(h100: number): string {
  if (h100 === 0) return "0.00";
  return `${h100 > 0 ? "+" : "-"}${m2Text(Math.abs(h100))}`;
}

/** 목표 대비 비율 한 자리(%): diff/target. 목표 0 이하면 null. */
export function percentText(diff_h100: number, target_h100: number): string | null {
  if (target_h100 <= 0) return null;
  const tenths = roundHalfAway((diff_h100 * 1000) / target_h100);
  if (tenths === 0) return "0.0%";
  const v = Math.abs(tenths);
  return `${tenths > 0 ? "+" : "-"}${Math.floor(v / 10)}.${v % 10}%`;
}

/** "-1.80㎡(-4.7%)" */
export function diffText(diff_h100: number, target_h100: number): string {
  const pct = percentText(diff_h100, target_h100);
  return `${signedM2Text(diff_h100)}㎡${pct ? `(${pct})` : ""}`;
}

export const mmText = (mm: number) => `${group(mm)}mm`;
