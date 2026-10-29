// @arch-studio/drafting/writers/pdf — SheetModel[] → 벡터 PDF 바이트(jsPDF 직접 그리기, D-23). 결정적 순수 함수.
// jsPDF를 끌어오므로 패키지 루트(src/index.ts)에서는 다시 내보내지 않는다(판정 워커 번들에 들어가지 않게).
export {
  base64,
  PDF_DEFAULT_CREATION_DATE,
  PDF_FALLBACK_FONT,
  PDF_WRITER_VERSION,
  writePdf,
  type PdfFont,
  type PdfOptions,
  type PdfResult,
} from "./write.ts";
export { OutputError, type OutputFailure } from "./errors.ts";
export { parseTtf, type TtfInfo, type TtfParse } from "./ttf.ts";
export {
  advanceOf,
  buildFontMetrics,
  DEFAULT_METRIC_RANGES,
  FONT_METRICS_FORMAT,
  fontMetricsJson,
  measureText,
  type FontMetrics,
} from "./metrics.ts";
