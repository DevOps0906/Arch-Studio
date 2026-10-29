// @arch-studio/drafting/writers/pdf/node — Node 전용 번들 글꼴 읽기(AR-06-022). 파일 I/O라 순수 엔진 규칙의 예외이고,
// 그래서 루트(src/index.ts)·writers/pdf(브라우저·워커용)에서 다시 내보내지 않는다. 쓰는 곳: 서버·CI·샘플 생성·PNG 작성기.
// 브라우저·워커: 같은 파일(fonts/NotoSansKR-Regular.subset.ttf)을 앱 자산으로 배포하고 fetch → { family: BUNDLED_FONT_FAMILY, ttf }.
// eslint-disable-next-line no-restricted-imports -- Node 전용 하위 경로: 번들 글꼴 파일을 읽는다(머리 주석)
import { readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- Node 전용 하위 경로: URL → 파일 경로
import { fileURLToPath } from "node:url";
import { OutputError } from "./errors.ts";
import { BUNDLED_FONT_FAMILY, BUNDLED_FONT_FILE, BUNDLED_METRICS_FILE } from "./bundled.ts";
import { FONT_METRICS_FORMAT, type FontMetrics } from "./metrics.ts";
import type { PdfFont } from "./write.ts";

/** packages/drafting/fonts/ (이 파일 기준 상대 위치). */
export const BUNDLED_FONTS_DIR: URL = new URL("../../../fonts/", import.meta.url);

/** 번들 폴더의 파일 경로(파일 시스템 경로). */
export function bundledFontPath(name: string, dir: URL | string = BUNDLED_FONTS_DIR): string {
  const base = typeof dir === "string" ? dir.replace(/[\\/]*$/, "/") : fileURLToPath(dir);
  return `${base}${name}`;
}

/**
 * 번들 글꼴을 읽어 writePdf({ font })에 넣을 값으로 돌려준다. 폭 표의 source.bytes와 크기가 다르면 OutputError(font_unavailable) —
 * 글꼴만 바꾸고 폭 표를 다시 만들지 않은 경우(SVG·PDF 줄바꿈이 글꼴과 어긋남)를 막는다.
 */
export function loadBundledFont(dir: URL | string = BUNDLED_FONTS_DIR): PdfFont {
  const metrics = loadBundledMetrics(dir);
  let ttf: Uint8Array;
  try {
    ttf = new Uint8Array(readFileSync(bundledFontPath(BUNDLED_FONT_FILE, dir)));
  } catch (e) {
    throw new OutputError("font_unavailable", `번들 글꼴 ${BUNDLED_FONT_FILE}을 읽지 못했습니다`, { cause: e });
  }
  if (ttf.byteLength !== metrics.source.bytes) {
    throw new OutputError(
      "font_unavailable",
      `번들 글꼴 크기(${ttf.byteLength}B)가 폭 표 기록(${metrics.source.bytes}B)과 다릅니다. scripts/font-metrics/generate.ts로 표를 다시 만드세요`,
    );
  }
  return { family: BUNDLED_FONT_FAMILY, ttf };
}

/** 번들 폭 표(writeSvg·writePdf·writePng의 metrics 옵션에 같은 값을 넘긴다). */
export function loadBundledMetrics(dir: URL | string = BUNDLED_FONTS_DIR): FontMetrics {
  let m: FontMetrics;
  try {
    m = JSON.parse(readFileSync(bundledFontPath(BUNDLED_METRICS_FILE, dir), "utf8")) as FontMetrics;
  } catch (e) {
    throw new OutputError("font_unavailable", `번들 폭 표 ${BUNDLED_METRICS_FILE}을 읽지 못했습니다`, { cause: e });
  }
  if (m.format !== FONT_METRICS_FORMAT || m.source?.file !== BUNDLED_FONT_FILE) {
    throw new OutputError("font_unavailable", `번들 폭 표 ${BUNDLED_METRICS_FILE}의 형식·원본 글꼴이 맞지 않습니다`);
  }
  return m;
}
