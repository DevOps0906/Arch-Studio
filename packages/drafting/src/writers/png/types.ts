// PNG 작성기 타입(AR-06-022). resvg(네이티브)를 끌어오지 않는 파일이라 패키지 루트(src/index.ts)가 다시 내보낸다.
// 구현(writePng)은 ./index.ts — 하위 경로 `@arch-studio/drafting/writers/png`로만 쓴다(엔진 워커·웹 번들 보호).
import type { SheetWarning } from "../../sheet/types.ts";
import type { FontMetrics } from "../pdf/metrics.ts";

export interface PngOptions {
  /** 용지 1인치당 픽셀(기본 150). 가로 px = round(용지 mm / 25.4 × dpi). width_px가 있으면 무시. */
  dpi?: number;
  /** 가로 픽셀을 직접 지정(세로는 용지 비율). 미리보기 작은 이미지용. */
  width_px?: number;
  /** 글꼴 TTF 파일 경로(기본: fonts/의 번들 Noto Sans KR). resvg-js 2.6.2는 글꼴을 파일 경로로만 받는다(fontFiles). 시스템 글꼴은 쓰지 않는다. */
  font_file?: string;
  /** 글꼴 이름(SVG font-family와 PNG 글꼴 탐색 기본값). 기본 'Noto Sans KR'. font_file을 바꾸면 함께 바꾼다. */
  font_name?: string;
  /** MTEXT 줄바꿈 폭 표(writeSvg·writePdf와 같은 값). 기본: 번들 폭 표. */
  metrics?: FontMetrics;
}

export interface PngResult {
  bytes: Uint8Array;
  width_px: number;
  height_px: number;
  /** AR057: 글꼴에 없는 글자(부분 집합 밖) — 렌더 결과에서는 빈칸·상자가 된다. */
  warnings: SheetWarning[];
}
