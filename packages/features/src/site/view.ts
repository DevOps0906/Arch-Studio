// 2D 대지 뷰 좌표 변환(SVG 표시용). 모델 mm(+Y 위) ↔ SVG 사용자 좌표(+Y 아래)는 y 부호만 바꾼다: svg = (x, -y).
// 표시 전용 계산이며 판정·도면 기하가 아니다. 클릭 입력은 DRAW_GRID_MM 격자에 맞춘 mm 정수로만 모델에 들어간다.
import type { Point } from "@arch-studio/domain";
import { roundHalfAway } from "@arch-studio/geometry";
import { DRAW_GRID_MM } from "./model.ts";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 빈 캔버스 기본 범위(30m × 20m). */
export const EMPTY_VIEW: ViewBox = { x: -2000, y: -22000, w: 34000, h: 24000 };

/** 점들을 감싸는 viewBox(여백 12%, 최소 10m). */
export function viewBoxFor(points: readonly Point[]): ViewBox {
  if (points.length === 0) return EMPTY_VIEW;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => -p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 10_000);
  const h = Math.max(maxY - minY, 10_000);
  const m = Math.max(w, h) * 0.12;
  return { x: (minX + maxX) / 2 - w / 2 - m, y: (minY + maxY) / 2 - h / 2 - m, w: w + 2 * m, h: h + 2 * m };
}

export function viewBoxAttr(v: ViewBox): string {
  return `${v.x} ${v.y} ${v.w} ${v.h}`;
}

/** SVG 사용자 좌표 → 모델 mm(격자 맞춤, half-away). */
export function svgToModel(sx: number, sy: number, grid = DRAW_GRID_MM): Point {
  return [roundHalfAway(sx / grid) * grid, roundHalfAway(-sy / grid) * grid];
}

export function modelToSvg(p: Point): [number, number] {
  return [p[0], -p[1]];
}

/** polygon/polyline points 속성. */
export function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${p[0]},${-p[1]}`).join(" ");
}

/** 변 중점(SVG 좌표, 라벨 위치). */
export function edgeMid(points: readonly Point[], i: number): [number, number] {
  const a = points[i] as Point;
  const b = points[(i + 1) % points.length] as Point;
  return [(a[0] + b[0]) / 2, -(a[1] + b[1]) / 2];
}

/** 표시 글자 크기·핸들 크기(viewBox 크기 비례). */
export function scaleOf(v: ViewBox): { text: number; handle: number } {
  const s = Math.max(v.w, v.h);
  return { text: s / 36, handle: s / 90 };
}
