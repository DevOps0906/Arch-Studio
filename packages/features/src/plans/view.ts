// 평면 2D 뷰 좌표 변환·히트 테스트(표시 전용 순수 함수). 모델 mm(+Y 위) ↔ SVG 사용자 좌표(+Y 아래)는 y 부호만 바꾼다.
// 판정·도면 기하가 아니다: 화면에서 받은 점은 snapMm으로 mm 정수에 맞춘 뒤에만 모델 연산(ops.ts)에 들어간다.
import type { Point, Polygon } from "@arch-studio/domain";
import type { FloorLayout } from "@arch-studio/layout";
import { snapMm } from "./ops.ts";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const EMPTY_VIEW: ViewBox = { x: -1_000, y: -11_000, w: 14_000, h: 12_000 };

/** 점들을 감싸는 viewBox(여백 10%, 최소 6m). 빈 입력은 EMPTY_VIEW. */
export function viewBoxFor(points: readonly Point[]): ViewBox {
  if (points.length === 0) return EMPTY_VIEW;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => -p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 6_000);
  const h = Math.max(maxY - minY, 6_000);
  const m = Math.max(w, h) * 0.1;
  return { x: (minX + maxX) / 2 - w / 2 - m, y: (minY + maxY) / 2 - h / 2 - m, w: w + 2 * m, h: h + 2 * m };
}

export const viewBoxAttr = (v: ViewBox) => `${v.x} ${v.y} ${v.w} ${v.h}`;
export const pointsAttr = (pts: readonly Point[]) => pts.map((p) => `${p[0]},${-p[1]}`).join(" ");

/** SVG 사용자 좌표 → 모델 mm(그리드 맞춤). grid ≤ 1이면 정수 반올림만. */
export function svgToModel(sx: number, sy: number, grid: number): Point {
  return [snapMm(sx, grid), snapMm(-sy, grid)];
}

/** 화면 글자 크기 기준(뷰 크기의 약 1/48). */
export const textSize = (v: ViewBox) => Math.max(v.w, v.h) / 48;

/** 외곽·실의 모든 꼭짓점으로 viewBox를 만든다(외곽 밖으로 나간 실도 보이게). */
export function planViewBox(outline: readonly Polygon[], layout: FloorLayout): ViewBox {
  const pts: Point[] = [];
  for (const p of outline) pts.push(...p.outer);
  for (const r of layout.rooms) pts.push(...r.polygon.outer);
  return viewBoxFor(pts);
}

/** 다각형 안쪽에 가까운 라벨 점: 상자 중심(상자 안쪽에 있으면 그대로). 표시 전용이며 면적·판정에 쓰지 않는다. */
export function labelAt(p: Polygon): Point {
  const xs = p.outer.map((q) => q[0]);
  const ys = p.outer.map((q) => q[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export interface EdgeHit {
  room_id: string;
  edge_index: number;
  /** 변 시작점부터 클릭 투영 거리(mm, 반올림). */
  offset_mm: number;
  dist: number;
}

/** 점에서 가장 가까운 실 변(허용 거리 안). 문·창을 벽 위에 놓을 때 쓴다. */
export function nearestEdge(layout: FloorLayout, p: Point, tolerance: number): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const r of layout.rooms) {
    const n = r.polygon.outer.length;
    for (let i = 0; i < n; i++) {
      const a = r.polygon.outer[i] as Point;
      const b = r.polygon.outer[(i + 1) % n] as Point;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len2 = ex * ex + ey * ey;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2));
      const qx = a[0] + ex * t;
      const qy = a[1] + ey * t;
      const dist = Math.sqrt((p[0] - qx) ** 2 + (p[1] - qy) ** 2);
      if (dist <= tolerance && (best === null || dist < best.dist)) best = { room_id: r.id, edge_index: i, offset_mm: Math.round(t * Math.sqrt(len2)), dist };
    }
  }
  return best;
}

/** 개구부 양 끝점(호스트 변 위, 표시용 실수 좌표). */
export function openingEnds(layout: FloorLayout, o: FloorLayout["openings"][number]): [Point, Point] | null {
  const room = layout.rooms.find((r) => r.id === o.host.room_id);
  if (!room) return null;
  const n = room.polygon.outer.length;
  if (o.host.edge_index < 0 || o.host.edge_index >= n) return null;
  const a = room.polygon.outer[o.host.edge_index] as Point;
  const b = room.polygon.outer[(o.host.edge_index + 1) % n] as Point;
  const len = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
  if (len === 0) return null;
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  return [
    [a[0] + ux * o.offset_mm, a[1] + uy * o.offset_mm],
    [a[0] + ux * (o.offset_mm + o.width_mm), a[1] + uy * (o.offset_mm + o.width_mm)],
  ];
}
