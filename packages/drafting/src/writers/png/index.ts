// PNG 미리보기(AR-F-038 "PNG 미리보기") — 이번 작업(AR-06-022)에서는 시그니처와 오류만 정의하고 구현하지 않는다.
// 이유: 래스터화 경로가 미결정이다. (1) Node·워커용 라이브러리는 라이선스 검토가 먼저다(sharp = libvips LGPL-3.0 동봉, resvg-js 등 다른 후보도 라이선스·네이티브 바이너리 확인 전).
// (2) 02_ARCHITECTURE.md 표의 "WebView 캔버스 래스터화"는 DOM·OffscreenCanvas가 필요해 순수 엔진 밖(apps/packages/features)에서 해야 하고,
// 글꼴 렌더러 차이로 바이트 결정성을 보장할 수 없다. 결정 후 이 시그니처 그대로 구현하거나, 화면 쪽 래스터화 함수를 주입받는 형태로 바꾼다.
// 입력은 writeSvg 결과와 같은 장면이어야 한다(미리보기 = SVG = PNG).
import type { SheetModel } from "../../sheet/types.ts";
import { OutputError } from "../pdf/errors.ts";

export interface PngOptions {
  /** 용지 1인치당 픽셀(기본 150 예정). */
  dpi?: number;
}

export interface PngResult {
  bytes: Uint8Array;
  width_px: number;
  height_px: number;
}

/** 미구현: 항상 OutputError(AR056, png_not_implemented). */
export function writePng(sheet: SheetModel, options: PngOptions = {}): PngResult {
  void sheet;
  void options;
  throw new OutputError("png_not_implemented", "PNG 미리보기는 아직 지원하지 않습니다(래스터화 방식 결정 대기)");
}

export { OutputError, type OutputFailure } from "../pdf/errors.ts";
