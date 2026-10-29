// 격자 탐색 보조(순수, 정수 mm): 대지 영역 안쪽 격자 칸 판정 + 칸 행렬 안의 직사각형 열거.
// 칸 판정은 빠른 사전 걸러냄이다. 최종 후보는 호출자가 솔리드 커널(영역 차집합)로 정확히 다시 검사한다.
import type { Point, Polygon } from "@arch-studio/domain";

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const rectWidth = (r: Rect): number => r.x1 - r.x0;
export const rectDepth = (r: Rect): number => r.y1 - r.y0;
export const rectArea = (r: Rect): number => (r.x1 - r.x0) * (r.y1 - r.y0);

/** 반시계 외곽 직사각형 꼭짓점. */
export function rectOuter(r: Rect): Point[] {
  return [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
}

export const rectKey = (r: Rect): string => `${r.x0},${r.y0},${r.x1},${r.y1}`;

/** 같은 점수일 때 쓰는 결정적 순서(좌표 사전순). */
export function compareRect(a: Rect, b: Rect): number {
  return a.x0 - b.x0 || a.y0 - b.y0 || a.x1 - b.x1 || a.y1 - b.y1;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  if (cross(b[0] - a[0], b[1] - a[1], p[0] - a[0], p[1] - a[1]) !== 0) return false;
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

/** 고리 안(경계 포함)인가. 정수 연산만(홀짝 교차). */
function inRing(p: Point, ring: readonly Point[]): "in" | "edge" | "out" {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Point;
    const b = ring[i] as Point;
    if (onSegment(p, a, b)) return "edge";
    if (a[1] > p[1] !== b[1] > p[1]) {
      // 교차점의 x가 p[0]보다 오른쪽인가(분모 부호로 정수 비교).
      const lhs = (p[0] - a[0]) * (b[1] - a[1]);
      const rhs = (b[0] - a[0]) * (p[1] - a[1]);
      if (b[1] - a[1] > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside ? "in" : "out";
}

/** 영역(외곽 + 구멍들)의 합집합 안(경계 포함)인가. */
export function inRegion(p: Point, region: readonly Polygon[]): boolean {
  for (const poly of region) {
    const o = inRing(p, poly.outer);
    if (o === "out") continue;
    if (o === "edge") return true;
    let inHole = false;
    for (const h of poly.holes ?? []) {
      const r = inRing(p, h);
      if (r === "in") inHole = true;
      if (r === "edge") return true;
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * 선분 a–b가 직사각형의 열린 안쪽을 지나는가(경계에 맞닿거나 겹치기만 하면 아니다). 정수 연산만(정확).
 * 분리축 판정: x·y 범위가 엄격히 겹치고, 네 모서리가 선 한쪽(닫힌)에 모두 있지 않아야 한다.
 */
function segmentCrossesInterior(a: Point, b: Point, r: Rect): boolean {
  if (Math.max(a[0], b[0]) <= r.x0 || Math.min(a[0], b[0]) >= r.x1) return false;
  if (Math.max(a[1], b[1]) <= r.y0 || Math.min(a[1], b[1]) >= r.y1) return false;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let pos = false;
  let neg = false;
  for (const [px, py] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]] as const) {
    const c = cross(dx, dy, px - a[0], py - a[1]);
    if (c > 0) pos = true;
    else if (c < 0) neg = true;
  }
  return pos && neg;
}

/** 직사각형이 영역 안(경계 포함)에 통째로 들어가는가 — 정확 판정(네 모서리가 영역 안 + 어떤 고리 변도 열린 안쪽을 지나지 않음). */
export function rectInside(r: Rect, region: readonly Polygon[]): boolean {
  if (r.x1 <= r.x0 || r.y1 <= r.y0) return false;
  const corners: Point[] = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
  if (!corners.every((p) => inRegion(p, region))) return false;
  for (const poly of region) {
    for (const ring of [poly.outer, ...(poly.holes ?? [])]) {
      for (let i = 0; i < ring.length; i++) {
        if (segmentCrossesInterior(ring[i] as Point, ring[(i + 1) % ring.length] as Point, r)) return false;
      }
    }
  }
  return true;
}

export interface Occupancy {
  readonly x0: number;
  readonly y0: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  /** rows × cols, 1 = 영역 안 칸. */
  readonly cells: readonly Uint8Array[];
}

/** 영역의 경계 상자를 step 격자로 나눠 칸마다 안/밖을 정한다. */
export function occupancyOf(region: readonly Polygon[], step: number): Occupancy | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of region) {
    for (const [x, y] of poly.outer) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const cols = Math.ceil((maxX - minX) / step);
  const rows = Math.ceil((maxY - minY) / step);
  if (cols < 1 || rows < 1) return null;
  const cells: Uint8Array[] = [];
  for (let j = 0; j < rows; j++) {
    const row = new Uint8Array(cols);
    for (let i = 0; i < cols; i++) {
      const r = { x0: minX + i * step, y0: minY + j * step, x1: minX + (i + 1) * step, y1: minY + (j + 1) * step };
      row[i] = rectInside(r, region) ? 1 : 0;
    }
    cells.push(row);
  }
  return { x0: minX, y0: minY, step, cols, rows, cells };
}

/**
 * 칸 행렬 안의 직사각형(모든 칸이 1)을 열거한다. 아래 변마다 폭을 늘려 가며 높이가 줄어드는 지점만 남기므로
 * 각 (아래 변, 시작 열)마다 후보 수가 높이 종류 수로 제한된다. 순서는 행·열 오름차순(결정적).
 */
export function enumerateRects(o: Occupancy): Rect[] {
  const out: Rect[] = [];
  const heights = new Array<number>(o.cols).fill(0);
  for (let j = 0; j < o.rows; j++) {
    const row = o.cells[j] as Uint8Array;
    for (let i = 0; i < o.cols; i++) heights[i] = row[i] ? (heights[i] as number) + 1 : 0;
    for (let c = 0; c < o.cols; c++) {
      let minH = Infinity;
      let last = -1;
      for (let c2 = c; c2 < o.cols; c2++) {
        const h = heights[c2] as number;
        if (h === 0) break;
        if (h < minH) {
          // 높이가 줄기 직전 폭까지가 이 높이의 최대 폭이다.
          if (last >= c && Number.isFinite(minH)) out.push(toRect(o, c, last, j, minH));
          minH = h;
        }
        last = c2;
      }
      if (last >= c && Number.isFinite(minH)) out.push(toRect(o, c, last, j, minH));
    }
  }
  return out;
}

function toRect(o: Occupancy, c0: number, c1: number, rowBottom: number, h: number): Rect {
  return {
    x0: o.x0 + c0 * o.step,
    x1: o.x0 + (c1 + 1) * o.step,
    y0: o.y0 + (rowBottom - h + 1) * o.step,
    y1: o.y0 + (rowBottom + 1) * o.step,
  };
}
