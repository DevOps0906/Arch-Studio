// DXF 그룹 코드 출력 도구(02_ARCHITECTURE.md 2.3절 결정성 규칙 "숫자 출력", "문자").
import { roundHalfAway } from "@arch-studio/geometry";
import { DraftingError } from "../../sheet/errors.ts";

/** 숫자 출력: 지수 표기 금지, 소수 최대 3자리(half-away-from-zero), 끝 0 제거, -0은 0. */
export function num(n: number): string {
  if (!Number.isFinite(n)) throw new DraftingError("INVALID_ARGUMENT", `DXF 숫자가 유한하지 않습니다: ${n}`);
  const v = Number.isSafeInteger(n) ? n : roundHalfAway(n * 1000) / 1000;
  // 1e15 이상은 소수 3자리를 보장할 수 없고 1e21 이상은 String()이 지수 표기를 낸다.
  if (Math.abs(v) >= 1e15) throw new DraftingError("INVALID_ARGUMENT", `DXF 숫자가 너무 큽니다: ${n}`);
  return String(v + 0);
}

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** TEXT 한 줄: 제어 문자(탭·줄바꿈 포함)를 공백으로. */
export function textValue(s: string): string {
  return s.replace(CONTROL, " ");
}

/** MTEXT: 서식 코드를 쓰지 않으므로 `\`·`{`·`}` 이스케이프, 줄바꿈(\r\n·\n·\r)은 `\P`, 나머지 제어 문자 제거. */
export function mtextValue(s: string): string {
  return s
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(CONTROL, " ").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}"))
    .join("\\P");
}

/**
 * MTEXT 문자열을 250자 조각으로 나눈다(앞 조각은 그룹 3, 마지막은 그룹 1). 이스케이프(`\x`)·서로게이트 쌍 중간에서 자르지 않는다.
 */
export function mtextChunks(s: string, size = 250): string[] {
  const out: string[] = [];
  let i = 0;
  while (s.length - i > size) {
    let end = i + size;
    // end 앞의 연속 백슬래시가 홀수면 이스케이프 중간이다.
    let bs = 0;
    for (let j = end - 1; j >= i && s.charCodeAt(j) === 0x5c; j--) bs++;
    if (bs % 2 === 1) end--;
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
    out.push(s.slice(i, end));
    i = end;
  }
  out.push(s.slice(i));
  return out;
}

/** 이름(레이어·블록·글꼴): 파일 구조를 깨는 제어 문자가 있으면 INVALID_ARGUMENT. */
export function nameValue(s: string, what: string): string {
  if (typeof s !== "string" || s === "" || /[\u0000-\u001f\u007f]/.test(s)) {
    throw new DraftingError("INVALID_ARGUMENT", `${what} 이름이 비었거나 제어 문자가 있습니다: ${JSON.stringify(s)}`);
  }
  return s;
}

/** 그룹 코드·값 줄 버퍼. 줄 끝은 join 때 `\r\n`. */
export class GroupWriter {
  readonly lines: string[] = [];
  g(code: number, v: string | number): this {
    this.lines.push(code < 10 ? `  ${code}` : code < 100 ? ` ${code}` : String(code), typeof v === "number" ? num(v) : v);
    return this;
  }
}

/** 16진 대문자 핸들, 고정 시작값 1부터 순차. */
export class Handles {
  private n = 1;
  next(): string {
    return (this.n++).toString(16).toUpperCase();
  }
  /** $HANDSEED = 다음 값. */
  seed(): string {
    return this.n.toString(16).toUpperCase();
  }
}

/** UTF-8 바이트 수(인코딩 없이 셈). 짝 없는 서로게이트는 U+FFFD(3바이트)로 센다. */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}
