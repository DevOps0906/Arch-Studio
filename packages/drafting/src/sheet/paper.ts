// 용지·여백·표제란 띠·예약 영역(02_ARCHITECTURE.md 2.3절 축척 자동 선택 1단계). 모두 용지 0.01mm 정수.
import type { Orientation, PaperSize, PaperUm, SheetKind } from "./types.ts";

/** ISO 216 용지(mm → 0.01mm), 가로 방향 기준 [긴 변, 짧은 변]. */
const PAPER_UM: Readonly<Record<PaperSize, readonly [PaperUm, PaperUm]>> = Object.freeze({
  A3: [42_000, 29_700],
  A2: [59_400, 42_000],
  A1: [84_100, 59_400],
});

/** 여백(제안): 철하는 쪽(왼쪽) 25mm, 나머지 10mm. */
export const MARGIN_BIND: PaperUm = 2_500;
export const MARGIN: PaperUm = 1_000;
/** 표제란 하단 띠 높이(제안 40mm). */
export const TITLE_BAND_H: PaperUm = 4_000;
/** 주석 띠(제안: 사방 15mm, 치수 2단 기준). */
export const ANNO_BAND: PaperUm = 1_500;

/** 시트 종류별 오른쪽 예약 폭(면적표·요약표 자리, 제안). 표는 024·023 뷰 작업이 채운다. */
export const RESERVED_RIGHT: Readonly<Record<SheetKind, PaperUm>> = Object.freeze({
  site_plan: 8_000,
  area_plan: 12_000,
  sunlight_section: 0,
  floor_plan: 0,
  elevation: 0,
});

export interface Rect {
  x0: PaperUm;
  y0: PaperUm;
  x1: PaperUm;
  y1: PaperUm;
}

export function paperDims(size: PaperSize, orientation: Orientation): { w: PaperUm; h: PaperUm } {
  const [long, short] = PAPER_UM[size];
  return orientation === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

/** 도곽(용지 − 여백). 원점은 용지 왼쪽 아래, y 위쪽. */
export function frameRect(size: PaperSize, orientation: Orientation): Rect {
  const { w, h } = paperDims(size, orientation);
  return { x0: MARGIN_BIND, y0: MARGIN, x1: w - MARGIN, y1: h - MARGIN };
}

/** 뷰를 놓을 수 있는 영역 = 도곽 − 표제란 띠 − 시트 종류별 예약 폭. */
export function usableRect(size: PaperSize, orientation: Orientation, kind: SheetKind): Rect {
  const f = frameRect(size, orientation);
  return { x0: f.x0, y0: f.y0 + TITLE_BAND_H, x1: f.x1 - RESERVED_RIGHT[kind], y1: f.y1 };
}
