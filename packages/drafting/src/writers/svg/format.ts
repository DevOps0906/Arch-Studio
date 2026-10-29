// SVG·PDF 공용 숫자·문자 출력 도구(02_ARCHITECTURE.md 2.3절 결정성 규칙 "숫자 출력").
import { roundHalfAway } from "@arch-studio/geometry";
import { DraftingError } from "../../sheet/errors.ts";

/** 숫자 출력: 지수 표기 금지, 소수 최대 3자리(half-away-from-zero), 끝 0 제거, -0은 0. DXF `num`과 같은 규칙. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new DraftingError("INVALID_ARGUMENT", `도면 숫자가 유한하지 않습니다: ${n}`);
  const v = Number.isSafeInteger(n) ? n : roundHalfAway(n * 1000) / 1000;
  if (Math.abs(v) >= 1e15) throw new DraftingError("INVALID_ARGUMENT", `도면 숫자가 너무 큽니다: ${n}`);
  return String(v + 0);
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * 한 줄 문자열 정리: 제어 문자(탭·줄바꿈 포함)는 공백(DXF TEXT와 같음), 짝 없는 서로게이트와 U+FFFE·U+FFFF는 U+FFFD.
 * XML 1.0에서 쓸 수 없는 문자가 남지 않는다.
 */
export function cleanLine(s: string): string {
  let out = "";
  const t = s.replace(CONTROL, " ");
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < t.length ? t.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += t[i] + (t[i + 1] as string);
        i++;
      } else out += "�";
    } else if ((c >= 0xdc00 && c <= 0xdfff) || c === 0xfffe || c === 0xffff) out += "�";
    else out += t[i];
  }
  return out;
}

/** 여러 줄 문자열(MTEXT): \r\n·\n·\r로 나눈 뒤 줄마다 cleanLine. */
export function cleanLines(s: string): string[] {
  return s.split(/\r\n|\n|\r/).map(cleanLine);
}

/** XML 문자 데이터·속성 값 이스케이프(cleanLine 뒤에 쓴다). */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
