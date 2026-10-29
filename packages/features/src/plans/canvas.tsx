// 평면 캔버스(03장 3.7절 RoomPolygonEditor): 층 외곽·실·문창을 SVG로 그리고 포인터 조작을 편집기 동작으로 번역한다.
// 키보드 조작은 index.tsx의 문서 단축키(keys.ts)가 맡는다 — 포인터 전용 기능은 없다(6.1절). 색·크기는 토큰 유틸리티만.
// 표시용 좌표 변환만 하며 모든 모델 변경은 ops.ts 연산을 거친다. 문자열은 React 기본 이스케이프만 쓴다.
import type { Point, Polygon } from "@arch-studio/domain";
import type { FloorLayout } from "@arch-studio/layout";
import { useId, useRef, type PointerEvent } from "react";
import type { Tool } from "./editor.ts";
import { m2Text } from "./format.ts";
import type { Analysis } from "./model.ts";
import type { Selection } from "./ops.ts";
import { labelAt, nearestEdge, openingEnds, planViewBox, pointsAttr, svgToModel, textSize, viewBoxAttr, type EdgeHit } from "./view.ts";

export interface CanvasProps {
  outline: readonly Polygon[];
  layout: FloorLayout;
  analysis: Analysis;
  sel: Selection;
  tool: Tool;
  draw: readonly Point[];
  cursor: Point;
  /** 그리드 간격(mm). 스냅 끄면 1. */
  grid: number;
  edit: boolean;
  /** 접근성 이름(선택 요약 포함). */
  label: string;
  onPick(sel: Selection): void;
  onDrawPoint(p: Point): void;
  onPlace(hit: EdgeHit, kind: "door" | "window"): void;
  onSplitAt(room_id: string, p: Point): void;
  onMergeWith(room_id: string): void;
  onDragStart(): void;
  onDragEdge(dx: number, dy: number): void;
}

type Drag = { room: string; edge: number; last: Point };

export function PlanCanvas(p: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const hatchId = `hatch-${useId().replace(/:/g, "")}`;
  const vb = planViewBox(p.outline, p.layout);
  const text = textSize(vb);

  const model = (e: PointerEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return svgToModel(q.x, q.y, p.grid);
  };

  function down(e: PointerEvent<SVGSVGElement>) {
    const target = e.target as Element;
    const pt = model(e);
    if (!pt) return;
    const opening = target.closest("[data-opening]")?.getAttribute("data-opening");
    const roomId = target.closest("[data-room]")?.getAttribute("data-room") ?? null;
    const edgeAttr = target.closest("[data-edge]")?.getAttribute("data-edge");
    if (p.tool === "select") {
      if (opening) return p.onPick({ kind: "opening", id: opening });
      if (edgeAttr !== undefined && edgeAttr !== null && roomId) {
        const edge = Number(edgeAttr);
        p.onPick({ kind: "room", id: roomId, edge });
        if (p.edit) {
          drag.current = { room: roomId, edge, last: pt };
          p.onDragStart();
          svgRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      return p.onPick(roomId ? { kind: "room", id: roomId, edge: null } : { kind: "none" });
    }
    if (!p.edit) return;
    if (p.tool === "room") return p.onDrawPoint(pt);
    if (p.tool === "door" || p.tool === "window") {
      const m = svgRef.current?.getScreenCTM();
      const exact = m ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()) : null;
      const hit = exact ? nearestEdge(p.layout, [Math.round(exact.x), Math.round(-exact.y)], text * 2) : null;
      if (hit) p.onPlace(hit, p.tool);
      return;
    }
    if (roomId) {
      if (p.tool === "split") p.onSplitAt(roomId, pt);
      else if (p.tool === "merge") p.onMergeWith(roomId);
    }
  }

  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const pt = model(e);
    if (!pt) return;
    const dx = pt[0] - d.last[0];
    const dy = pt[1] - d.last[1];
    if (dx === 0 && dy === 0) return;
    drag.current = { ...d, last: pt };
    p.onDragEdge(dx, dy);
  }

  function up() {
    drag.current = null;
  }

  const cursorClass = !p.edit ? "" : p.tool === "room" ? "cursor-crosshair" : p.tool === "select" ? "" : "cursor-pointer";
  const grid1m: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const step = 1_000;
  for (let x = Math.ceil(vb.x / step) * step; x <= vb.x + vb.w; x += step) grid1m.push({ x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h });
  for (let y = Math.ceil(vb.y / step) * step; y <= vb.y + vb.h; y += step) grid1m.push({ x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y });

  const selRoom = p.sel.kind === "room" ? p.layout.rooms.find((r) => r.id === (p.sel as { id: string }).id) : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBoxAttr(vb)}
      role="img"
      aria-label={p.label}
      preserveAspectRatio="xMidYMid meet"
      className={`aspect-4/3 w-full touch-none rounded-panel border border-line bg-viewport select-none ${cursorClass}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <defs>
        <pattern id={hatchId} patternUnits="userSpaceOnUse" width={text * 0.8} height={text * 0.8} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={text * 0.8} className="stroke-danger" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </pattern>
      </defs>
      <g className="stroke-grid" aria-hidden="true">
        {grid1m.map((l, i) => (
          <line key={i} {...l} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      {p.outline.map((o, i) => (
        <polygon key={`o${i}`} points={pointsAttr(o.outer)} className="fill-none stroke-site-line [stroke-dasharray:var(--line-dash-site)]" strokeWidth={1.5} vectorEffect="non-scaling-stroke" aria-hidden="true" />
      ))}
      {p.layout.rooms.map((r) => {
        const bad = p.analysis.badRooms.has(r.id);
        const selected = p.sel.kind === "room" && p.sel.id === r.id;
        const row = p.analysis.rows.get(r.id);
        const [lx, ly] = labelAt(r.polygon);
        return (
          <g key={r.id} data-room={r.id}>
            <polygon points={pointsAttr(r.polygon.outer)} className={`fill-room ${bad ? "stroke-danger" : selected ? "stroke-selection" : "stroke-fg-2"}`} strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
            {bad ? <polygon points={pointsAttr(r.polygon.outer)} fill={`url(#${hatchId})`} className="pointer-events-none" /> : null}
            <text x={lx} y={-ly - text * 0.2} textAnchor="middle" className="pointer-events-none fill-fg" fontSize={text} fontWeight={600}>
              {r.name}
            </text>
            <text x={lx} y={-ly + text * 1.1} textAnchor="middle" className="pointer-events-none fill-fg-2" fontSize={text * 0.85}>
              {row ? `${m2Text(row.area_h100)}㎡` : ""}
            </text>
          </g>
        );
      })}
      {p.layout.openings.map((o) => {
        const ends = openingEnds(p.layout, o);
        if (!ends) return null;
        const selected = p.sel.kind === "opening" && p.sel.id === o.id;
        const bad = p.analysis.badOpenings.has(o.id);
        const cls = bad ? "stroke-danger" : selected ? "stroke-selection" : o.kind === "door" ? "stroke-fg" : "stroke-setback";
        const [a, b] = ends;
        return (
          <g key={o.id} data-opening={o.id}>
            <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className="stroke-transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
            <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className={cls} strokeWidth={selected ? 7 : 5} strokeLinecap="butt" strokeDasharray={o.kind === "window" ? "2 2" : undefined} vectorEffect="non-scaling-stroke" />
            <text x={(a[0] + b[0]) / 2} y={-(a[1] + b[1]) / 2 - text * 0.8} textAnchor="middle" className="pointer-events-none fill-fg-2" fontSize={text * 0.75}>
              {o.kind === "door" ? "문" : "창"} {o.width_mm}
            </text>
          </g>
        );
      })}
      {p.edit && selRoom && p.tool === "select"
        ? selRoom.polygon.outer.map((a, i) => {
            const b = selRoom.polygon.outer[(i + 1) % selRoom.polygon.outer.length] as Point;
            const active = p.sel.kind === "room" && p.sel.edge === i;
            return (
              <g key={`e${i}`} data-room={selRoom.id} data-edge={i} className="cursor-move">
                <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className="stroke-transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" />
                {active ? <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className="stroke-selection" strokeWidth={5} vectorEffect="non-scaling-stroke" /> : null}
              </g>
            );
          })
        : null}
      {selRoom && !p.edit && p.sel.kind === "room" && p.sel.edge !== null
        ? (() => {
            const a = selRoom.polygon.outer[p.sel.edge] as Point;
            const b = selRoom.polygon.outer[(p.sel.edge + 1) % selRoom.polygon.outer.length] as Point;
            return <line x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} className="stroke-selection" strokeWidth={5} vectorEffect="non-scaling-stroke" />;
          })()
        : null}
      {p.tool === "room" && p.edit ? (
        <g aria-hidden="true">
          {p.draw.length > 0 ? <polyline points={pointsAttr([...p.draw, p.cursor])} className="fill-none stroke-selection [stroke-dasharray:var(--line-dash-setback)]" strokeWidth={2} vectorEffect="non-scaling-stroke" /> : null}
          {p.draw.map((q, i) => (
            <rect key={i} x={q[0] - text * 0.25} y={-q[1] - text * 0.25} width={text * 0.5} height={text * 0.5} className="fill-surface stroke-selection" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          ))}
          <g className="stroke-selection" strokeWidth={1.5}>
            <line x1={p.cursor[0] - text} y1={-p.cursor[1]} x2={p.cursor[0] + text} y2={-p.cursor[1]} vectorEffect="non-scaling-stroke" />
            <line x1={p.cursor[0]} y1={-p.cursor[1] - text} x2={p.cursor[0]} y2={-p.cursor[1] + text} vectorEffect="non-scaling-stroke" />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
