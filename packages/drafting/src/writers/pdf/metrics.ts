// 글꼴 폭 표(02_ARCHITECTURE.md 2.3절 "한글 처리": 표·라벨 배치용 글자 폭은 빌드 시 글꼴 파일에서 뽑은 고정 표로 계산,
// WebView 글꼴 렌더러에 의존하지 않음). 생성은 scripts/font-metrics(빌드 시, 파일 I/O), 이 모듈은 표 만들기·측정 순수 함수.
// 표 형식: 같은 advance가 이어지는 코드 포인트 구간 [시작, 끝, 폭] 목록(한글 음절 11,172자가 대개 한 구간). 글꼴에 없는 글자는 빠진다.
import { DraftingError } from "../../sheet/errors.ts";
import type { TtfInfo } from "./ttf.ts";

export const FONT_METRICS_FORMAT = "arch-font-metrics/1";

/** 기본 수집 범위: 라틴 기본·보충, 일반 구두점, 한글 자모(호환), CJK 기호, CJK 호환(㎡ 등), 한글 음절, 전각·반각. */
export const DEFAULT_METRIC_RANGES: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0x0020, 0x007e],
  [0x00a0, 0x00ff],
  [0x2000, 0x206f],
  [0x2190, 0x21ff],
  [0x2460, 0x24ff],
  [0x25a0, 0x25ff],
  [0x3000, 0x303f],
  [0x3130, 0x318f],
  [0x3200, 0x32ff],
  [0x3300, 0x33ff],
  [0xac00, 0xd7a3],
  [0xff00, 0xffef],
] as const);

export interface FontMetrics {
  format: typeof FONT_METRICS_FORMAT;
  family: string;
  units_per_em: number;
  /** 표에 없는 글자에 쓰는 폭(.notdef, 글리프 0). */
  default_advance: number;
  /** 원본 글꼴 파일(생성 스크립트가 채운다. 파일 자체는 커밋하지 않는다). */
  source: { file: string; bytes: number; sha256: string };
  /** [첫 코드 포인트, 끝 코드 포인트(포함), advance(글꼴 단위)], 시작 오름차순, 겹침 없음. */
  runs: Array<[number, number, number]>;
}

export function buildFontMetrics(
  font: TtfInfo,
  source: FontMetrics["source"],
  ranges: ReadonlyArray<readonly [number, number]> = DEFAULT_METRIC_RANGES,
): FontMetrics {
  const sorted = [...ranges].map(([a, b]) => [a, b] as const).sort((x, y) => x[0] - y[0]);
  const runs: Array<[number, number, number]> = [];
  let last = -1;
  for (const [a, b] of sorted) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b > 0x10ffff || a > b) {
      throw new DraftingError("INVALID_ARGUMENT", `코드 포인트 범위가 올바르지 않습니다: ${a}..${b}`);
    }
    for (let cp = Math.max(a, last + 1); cp <= b; cp++) {
      last = cp;
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const gid = font.glyph(cp);
      if (gid === 0) continue;
      const adv = font.advance(gid);
      const r = runs[runs.length - 1];
      if (r !== undefined && r[1] === cp - 1 && r[2] === adv) r[1] = cp;
      else runs.push([cp, cp, adv]);
    }
  }
  return {
    format: FONT_METRICS_FORMAT,
    family: font.family,
    units_per_em: font.units_per_em,
    default_advance: font.advance(0),
    source,
    runs,
  };
}

/** 코드 포인트 폭(글꼴 단위). 표에 없으면 null. */
export function advanceOf(m: FontMetrics, cp: number): number | null {
  let lo = 0;
  let hi = m.runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = m.runs[mid] as [number, number, number];
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return r[2];
  }
  return null;
}

/**
 * 문자열 폭 = Σ advance / unitsPerEm × 글꼴 크기(em, 호출자 단위). 커닝·합자는 쓰지 않는다(CAD 문자와 같은 단순 합).
 * missing = 표에 없는 글자 수(default_advance로 셈).
 */
export function measureText(m: FontMetrics, s: string, em: number): { width: number; missing: number } {
  let units = 0;
  let missing = 0;
  for (const ch of s) {
    const a = advanceOf(m, ch.codePointAt(0) as number);
    if (a === null) {
      missing++;
      units += m.default_advance;
    } else units += a;
  }
  return { width: (units / m.units_per_em) * em, missing };
}

/** 표 JSON 직렬화(결정적: 키 순서 고정, 구간은 한 줄에 하나). */
export function fontMetricsJson(m: FontMetrics): string {
  const head = {
    format: m.format,
    family: m.family,
    units_per_em: m.units_per_em,
    default_advance: m.default_advance,
    source: { file: m.source.file, bytes: m.source.bytes, sha256: m.source.sha256 },
  };
  const body = JSON.stringify(head, null, 2).replace(/\n\}$/, "");
  if (m.runs.length === 0) return `${body},\n  "runs": []\n}\n`;
  const runs = m.runs.map((r) => `    [${r[0]}, ${r[1]}, ${r[2]}]`).join(",\n");
  return `${body},\n  "runs": [\n${runs}\n  ]\n}\n`;
}
