// 제안 후보 바닥 미리보기(평면 SVG, 순수 표시): 대지 경계(1점 쇄선 대신 실선) + 후보 바닥 + 정북 화살표.
// 좌표는 엔진이 낸 mm 정수를 그대로 그린다(여기서 기하를 만들지 않는다). 색·선 굵기는 토큰 유틸리티만.
import type { Point } from "@arch-studio/domain";

export interface PlanPreviewProps {
  readonly site: readonly Point[];
  readonly footprints: readonly (readonly Point[])[];
  readonly northAngleDeg: number;
  readonly label: string;
}

/** 경계 상자 + 여백. y는 위쪽이 +Y라 SVG에서 뒤집는다. */
export function planViewBox(points: readonly Point[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const pad = Math.max(x1 - x0, y1 - y0, 1) * 0.08;
  return { x: x0 - pad, y: -(y1 + pad), w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

const path = (ring: readonly Point[]): string => ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${-y}`).join(" ") + " Z";

export function PlanPreview({ site, footprints, northAngleDeg, label }: PlanPreviewProps) {
  if (site.length < 3) return null;
  const vb = planViewBox(site);
  const size = Math.max(vb.w, vb.h);
  const r = size * 0.07; // 화살표 길이
  const cx = vb.x + vb.w - r * 1.6;
  const cy = vb.y + r * 1.9;
  return (
    <svg role="img" aria-label={label} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-40 w-full rounded-control border border-line bg-viewport" preserveAspectRatio="xMidYMid meet">
      <path d={path(site)} className="fill-none stroke-site-line stroke-1" vectorEffect="non-scaling-stroke" />
      {footprints.map((f, i) => (
        <path key={i} d={path(f)} className="fill-mass stroke-mass-edge stroke-1" vectorEffect="non-scaling-stroke" />
      ))}
      {/* 정북: 모델 +Y에서 시계 방향 각도. */}
      <g transform={`translate(${cx} ${cy}) rotate(${northAngleDeg})`} className="stroke-fg-2" aria-hidden="true">
        <path d={`M0 ${r} L0 ${-r} M0 ${-r} L${-r * 0.3} ${-r * 0.4} M0 ${-r} L${r * 0.3} ${-r * 0.4}`} className="fill-none stroke-1" vectorEffect="non-scaling-stroke" />
      </g>
      <text x={cx} y={cy + r * 1.9} textAnchor="middle" className="fill-fg-2" fontSize={size * 0.06} aria-hidden="true">
        북
      </text>
    </svg>
  );
}
