// @arch-studio/drafting — 도면 엔진(02_ARCHITECTURE.md 2.3절). 결정적 순수 함수만. 작성기(writers/*)는 021·022.
export * from "./sheet/types.ts";
export { DraftingError, type DraftingErrorCode } from "./sheet/errors.ts";
export { ANNO_BAND, frameRect, MARGIN, MARGIN_BIND, paperDims, RESERVED_RIGHT, TITLE_BAND_H, usableRect, type Rect } from "./sheet/paper.ts";
export { fitSheet, SCALES, type Bounds, type FitInput, type FitResult } from "./sheet/fit.ts";
export { validateDraftingInput, type ValidateOptions, type ValidateResult } from "./sheet/validate.ts";
export { assembleSheet, comparePrim, type AssembleInput } from "./sheet/assemble.ts";
export { buildSheet, cosSinDeg, viewBounds, type BuildResult, type ViewModel } from "./sheet/build.ts";
export { canonicalJson, sha256Hex } from "./sheet/hash.ts";
export {
  LAYER_TABLE,
  layerDef,
  layerOrder,
  resolveLayerMap,
  type LayerDef,
  type LayerMapWarning,
  type Linetype,
  type ResolvedLayer,
  type ResolvedLayerMap,
} from "./layers/index.ts";
export {
  assertDisclaimer,
  buildTitleBlock,
  DISCLAIMER,
  DISCLAIMER_KEY,
  DISCLAIMER_MIN_H,
  pendingLabel,
  SHEET_TITLES,
  textHeightUm,
  WATERMARK_TEXT,
  type TitleBlockInput,
} from "./titleblock/index.ts";
export {
  applyOverrides,
  checkValueText,
  dimension,
  label,
  NOTE_PREFIX,
  paperToModel,
  type AnnotateContext,
  type AnnotationOverride,
  type DimensionSpec,
  type LabelSpec,
  type UnappliedOverride,
} from "./annotate/index.ts";
// AR-06-022: SVG·PDF 작성기는 하위 경로(./writers/svg, ./writers/pdf — PDF는 jsPDF를 끌어와 루트에서 내보내지 않는다). PNG는 시그니처만.
export { OutputError, type OutputFailure } from "./writers/pdf/errors.ts";
export { writePng, type PngOptions, type PngResult } from "./writers/png/index.ts";
