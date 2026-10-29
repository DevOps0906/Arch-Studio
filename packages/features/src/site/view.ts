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

/** 빈 캔버스·새로 그리기 범위(모델 x -5~55m, y -5~40m, 화면 비율 4:3). 그리는 동안은 이 범위를 고정한다(클릭 좌표 기준이 움직이지 않게). */
export const EMPTY_VIEW: ViewBox = { x: -5000, y: -40000, w: 60000, h: 45000 };

/** 그리기 보조 격자(5m 간격) 선 좌표(SVG). */
export function gridLines(v: ViewBox, step = 5000): { x1: number; y1: number; x2: number; y2: number }[] {
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = Math.ceil(v.x / step) * step; x <= v.x + v.w; x += step) out.push({ x1: x, y1: v.y, x2: x, y2: v.y + v.h });
  for (let y = Math.ceil(v.y / step) * step; y <= v.y + v.h; y += step) out.push({ x1: v.x, y1: y, x2: v.x + v.w, y2: y });
  return out;
}

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

/**
 * 변 라벨 위치(SVG 좌표): 변 중점에서 대지 안쪽으로 `offset`만큼 민다(선과 겹치지 않게). 표시 전용.
 * 안쪽 = 부호 있는 면적이 양(반시계)이면 진행 방향 왼쪽, 음(시계)이면 오른쪽.
 */
export function edgeLabelPos(points: readonly Point[], i: number, offset: number): [number, number, "start" | "middle" | "end"] {
  const a = points[i] as Point;
  const b = points[(i + 1) % points.length] as Point;
  let s = 0;
  for (let k = 0; k < points.length; k++) {
    const p = points[k] as Point;
    const q = points[(k + 1) % points.length] as Point;
    s += p[0] * q[1] - q[0] * p[1];
  }
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const sign = s >= 0 ? 1 : -1;
  const nx = (-dy / len) * sign;
  const ny = (dx / len) * sign;
  const mx = (a[0] + b[0]) / 2 + nx * offset;
  const my = (a[1] + b[1]) / 2 + ny * offset;
  // 세로에 가까운 변은 글자를 안쪽으로 붙여 정렬(가운데 정렬이면 긴 라벨이 변을 가로지른다)
  const anchor = Math.abs(nx) > 0.7 ? (nx > 0 ? "start" : "end") : "middle";
  return [mx, -my, anchor];
}

/** 표시 글자 크기·핸들 크기(viewBox 크기 비례). */
export function scaleOf(v: ViewBox): { text: number; handle: number } {
  const s = Math.max(v.w, v.h);
  return { text: s / 28, handle: s / 90 };
}
