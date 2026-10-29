// 대지 화면 하위 컴포넌트(03장 3.4절): 2D 대지 뷰(SVG, 3D 아님)·좌표 표·후보 목록·단위 확인 대화상자·면적 표시.
// 색·크기는 토큰 유틸리티만(stroke-site-line·[stroke-dasharray:var(--line-dash-site)] 등). 문자열은 React 기본 이스케이프만 쓴다.
import type { Point } from "@arch-studio/domain";
import type { DxfUnit } from "@arch-studio/io";
import { Badge, Banner, Button, Dialog, IconButton, Input } from "@arch-studio/ui";
import { useId, useRef, useState, type PointerEvent } from "react";
import { UNIT_LABEL, type DxfFlow, unitChoices } from "./dxf-flow.ts";
import { formatM, formatMm, parseMmInput, siteMetrics, type SiteCandidateView } from "./model.ts";
import { EMPTY_VIEW, edgeLabelPos, gridLines, modelToSvg, pointsAttr, scaleOf, svgToModel, viewBoxAttr, viewBoxFor } from "./view.ts";

export interface SiteCanvasProps {
  outer: readonly Point[];
  roads: Readonly<Record<number, number>>;
  northAngleDeg: number;
  /** 확인 전 후보(조회·DXF). 실선 대신 선택색 파선으로 겹쳐 보인다. */
  candidate?: readonly Point[] | null;
  /** 그리기 중: 클릭하면 꼭짓점 추가(열린 선으로 표시). */
  drawing?: boolean;
  onAddPoint?: (p: Point) => void;
}

/** 2D 대지 뷰: 경계(1점 쇄선)·변 번호·도로 폭·정북 화살표·꼭짓점. */
export function SiteCanvas({ outer, roads, northAngleDeg, candidate, drawing = false, onAddPoint }: SiteCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const all = [...outer, ...(candidate ?? [])];
  // 그리는 동안 viewBox를 고정한다: 점마다 범위를 다시 맞추면 다음 클릭의 좌표 기준이 바뀐다.
  const frozen = useRef<ReturnType<typeof viewBoxFor> | null>(null);
  if (drawing && frozen.current === null) frozen.current = outer.length === 0 ? EMPTY_VIEW : viewBoxFor(all);
  if (!drawing) frozen.current = null;
  const vb = frozen.current ?? viewBoxFor(all);
  const { text, handle } = scaleOf(vb);
  const closed = !drawing && outer.length >= 3;

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!drawing || !onAddPoint) return;
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    onAddPoint(svgToModel(p.x, p.y));
  }

  // 정북 화살표: 오른쪽 위 구석, north_angle_deg = +Y에서 시계 방향(rules/envelope/north.ts 규약). 회전은 SVG transform.
  const nx = vb.x + vb.w - text * 2;
  const ny = vb.y + text * 2.4;
  const label = drawing
    ? "대지 경계 그리기: 클릭하면 꼭짓점이 100mm 격자에 맞춰 추가됩니다. 키보드는 아래 좌표 표를 쓰세요."
    : `대지 경계 2D 보기: 꼭짓점 ${outer.length}개${candidate ? ", 확인 전 후보 겹쳐 보기" : ""}`;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBoxAttr(vb)}
      role={drawing ? "group" : "img"}
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
      className={`aspect-4/3 w-full touch-none rounded-panel border border-line bg-viewport ${drawing ? "cursor-crosshair" : ""}`}
      onPointerUp={onPointerUp}
    >
      {drawing ? (
        <g className="stroke-grid" aria-hidden="true">
          {gridLines(vb).map((l, i) => (
            <line key={`g${i}`} {...l} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ) : null}
      {closed ? (
        <polygon points={pointsAttr(outer)} className="fill-room stroke-site-line [stroke-dasharray:var(--line-dash-site)]" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : outer.length > 0 ? (
        <polyline points={pointsAttr(outer)} className="fill-none stroke-site-line" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ) : null}
      {candidate && candidate.length >= 3 ? (
        <polygon points={pointsAttr(candidate)} className="fill-none stroke-selection [stroke-dasharray:var(--line-dash-setback)]" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : null}
      {closed
        ? outer.map((_, i) => {
            const [mx, my, anchor] = edgeLabelPos(outer, i, text * 0.9);
            const w = roads[i];
            return (
              <g key={`e${i}`}>
                {w ? (
                  <line
                    x1={modelToSvg(outer[i] as Point)[0]}
                    y1={modelToSvg(outer[i] as Point)[1]}
                    x2={modelToSvg(outer[(i + 1) % outer.length] as Point)[0]}
                    y2={modelToSvg(outer[(i + 1) % outer.length] as Point)[1]}
                    className="stroke-setback"
                    strokeWidth={5}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                <text x={mx} y={my} textAnchor={anchor} dominantBaseline="middle" className="fill-fg-2" fontSize={text * 0.8}>
                  {w ? `변 ${i + 1} · 도로 ${formatM(w)}m` : `변 ${i + 1}`}
                </text>
              </g>
            );
          })
        : null}
      {outer.map((p, i) => {
        const [x, y] = modelToSvg(p);
        return <rect key={`v${i}`} x={x - handle / 2} y={y - handle / 2} width={handle} height={handle} className="fill-surface stroke-fg" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
      <g transform={`rotate(${northAngleDeg} ${nx} ${ny})`} aria-hidden="true">
        <line x1={nx} y1={ny + text} x2={nx} y2={ny - text} className="stroke-fg" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <polygon points={`${nx},${ny - text * 1.4} ${nx - text * 0.4},${ny - text * 0.6} ${nx + text * 0.4},${ny - text * 0.6}`} className="fill-fg" />
        <text x={nx} y={ny + text * 1.9} textAnchor="middle" dominantBaseline="middle" className="fill-fg" fontSize={text * 0.8}>
          N
        </text>
      </g>
    </svg>
  );
}

/** 면적·둘레·꼭짓점 수(geometry 계산 결과). */
export function MetricsReadout({ outer }: { outer: readonly Point[] }) {
  const m = siteMetrics(outer);
  return (
    <dl className="grid grid-cols-3 gap-2 text-caption">
      <div>
        <dt className="text-fg-3">대지 면적</dt>
        <dd className="text-num font-medium text-fg tabular-nums">{m ? `${m.area_m2_text}㎡` : "-"}</dd>
      </div>
      <div>
        <dt className="text-fg-3">둘레</dt>
        <dd className="text-num font-medium text-fg tabular-nums">{m ? `${formatM(m.perimeter_mm)}m` : "-"}</dd>
      </div>
      <div>
        <dt className="text-fg-3">꼭짓점</dt>
        <dd className="text-num font-medium text-fg tabular-nums">{formatMm(outer.length)}개</dd>
      </div>
    </dl>
  );
}

/** 좌표 표(키보드 입력 경로). x·y는 mm 정수(소수는 half-away 반올림). */
export function CoordinateTable({
  outer,
  disabled,
  onChange,
  onRemove,
  onAdd,
}: {
  outer: readonly Point[];
  disabled: boolean;
  onChange: (i: number, p: Point) => void;
  onRemove: (i: number) => void;
  onAdd: (p: Point) => void;
}) {
  const id = useId();
  const [nx, setNx] = useState("");
  const [ny, setNy] = useState("");
  const addX = parseMmInput(nx);
  const addY = parseMmInput(ny);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-x-auto rounded-control border border-line">
        <table className="w-full text-body">
          <caption className="sr-only">대지 경계 꼭짓점 좌표(mm)</caption>
          <thead className="bg-raised text-caption text-fg-2">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                번호
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                X (mm)
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                Y (mm)
              </th>
              <th scope="col" className="px-2 py-1">
                <span className="sr-only">삭제</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {outer.map((p, i) => (
              <tr key={i} className="border-t border-line">
                <th scope="row" className="px-2 py-1 text-left text-caption font-medium text-fg-2">
                  {i + 1}
                </th>
                {[0, 1].map((axis) => (
                  <td key={axis} className="px-1 py-1">
                    <CoordCell
                      label={`${i + 1}번 ${axis === 0 ? "X" : "Y"}`}
                      value={p[axis] as number}
                      disabled={disabled}
                      onCommit={(v) => onChange(i, axis === 0 ? [v, p[1]] : [p[0], v])}
                    />
                  </td>
                ))}
                <td className="px-1 py-1 text-right">
                  <IconButton icon="x" label={`${i + 1}번 꼭짓점 삭제`} size="sm" disabled={disabled} onClick={() => onRemove(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (addX === null || addY === null) return;
          onAdd([addX, addY]);
          setNx("");
          setNy("");
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-fg-2" htmlFor={`${id}-x`}>
          새 꼭짓점 X
          <Input id={`${id}-x`} size={6} inputMode="numeric" suffix="mm" value={nx} disabled={disabled} onChange={(e) => setNx(e.target.value)} invalid={nx !== "" && addX === null} />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-fg-2" htmlFor={`${id}-y`}>
          새 꼭짓점 Y
          <Input id={`${id}-y`} size={6} inputMode="numeric" suffix="mm" value={ny} disabled={disabled} onChange={(e) => setNy(e.target.value)} invalid={ny !== "" && addY === null} />
        </label>
        <Button type="submit" icon="plus" disabled={disabled || addX === null || addY === null}>
          꼭짓점 추가
        </Button>
      </form>
    </div>
  );
}

function CoordCell({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : parseMmInput(draft);
  const commit = () => {
    if (draft !== null && parsed !== null && parsed !== value) onCommit(parsed);
    setDraft(null);
  };
  return (
    <Input
      aria-label={`${label} (mm)`}
      inputMode="numeric"
      size={8}
      className="text-right tabular-nums"
      value={draft ?? formatMm(value)}
      invalid={parsed === null}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** 후보 목록(조회 1건 또는 DXF 여러 건). 고른 후보를 "이 경계 쓰기"로 확정해야 초안에 들어간다. */
export function CandidateList({
  candidates,
  selected,
  onSelect,
  onApply,
  onDiscard,
  notice,
  warning,
  disabled,
}: {
  candidates: readonly SiteCandidateView[];
  selected: number;
  onSelect: (i: number) => void;
  onApply: () => void;
  onDiscard: () => void;
  notice: string;
  warning?: string | null;
  disabled: boolean;
}) {
  const name = useId();
  return (
    <section aria-labelledby={`${name}-t`} className="flex flex-col gap-gap rounded-panel border border-selection bg-surface p-pad">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`${name}-t`} className="text-h2 font-semibold text-fg">
          후보 확인
        </h2>
        <Badge tone="info" icon="info">
          입력 후보
        </Badge>
      </div>
      <p className="text-body text-fg-2">{notice}</p>
      {warning ? (
        <Banner tone="warn" title="건너뛴 요소가 있습니다">
          {warning}
        </Banner>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">대지 경계 후보</legend>
        {candidates.map((c, i) => (
          <label
            key={`${c.origin}-${i}`}
            className="focus-ring-within flex cursor-pointer items-start gap-2 rounded-control border border-line p-2 has-checked:border-selection has-checked:bg-raised"
          >
            <input type="radio" name={name} className="mt-1" checked={selected === i} onChange={() => onSelect(i)} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-fg">{c.label}</span>
              {c.unit_text || c.extent_mm ? (
                <span className="text-caption font-medium text-fg tabular-nums">
                  {c.unit_text ?? ""}
                  {c.unit_text && c.extent_mm ? " · " : ""}
                  {c.extent_mm ? `외접 ${formatM(c.extent_mm[0])}m × ${formatM(c.extent_mm[1])}m` : ""}
                </span>
              ) : null}
              <span className="text-caption text-fg-2 tabular-nums">
                면적 {siteMetrics(c.outer)?.area_m2_text ?? "-"}㎡ · 둘레 {formatM(c.perimeter_mm)}m · 꼭짓점 {formatMm(c.outer.length)}개
                {c.use_district ? ` · ${c.use_district}` : ""}
              </span>
              {c.notes.map((n) => (
                <span key={n} className="text-caption text-fg-3">
                  {n}
                </span>
              ))}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="check" disabled={disabled || candidates.length === 0} onClick={onApply}>
          이 경계 쓰기
        </Button>
        <Button variant="ghost" onClick={onDiscard}>
          버리기
        </Button>
      </div>
    </section>
  );
}

/** 단위 확인 대화상자(AR053·범위 추정). 닫으면 가져오기를 취소한다(조용히 추정하지 않음). */
export function UnitDialog({ flow, onChoose, onCancel }: { flow: DxfFlow; onChoose: (u: DxfUnit) => void; onCancel: () => void }) {
  const open = flow.step === "ask_unit" || flow.step === "confirm_unit";
  const message = open ? flow.message : "";
  const choices = unitChoices(flow);
  const extentOf = (u: DxfUnit): string | null => {
    if (flow.step !== "ask_unit" && flow.step !== "confirm_unit") return null;
    const o = flow.options.find((x) => x.unit === u);
    return o ? `가장 긴 변 ${formatM(o.reference_extent_mm)}m${o.plausible ? " · 대지로 그럴듯함" : ""}` : null;
  };
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="도면 단위 확인"
      description={message}
      footer={
        <Button variant="ghost" onClick={onCancel}>
          가져오기 취소
        </Button>
      }
    >
      <div className="flex flex-col gap-2" role="group" aria-label="도면 단위">
        {choices.map((u) => (
          <Button key={u} variant={flow.step === "confirm_unit" && flow.unit === u ? "primary" : "secondary"} onClick={() => onChoose(u)} className="justify-between">
            <span>{UNIT_LABEL[u]}</span>
            {extentOf(u) ? <span className="text-caption">{extentOf(u)}</span> : null}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
