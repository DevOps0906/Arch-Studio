// 레이어 그리기 스타일(SVG·PDF 공용). 색은 DXF ACI(CAD 색 체계)를 흰 용지에서 읽히게 옮긴 출력 상수라 UI 디자인 토큰이 아니다
// (layers/index.ts 머리 주석과 같은 이유). 선 굵기·선 종류 패턴은 용지 mm.
import { layerDef, type Linetype } from "../../layers/index.ts";
import type { StdLayer } from "@arch-studio/domain";

export type Rgb = readonly [number, number, number];

/** ACI 1~9 → 용지 출력 RGB(노랑·초록·청록·자홍은 흰 바탕에서 읽히도록 어둡게, 7은 검정). 표에 없는 번호는 검정. */
const ACI_RGB: Readonly<Record<number, Rgb>> = Object.freeze({
  1: [255, 0, 0],
  2: [200, 160, 0],
  3: [0, 160, 0],
  4: [0, 160, 200],
  5: [0, 0, 255],
  6: [192, 0, 192],
  7: [0, 0, 0],
  8: [128, 128, 128],
  9: [176, 176, 176],
});
const BLACK: Rgb = [0, 0, 0];

/** 선 종류 패턴(용지 mm, 선·공백 번갈아). DXF LTYPE과 같은 길이이고 점(0)은 0.2mm 선으로 그린다. */
const DASH: Readonly<Record<Linetype, readonly number[]>> = Object.freeze({
  CONTINUOUS: [],
  DASHED: [3, 1.5],
  DASHDOT: [3, 1, 0.2, 1],
});

/** 레이어별 선 굵기(용지 mm, 제안). 표에 없는 레이어는 0.18. */
const WIDTH: Readonly<Partial<Record<StdLayer, number>>> = Object.freeze({
  "A-SITE-BNDY": 0.35,
  "A-MASS": 0.5,
  "A-WALL": 0.35,
  "A-ANNO-DIMS": 0.13,
  "A-TTLB": 0.35,
  "A-REFR": 0.13,
});
const DEFAULT_WIDTH = 0.18;

/** 해치(ANSI31) 선 굵기(용지 mm). */
export const HATCH_LINE_WIDTH = 0.13;
/** 문자 높이(CAD TEXT 높이 ≈ 대문자·한글 높이) → 글꼴 크기(em) 배율(제안). SVG·PDF 공용. */
export const TEXT_EM_PER_HEIGHT = 1.25;
/** SOLID 해치 채움 불투명도(겹친 선을 가리지 않게). */
export const SOLID_OPACITY = 0.25;

export interface LayerStyle {
  rgb: Rgb;
  /** 용지 mm. */
  width: number;
  /** 용지 mm. 빈 배열 = 실선. */
  dash: readonly number[];
}

export function layerStyle(layer: StdLayer): LayerStyle {
  const def = layerDef(layer);
  return { rgb: ACI_RGB[def.aci] ?? BLACK, width: WIDTH[layer] ?? DEFAULT_WIDTH, dash: DASH[def.linetype] };
}

export function rgbHex(c: Rgb): string {
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
