// @arch-studio/drafting/writers/png — SheetModel → PNG(Uint8Array). writeSvg 결과를 resvg(npm @resvg/resvg-js 2.6.2 = Rust resvg 0.34.0 + 패치)로 래스터화한다.
// 네이티브 모듈이라 패키지 루트(src/index.ts)에서는 타입만 내보낸다(엔진 워커·웹 번들에 안 들어가게). Node 전용(서버·CI·샘플 생성).
// 데스크톱(Tauri, Node 없음)에서는 쓸 수 없다 → README.md "데스크톱" 절(후속 AR-06-080: 설치형 resvg 크레이트).
// 글꼴: 시스템 글꼴을 쓰지 않는다(loadSystemFonts:false). 번들 TTF를 fontFiles(경로)로 직접 넣고 모든 일반 family를 같은 글꼴로 맞춘다
// → 어느 PC에서도 같은 글꼴. 렌더 옵션 전체와 재현 방법은 README.md.
// 결정성: 같은 입력 → 같은 바이트(같은 resvg·같은 글꼴). 메타데이터 청크 없음(IHDR·pHYs·IDAT·IEND만). 플랫폼 간 바이트 동일은 약속하지 않는다.
// eslint-disable-next-line no-restricted-imports -- Node 전용 하위 경로(머리 주석): 글꼴 파일을 읽는다
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { DraftingError } from "../../sheet/errors.ts";
import type { SheetModel, SheetWarning } from "../../sheet/types.ts";
import { OutputError } from "../pdf/errors.ts";
import type { FontMetrics } from "../pdf/metrics.ts";
import { BUNDLED_FONT_FILE, BUNDLED_FONT_NAME } from "../pdf/bundled.ts";
import { bundledFontPath, loadBundledMetrics } from "../pdf/node.ts";
import { parseTtf, type TtfInfo } from "../pdf/ttf.ts";
import { buildScene } from "../svg/scene.ts";
import { writeSvg } from "../svg/write.ts";
import type { PngOptions, PngResult } from "./types.ts";

export type { PngOptions, PngResult } from "./types.ts";
export { OutputError, type OutputFailure } from "../pdf/errors.ts";

export const PNG_WRITER_VERSION = "png-1.0.0";
export const PNG_DEFAULT_DPI = 150;
/** resvg-js 렌더 옵션 상수(README.md와 같아야 한다: 후속 Rust 구현이 그대로 재현). */
export const PNG_RENDER_OPTIONS = Object.freeze({
  background: "#ffffff",
  /** resvg ShapeRendering::GeometricPrecision(안티앨리어싱 켬). */
  shapeRendering: 2,
  /** resvg TextRendering::GeometricPrecision(힌팅 없음). */
  textRendering: 2,
  /** resvg ImageRendering::OptimizeQuality. */
  imageRendering: 0,
  loadSystemFonts: false,
});

const MAX_PIXELS = 100_000_000;

export function writePng(sheet: SheetModel, options: PngOptions = {}): PngResult {
  const dpi = options.dpi ?? PNG_DEFAULT_DPI;
  if (!Number.isFinite(dpi) || dpi < 10 || dpi > 1200) throw new DraftingError("INVALID_ARGUMENT", `dpi는 10~1200: ${dpi}`);
  const mmW = sheet.paper.w / 100;
  const mmH = sheet.paper.h / 100;
  const width = options.width_px ?? Math.round((mmW / 25.4) * dpi);
  if (!Number.isSafeInteger(width) || width < 1) throw new DraftingError("INVALID_ARGUMENT", `width_px가 올바르지 않습니다: ${width}`);
  const height = Math.round((width * mmH) / mmW);
  if (width * height > MAX_PIXELS) throw new DraftingError("INVALID_ARGUMENT", `PNG가 너무 큽니다: ${width}x${height}`);

  const name = options.font_name ?? BUNDLED_FONT_NAME;
  const fontFile = options.font_file ?? bundledFontPath(BUNDLED_FONT_FILE);
  let ttf: Uint8Array;
  try {
    ttf = new Uint8Array(readFileSync(fontFile));
  } catch (e) {
    throw new OutputError("font_unavailable", `PNG 글꼴 파일을 읽지 못했습니다: ${fontFile}`, { cause: e });
  }
  const metrics = options.metrics ?? loadBundledMetrics();
  const parsed = parseTtf(ttf);
  if (!parsed.ok) throw new OutputError("png_failed", `PNG 글꼴을 읽을 수 없습니다: ${parsed.reason}`);

  const svg = buildPngSvg(sheet, metrics, name);
  const warnings = absentGlyphs(sheet, metrics, parsed.font);

  try {
    const r = new Resvg(svg, {
      background: PNG_RENDER_OPTIONS.background,
      fitTo: { mode: "width", value: width },
      shapeRendering: PNG_RENDER_OPTIONS.shapeRendering,
      textRendering: PNG_RENDER_OPTIONS.textRendering,
      imageRendering: PNG_RENDER_OPTIONS.imageRendering,
      font: {
        loadSystemFonts: PNG_RENDER_OPTIONS.loadSystemFonts,
        fontFiles: [fontFile],
        defaultFontFamily: name,
        sansSerifFamily: name,
        serifFamily: name,
        monospaceFamily: name,
        cursiveFamily: name,
        fantasyFamily: name,
      },
    });
    const img = r.render();
    const bytes = new Uint8Array(img.asPng());
    // fitTo 폭 기준 반올림이 달라질 수 있어 실제 크기를 돌려준다.
    return { bytes, width_px: img.width, height_px: img.height, warnings };
  } catch (e) {
    throw new OutputError("png_failed", `PNG를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/** PNG로 그릴 SVG 문자열(골든 입력·후속 Rust 구현의 입력과 같다). font-family는 번들 글꼴 이름 + sans-serif. */
export function buildPngSvg(sheet: SheetModel, metrics: FontMetrics, fontName: string = BUNDLED_FONT_NAME): string {
  return writeSvg(sheet, { font_family: `'${fontName}', sans-serif`, metrics });
}

/** 장면의 문자열 중 글꼴에 없는 글자(부분 집합 밖)를 AR057 경고 하나로 모은다. */
function absentGlyphs(sheet: SheetModel, metrics: FontMetrics, font: TtfInfo): SheetWarning[] {
  const absent = new Set<string>();
  const seen = new Set<number>();
  const scan = (s: string) => {
    for (const ch of s) {
      const cp = ch.codePointAt(0) as number;
      if (cp <= 0x20 || seen.has(cp)) continue;
      seen.add(cp);
      if (font.glyph(cp) === 0) absent.add(ch);
    }
  };
  for (const { items } of buildScene(sheet, { metrics }).layers) {
    for (const it of items) {
      if (it.t === "text") scan(it.s);
      else if (it.t === "mtext") for (const l of it.lines) scan(l);
    }
  }
  if (absent.size === 0) return [];
  const list = [...absent].sort();
  return [{ code: "AR057", detail: `글꼴 ${font.family}에 없는 글자 ${list.length}종(예: ${list.slice(0, 10).join("")})` }];
}
