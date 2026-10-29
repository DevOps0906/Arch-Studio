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
export { buildSitePlanView, SITE_PLAN_VIEW_ID, type SitePlanExtras } from "./views/site_plan/index.ts";
export { buildAreaPlanView, type AreaPlanInput, type AreaBreakdown } from "./views/area_plan/index.ts";
export {
  buildSunlightSectionView,
  SUNLIGHT_VIEW_ID,
  type SunlightBandInput,
  type SunlightBasisInput,
  type SunlightConstraintInput,
  type SunlightEnvelopeInput,
  type SunlightSectionOptions,
} from "./views/sunlight_section/index.ts";
// AR-06-022: SVG·PDF·PNG 작성기는 하위 경로(./writers/svg, ./writers/pdf — jsPDF, ./writers/png — resvg 네이티브는 루트에서 내보내지 않는다).
export { OutputError, type OutputFailure } from "./writers/pdf/errors.ts";
// PNG는 resvg(네이티브)를 끌어오므로 타입만 루트에서 내보내고 writePng는 ./writers/png 하위 경로로만 쓴다.
export type { PngOptions, PngResult } from "./writers/png/types.ts";
