// 새 프로젝트 창의 대지 경계 그림(SVG, 배경 지도 없음 — D-14 확인 뒤): 경계(1점 쇄선)·변 길이·회전 직사각형 가로·세로 치수·북쪽 표시.
// 좌표 변환·라벨 위치는 대지 화면과 같은 site/view.ts를 쓴다(표시 전용 계산). 색·크기는 토큰 유틸리티만.
import type { Point } from "@arch-studio/domain";
import { formatM } from "../site/model.ts";
import { edgeLabelPos, pointsAttr, scaleOf, viewBoxAttr, viewBoxFor } from "../site/view.ts";

/** 변 길이 라벨은 꼭짓점이 이보다 많으면 생략한다(작은 그림에서 겹친다). */
const EDGE_LABEL_MAX = 12;

function len(a: Point, b: Point): number {
  return Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
}

export function SitePreview({ outer, rect, widthMm, depthMm }: { outer: readonly Point[]; rect: readonly [Point, Point, Point, Point]; widthMm: number; depthMm: number }) {
  const base = viewBoxFor([...outer, ...rect]);
  const { text } = scaleOf(base);
  const pad = text * 3;
  const vb = { x: base.x - pad, y: base.y - pad, w: base.w + pad * 2, h: base.h + pad * 2 };
  // 직사각형 첫 변(rect[0]→rect[1])이 x축에 가까우면 가로, 아니면 세로(geometry minAreaRect 규칙과 같다).
  const r0 = rect[0];
  const r1 = rect[1];
  const firstIsX = Math.abs(r1[0] - r0[0]) >= Math.abs(r1[1] - r0[1]);
  const dims: [number, string][] = firstIsX
    ? [
        [0, `가로 ${formatM(widthMm)}m`],
        [1, `세로 ${formatM(depthMm)}m`],
      ]
    : [
        [0, `세로 ${formatM(depthMm)}m`],
        [1, `가로 ${formatM(widthMm)}m`],
      ];
  const nx = vb.x + vb.w - text * 1.6;
  const ny = vb.y + text * 2.2;
  return (
    <svg
      viewBox={viewBoxAttr(vb)}
      role="img"
      aria-label={`대지 경계 그림: 꼭짓점 ${outer.length}개, 가로 ${formatM(widthMm)}m, 세로 ${formatM(depthMm)}m, 위쪽이 북쪽`}
      preserveAspectRatio="xMidYMid meet"
      className="aspect-4/3 w-full rounded-panel border border-line bg-viewport"
    >
      <polygon points={pointsAttr(rect)} className="fill-none stroke-fg-3 [stroke-dasharray:var(--line-dash-setback)]" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <polygon points={pointsAttr(outer)} className="fill-room stroke-site-line [stroke-dasharray:var(--line-dash-site)]" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {outer.length <= EDGE_LABEL_MAX
        ? outer.map((p, i) => {
            const [x, y, anchor] = edgeLabelPos(outer, i, text * 0.8);
            return (
              <text key={`e${i}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="fill-fg-2" fontSize={text * 0.7}>
                {formatM(len(p, outer[(i + 1) % outer.length] as Point))}
              </text>
            );
          })
        : null}
      {dims.map(([i, label]) => {
        // 바깥쪽에 붙이므로 세로에 가까운 변은 정렬을 뒤집는다(edgeLabelPos는 안쪽 기준).
        const [x, y, inward] = edgeLabelPos(rect, i, -text * 1.1);
        const anchor = inward === "start" ? "end" : inward === "end" ? "start" : "middle";
        return (
          <text key={`d${i}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="fill-fg" fontSize={text * 0.8}>
            {label}
          </text>
        );
      })}
      <g aria-hidden="true">
        <line x1={nx} y1={ny + text} x2={nx} y2={ny - text} className="stroke-fg" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <polygon points={`${nx},${ny - text * 1.4} ${nx - text * 0.4},${ny - text * 0.6} ${nx + text * 0.4},${ny - text * 0.6}`} className="fill-fg" />
        <text x={nx} y={ny + text * 1.9} textAnchor="middle" dominantBaseline="middle" className="fill-fg" fontSize={text * 0.8}>
          N
        </text>
      </g>
    </svg>
  );
}
