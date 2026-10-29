"use client";
/* CAD형 제품 컴포넌트(03_SCREENS_UX 3.19). 화면 표시 전용: 기하·판정 값은 엔진이 만든 입력을 받기만 한다.
   3D·SVG 색은 --color-viewport/grid/site-line/setback/mass/... 토큰. DXF 출력 색은 ACI 번호(숫자)로만 다루고 화면 색으로 바꾸지 않는다. */
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn, formatInt } from "./cn";
import { Badge, Button, Checkbox, Field, IconButton, Input, Kbd, Select, Table, Banner, type Tone } from "./basic";
import { Dialog, NumberInput, Tooltip } from "./interactive";
import { Icon, type IconName } from "./icons";

/* ---------- JudgmentBadge: 색 + 아이콘 + 글자(색만으로 구분하지 않음) ---------- */
export type JudgmentStatus = "pass" | "warn" | "fail";
const JUDGMENT: Record<JudgmentStatus, { tone: Tone; icon: IconName; code: string; label: string }> = {
  pass: { tone: "ok", icon: "circle-check", code: "PASS", label: "통과" },
  warn: { tone: "warn", icon: "triangle-alert", code: "WARN", label: "확인 필요" },
  fail: { tone: "danger", icon: "circle-x", code: "FAIL", label: "기준 초과" },
};

export function JudgmentBadge({ status }: { status: JudgmentStatus }) {
  const j = JUDGMENT[status];
  return (
    <Badge tone={j.tone} icon={j.icon}>
      <span className="font-mono">{j.code}</span>
      {j.label}
    </Badge>
  );
}

/* ---------- RuleCitation: 조항 · 시행일 · 규칙 팩 버전 칩 ---------- */
export type Citation = { article: string; effectiveDate: string; packVersion: string };

export function RuleCitation({ article, effectiveDate, packVersion }: Citation) {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-sm border border-line bg-raised px-1.5 py-0.5 text-caption text-fg-2">
      <Icon name="book-open" className="size-3.5" />
      <span className="font-medium text-fg">{article}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">시행 {effectiveDate}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono">규칙 팩 {packVersion}</span>
    </span>
  );
}

/* ---------- JudgmentPanel ---------- */
export type JudgmentItem = {
  id: string;
  label: string;
  status: JudgmentStatus;
  actual: number;
  limit: number;
  unit: string;
  citation: Citation;
};

export function JudgmentPanel({ title = "법규 판정", items }: { title?: string; items: JudgmentItem[] }) {
  const count = (s: JudgmentStatus) => items.filter((i) => i.status === s).length;
  return (
    <section aria-label={title} className="flex flex-col rounded-panel border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-pad">
        <h3 className="text-h2 font-semibold text-fg">{title}</h3>
        <div className="flex flex-wrap gap-1.5 text-caption text-fg-2">
          <span>통과 {count("pass")}</span>
          <span>· 확인 필요 {count("warn")}</span>
          <span>· 기준 초과 {count("fail")}</span>
        </div>
      </header>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.id} className="flex flex-col gap-1.5 px-pad py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body font-medium text-fg">{it.label}</span>
              <JudgmentBadge status={it.status} />
            </div>
            <p className="text-num text-fg-2 tabular-nums">
              {formatInt(it.actual)} / 기준 {formatInt(it.limit)} {it.unit}
            </p>
            <RuleCitation {...it.citation} />
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-pad py-2 text-caption text-fg-3">
        판정은 입력한 대지·규칙 팩 기준의 참고 결과이며 인허가 결과를 대신하지 않습니다.
      </p>
    </section>
  );
}

/* ---------- FallbackBanner: 업데이트 만료 시 마지막 규칙 팩으로 동작 ---------- */
export function FallbackBanner({ packVersion, action }: { packVersion: string; action?: ReactNode }) {
  return (
    <Banner tone="warn" title="업데이트 기간이 끝나 마지막 규칙 팩으로 판정합니다" action={action}>
      현재 규칙 팩 <span className="font-mono">{packVersion}</span>. 이후 개정된 법규는 반영되지 않습니다.
    </Banner>
  );
}

/* ---------- OfflineIndicator ---------- */
export function OfflineIndicator({ online }: { online: boolean }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-1.5 text-caption font-medium", online ? "text-fg-2" : "text-warn")}>
      <Icon name={online ? "wifi" : "wifi-off"} className="size-3.5" />
      {online ? "온라인" : "오프라인: 로컬 판정만 가능"}
    </span>
  );
}

/* ---------- LayerPanel: 표시·잠금 토글, 들여쓰기 트리 ---------- */
export type LayerNode = { id: string; name: string; visible: boolean; locked: boolean; children?: LayerNode[] };

function updateLayer(nodes: LayerNode[], id: string, key: "visible" | "locked"): LayerNode[] {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, [key]: !n[key] }
      : n.children
        ? { ...n, children: updateLayer(n.children, id, key) }
        : n,
  );
}

type FlatLayer = { node: LayerNode; level: number; parentId: string | null; posinset: number; setsize: number };

/** 펼친 노드만 화면 순서대로 편다(aria-level·posinset·setsize 포함). */
function flattenLayers(nodes: LayerNode[], expanded: Set<string>, level = 1, parentId: string | null = null, out: FlatLayer[] = []): FlatLayer[] {
  nodes.forEach((node, i) => {
    out.push({ node, level, parentId, posinset: i + 1, setsize: nodes.length });
    if (node.children && expanded.has(node.id)) flattenLayers(node.children, expanded, level + 1, node.id, out);
  });
  return out;
}

function parentIds(nodes: LayerNode[], out: string[] = []): string[] {
  nodes.forEach((n) => {
    if (n.children) {
      out.push(n.id);
      parentIds(n.children, out);
    }
  });
  return out;
}

/** WAI-ARIA tree 패턴: roving tabindex, ↑↓ 이동, → 펼침/첫 자식, ← 접기/부모, Home/End. */
export function LayerPanel({ defaultLayers }: { defaultLayers: LayerNode[] }) {
  const [layers, setLayers] = useState(defaultLayers);
  const [expanded, setExpanded] = useState(() => new Set(parentIds(defaultLayers)));
  const [focusedId, setFocusedId] = useState(defaultLayers[0]?.id ?? "");
  const refs = useRef(new Map<string, HTMLDivElement>());
  const toggle = (id: string, key: "visible" | "locked") => setLayers((ls) => updateLayer(ls, id, key));
  const flat = flattenLayers(layers, expanded);
  // 접혀서 사라진 항목에 포커스 표시가 남으면 탭 진입점이 없어지므로 첫 항목으로 되돌린다.
  const activeId = flat.some((f) => f.node.id === focusedId) ? focusedId : flat[0]?.node.id;

  function setOpen(id: string, open: boolean) {
    setExpanded((s) => {
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function focusItem(id: string | null | undefined) {
    if (!id) return;
    setFocusedId(id);
    refs.current.get(id)?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, i: number) {
    if (e.target !== e.currentTarget) return; // 행 안 버튼의 키는 버튼이 처리
    const item = flat[i];
    if (!item) return;
    const { node } = item;
    const isOpen = !!node.children && expanded.has(node.id);
    switch (e.key) {
      case "ArrowDown":
        focusItem(flat[i + 1]?.node.id);
        break;
      case "ArrowUp":
        focusItem(flat[i - 1]?.node.id);
        break;
      case "ArrowRight":
        if (node.children && !isOpen) setOpen(node.id, true);
        else if (isOpen) focusItem(flat[i + 1]?.node.id);
        break;
      case "ArrowLeft":
        if (isOpen) setOpen(node.id, false);
        else focusItem(item.parentId);
        break;
      case "Home":
        focusItem(flat[0]?.node.id);
        break;
      case "End":
        focusItem(flat[flat.length - 1]?.node.id);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <section className="rounded-panel border border-line bg-surface" aria-label="레이어">
      <h3 className="border-b border-line px-pad py-2 text-caption font-semibold text-fg-2">레이어</h3>
      <div role="tree" aria-label="레이어 트리" className="py-1">
        {flat.map(({ node: n, level, posinset, setsize }, i) => {
          const isOpen = !!n.children && expanded.has(n.id);
          const focused = n.id === activeId;
          return (
            <div
              key={n.id}
              ref={(el) => {
                if (el) refs.current.set(n.id, el);
                else refs.current.delete(n.id);
              }}
              role="treeitem"
              aria-level={level}
              aria-posinset={posinset}
              aria-setsize={setsize}
              aria-expanded={n.children ? isOpen : undefined}
              aria-selected={focused}
              tabIndex={focused ? 0 : -1}
              onFocus={(e) => {
                if (e.target === e.currentTarget) setFocusedId(n.id);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn("focus-ring flex h-row items-center gap-1 pr-1 hover:bg-raised aria-selected:bg-raised", !n.visible && "text-fg-3")}
              style={{ paddingInlineStart: `calc(var(--spacing) * ${2 + (level - 1) * 4})` }}
            >
              {n.children ? (
                <span aria-hidden="true" className="cursor-pointer" onClick={() => setOpen(n.id, !isOpen)}>
                  <Icon name="chevron-right" className={cn("size-3.5 text-fg-3 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
                </span>
              ) : (
                <span className="size-3.5" />
              )}
              <span className="flex-1 truncate text-body">{n.name}</span>
              <IconButton
                size="sm"
                tabIndex={focused ? 0 : -1}
                icon={n.visible ? "eye" : "eye-off"}
                label={`${n.name} 표시`}
                pressed={n.visible}
                onClick={() => toggle(n.id, "visible")}
              />
              <IconButton
                size="sm"
                tabIndex={focused ? 0 : -1}
                icon={n.locked ? "lock" : "lock-open"}
                label={`${n.name} 잠금`}
                pressed={n.locked}
                onClick={() => toggle(n.id, "locked")}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- PropertyInspector: 수치 입력 묶음, value=null 이면 "여러 값" ---------- */
export type PropertyField = { id: string; label: string; value: number | null; unit?: string; step?: number };
export type PropertyGroup = { title: string; fields: PropertyField[] };

export function PropertyInspector({ selectionCount, defaultGroups }: { selectionCount: number; defaultGroups: PropertyGroup[] }) {
  const [groups, setGroups] = useState(defaultGroups);
  function set(fieldId: string, value: number) {
    setGroups((gs) => gs.map((g) => ({ ...g, fields: g.fields.map((f) => (f.id === fieldId ? { ...f, value } : f)) })));
  }
  return (
    <section className="flex flex-col rounded-panel border border-line bg-surface" aria-label="속성">
      <header className="flex items-center justify-between border-b border-line px-pad py-2">
        <h3 className="text-caption font-semibold text-fg-2">속성</h3>
        <span className="text-caption text-fg-3">{selectionCount > 1 ? `${selectionCount}개 선택` : "1개 선택"}</span>
      </header>
      {groups.map((g) => (
        <fieldset key={g.title} className="flex flex-col gap-gap border-b border-line p-pad last:border-b-0">
          <legend className="sr-only">{g.title}</legend>
          <p aria-hidden="true" className="text-caption font-semibold text-fg-2">{g.title}</p>
          <div className="grid grid-cols-2 gap-gap">
            {g.fields.map((f) => (
              <Field key={f.id} label={f.label} htmlFor={f.id}>
                <NumberInput id={f.id} value={f.value} unit={f.unit} step={f.step} onChange={(v) => set(f.id, v)} />
              </Field>
            ))}
          </div>
        </fieldset>
      ))}
    </section>
  );
}

/* ---------- MeasureReadout: 뷰포트 위 치수 라벨 (부모가 relative) ---------- */
export function MeasureReadout({
  value,
  unit = "mm",
  x,
  y,
  label,
}: {
  value: number;
  unit?: string;
  /** 부모 기준 위치(%) */
  x: number;
  y: number;
  label?: string;
}) {
  return (
    <span
      className="absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-baseline gap-1 rounded-sm border border-line bg-surface/90 px-1.5 py-0.5 text-num text-fg tabular-nums shadow-pop"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {label ? <span className="text-caption text-fg-3">{label}</span> : null}
      {formatInt(value)}
      <span className="text-caption text-fg-3">{unit}</span>
    </span>
  );
}

/* ---------- ToolBar: 도구 + 단축키 Kbd 툴팁, 좌우 화살표 이동 ---------- */
export type Tool = { id: string; label: string; icon: IconName; shortcut: string };

export function ToolBar({ tools, defaultId, orientation = "horizontal" }: { tools: Tool[]; defaultId?: string; orientation?: "horizontal" | "vertical" }) {
  const [active, setActive] = useState(defaultId ?? tools[0]?.id ?? "");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(e: KeyboardEvent, i: number) {
    const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (e.key !== prev && e.key !== next) return;
    e.preventDefault();
    const n = (i + (e.key === next ? 1 : -1) + tools.length) % tools.length;
    refs.current[n]?.focus();
  }
  return (
    <div
      role="toolbar"
      aria-label="도구"
      aria-orientation={orientation}
      className={cn("inline-flex gap-0.5 rounded-panel border border-line bg-surface p-1 shadow-pop", orientation === "vertical" && "flex-col")}
    >
      {tools.map((t, i) => (
        <Tooltip key={t.id} side={orientation === "horizontal" ? "bottom" : "top"} content={<>{t.label} <Kbd>{t.shortcut}</Kbd></>}>
          <IconButton
            ref={(el) => {
              refs.current[i] = el;
            }}
            icon={t.icon}
            label={t.label}
            pressed={t.id === active}
            tabIndex={t.id === active ? 0 : -1}
            aria-keyshortcuts={t.shortcut}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/* ---------- ViewCube: 투시·평면·단면 전환 ---------- */
export type ViewMode = "perspective" | "plan" | "section";
const VIEWS: Array<{ id: ViewMode; label: string; icon: IconName }> = [
  { id: "perspective", label: "투시", icon: "box" },
  { id: "plan", label: "평면", icon: "square" },
  { id: "section", label: "단면", icon: "section" },
];

export function ViewCube({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="group" aria-label="보기 전환" className="inline-flex rounded-control border border-line bg-surface p-0.5 shadow-pop">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={v.id === value}
          onClick={() => onChange(v.id)}
          className="focus-ring inline-flex h-control-sm items-center gap-1 rounded-control px-2 text-caption text-fg-2 hover:text-fg aria-pressed:bg-accent aria-pressed:text-accent-fg"
        >
          <Icon name={v.icon} className="size-3.5" />
          {v.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- RoomPolygonEditor: 꼭짓점 끌기·화살표 키 이동(100mm 격자 스냅). 좌표 단위 mm ---------- */
export type Point = { x: number; y: number };
const GRID_MM = 100;
/** 실 이름·면적 글자 높이 = 도면 폭 × 비율. 도면 좌표계 단위(mm)이며 UI 글자 토큰이 아니다(뷰박스와 함께 확대·축소). */
const SHEET_TEXT_RATIO = 1 / 28;
const snap = (v: number) => Math.round(v / GRID_MM) * GRID_MM;
/** 표시용 면적(m²). 정식 면적 산정은 엔진(packages/geometry)의 결과를 쓴다. */
function displayArea(pts: Point[]): number {
  let s = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length] ?? p;
    s += p.x * q.y - q.x * p.y;
  });
  return Math.abs(s) / 2 / 1_000_000;
}

export function RoomPolygonEditor({ name, defaultPoints, width, height }: { name: string; defaultPoints: Point[]; width: number; height: number }) {
  const [pts, setPts] = useState(defaultPoints);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  function toSvg(e: PointerEvent): Point | null {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(width, Math.max(0, snap(p.x))), y: Math.min(height, Math.max(0, snap(p.y))) };
  }
  const move = (i: number, p: Point) => setPts((ps) => ps.map((q, j) => (j === i ? p : q)));

  function onKey(e: KeyboardEvent, i: number) {
    const d = e.shiftKey ? GRID_MM * 10 : GRID_MM;
    const cur = pts[i];
    if (!cur) return;
    const delta: Record<string, Point> = { ArrowLeft: { x: -d, y: 0 }, ArrowRight: { x: d, y: 0 }, ArrowUp: { x: 0, y: -d }, ArrowDown: { x: 0, y: d } };
    const dv = delta[e.key];
    if (!dv) return;
    e.preventDefault();
    move(i, { x: Math.min(width, Math.max(0, cur.x + dv.x)), y: Math.min(height, Math.max(0, cur.y + dv.y)) });
  }

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const gridLines = [];
  for (let x = 0; x <= width; x += GRID_MM * 10) gridLines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} />);
  for (let y = 0; y <= height; y += GRID_MM * 10) gridLines.push(<line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} />);
  const handle = width / 60;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${name} 실 윤곽 편집`}
        className="w-full touch-none rounded-panel border border-line bg-viewport"
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = toSvg(e);
          if (p) move(drag.current, p);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <g className="stroke-grid" strokeWidth={width / 400}>{gridLines}</g>
        <polygon
          points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
          className="fill-room stroke-fg"
          strokeWidth={width / 250}
        />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-fg" fontSize={width * SHEET_TEXT_RATIO}>
          {name} {displayArea(pts).toFixed(2)} m²
        </text>
        {pts.map((p, i) => (
          <rect
            key={i}
            x={p.x - handle / 2}
            y={p.y - handle / 2}
            width={handle}
            height={handle}
            tabIndex={0}
            role="button"
            aria-label={`꼭짓점 ${i + 1}: ${formatInt(p.x)}, ${formatInt(p.y)} mm. 화살표 키로 이동`}
            className="focus-ring cursor-move fill-surface stroke-selection"
            strokeWidth={width / 300}
            onPointerDown={(e) => {
              drag.current = i;
              (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
            }}
            onKeyDown={(e) => onKey(e, i)}
          />
        ))}
      </svg>
      <figcaption className="text-caption text-fg-3">꼭짓점을 끌거나 선택 후 화살표 키(Shift = 1m)로 옮깁니다. 격자 100mm 스냅.</figcaption>
    </figure>
  );
}

/* ---------- SheetPreview: SVG 도면 시트 미리보기(A3 가로 비율, 단위 mm) ---------- */
export function SheetPreview({ title, scale, sheetNo }: { title: string; scale: string; sheetNo: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox="0 0 420 297" role="img" aria-label={`${sheetNo} ${title} 미리보기, 축척 ${scale}`} className="w-full rounded-panel border border-line bg-sheet-paper shadow-pop">
        <g className="fill-none stroke-sheet-ink">
          <rect x={10} y={10} width={400} height={277} strokeWidth={0.7} />
          <rect x={300} y={247} width={110} height={40} strokeWidth={0.5} />
          <line x1={300} y1={267} x2={410} y2={267} strokeWidth={0.35} />
        </g>
        {/* 대지 경계: 1점 쇄선 */}
        <polygon points="60,60 260,50 280,220 50,230" className="fill-none stroke-site-line [stroke-dasharray:var(--line-dash-site)]" strokeWidth={0.5} />
        {/* 이격선: 파선 */}
        <polygon points="80,78 242,70 258,202 72,210" className="fill-none stroke-setback [stroke-dasharray:var(--line-dash-setback)]" strokeWidth={0.35} />
        {/* 매스 */}
        <rect x={110} y={100} width={110} height={80} className="fill-mass stroke-mass-edge" strokeWidth={0.5} />
        <g className="fill-sheet-ink">
          <text x={305} y={260} fontSize={7}>{title}</text>
          <text x={305} y={280} fontSize={5}>축척 {scale}</text>
          <text x={405} y={280} fontSize={5} textAnchor="end">{sheetNo}</text>
        </g>
      </svg>
      <figcaption className="text-caption text-fg-3">화면 미리보기는 테마 토큰을 따르고, DXF 파일 색은 ACI 번호로 고정됩니다.</figcaption>
    </figure>
  );
}

/* ---------- CreditCost: 실행 전 차감 크레딧 표시(정수) ---------- */
export function CreditCost({ cost, balance }: { cost: number; balance: number }) {
  const short = balance < cost;
  return (
    <p className={cn("inline-flex flex-wrap items-center gap-1.5 text-caption", short ? "text-danger" : "text-fg-2")}>
      <Icon name={short ? "circle-x" : "coins"} className="size-3.5" />
      <span>
        실행 시 <b className="text-num tabular-nums">{formatInt(cost)}</b> 크레딧 차감
      </span>
      <span className="tabular-nums">
        · 잔액 {formatInt(balance)}
        {short ? " (부족)" : ` → ${formatInt(balance - cost)}`}
      </span>
    </p>
  );
}

/* ---------- ExportDialog ---------- */
export function ExportDialog({ open, onClose, cost, balance }: { open: boolean; onClose: () => void; cost: number; balance: number }) {
  const [format, setFormat] = useState("dxf");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="도면 내보내기"
      description="선택한 시트를 파일로 저장합니다."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button variant="primary" icon="download" onClick={onClose}>내보내기</Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        <Field label="형식" htmlFor="export-format">
          <Select id="export-format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="dxf">DXF (레이어·ACI 색 고정)</option>
            <option value="pdf">PDF</option>
            <option value="svg">SVG</option>
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-caption font-medium text-fg-2">시트</legend>
          <Checkbox label="A-101 배치도" defaultChecked />
          <Checkbox label="A-102 면적 산정도" defaultChecked />
          <Checkbox label="A-301 단면도" />
        </fieldset>
        {format === "pdf" ? <CreditCost cost={cost} balance={balance} /> : null}
      </div>
    </Dialog>
  );
}

/* ---------- TitleBlockEditor: 표제란 항목 입력 + 미리보기 ---------- */
export type TitleBlock = { office: string; project: string; drawing: string; scale: string; author: string; date: string };
const TB_FIELDS: Array<{ key: keyof TitleBlock; label: string }> = [
  { key: "office", label: "사무소명" },
  { key: "project", label: "프로젝트명" },
  { key: "drawing", label: "도면명" },
  { key: "scale", label: "축척" },
  { key: "author", label: "작성자" },
  { key: "date", label: "작성일" },
];

export function TitleBlockEditor({ defaultValue }: { defaultValue: TitleBlock }) {
  const [tb, setTb] = useState(defaultValue);
  return (
    <div className="grid gap-gap xl:grid-cols-2">
      <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
        {TB_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`tb-${f.key}`}>
            <Input id={`tb-${f.key}`} value={tb[f.key]} onChange={(e) => setTb({ ...tb, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <dl aria-label="표제란 미리보기" className="grid grid-cols-2 self-start border border-sheet-ink bg-sheet-paper text-caption text-sheet-ink">
        {TB_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col border-r border-b border-sheet-ink px-2 py-1 even:border-r-0">
            <dt className="opacity-80">{f.label}</dt>
            <dd className="font-medium">{tb[f.key] || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- LayerMapTable: 내부 레이어 → DXF 레이어명 · ACI 색 번호(숫자) · 선 종류 ---------- */
export type LayerMap = { id: string; source: string; dxfName: string; aci: number; linetype: string };

export function LayerMapTable({ defaultRows }: { defaultRows: LayerMap[] }) {
  const [rows, setRows] = useState(defaultRows);
  const set = (id: string, patch: Partial<LayerMap>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <Table
      caption="DXF 레이어 매핑"
      columns={[
        { key: "source", header: "내부 레이어" },
        { key: "dxfName", header: "DXF 레이어명" },
        { key: "aci", header: "ACI 색 번호" },
        { key: "linetype", header: "선 종류" },
      ]}
      rows={rows.map((r) => ({
        id: r.id,
        source: r.source,
        dxfName: <Input aria-label={`${r.source} DXF 레이어명`} value={r.dxfName} onChange={(e) => set(r.id, { dxfName: e.target.value })} className="h-control-sm min-w-40" />,
        aci: <NumberInput label={`${r.source} ACI 색 번호`} value={r.aci} unit="ACI" step={1} min={1} max={255} onChange={(v) => set(r.id, { aci: v })} className="h-control-sm w-28" />,
        linetype: (
          <Select aria-label={`${r.source} 선 종류`} value={r.linetype} onChange={(e) => set(r.id, { linetype: e.target.value })} className="min-w-32">
            <option value="CONTINUOUS">실선</option>
            <option value="DASHED">파선</option>
            <option value="DASHDOT">1점 쇄선</option>
          </Select>
        ),
      }))}
    />
  );
}

/* ---------- IntakeCandidateList: AI가 추출한 값은 사람이 확인하기 전까지 "후보" ---------- */
export type IntakeCandidate = { id: string; field: string; value: string; source: string };

export function IntakeCandidateList({ items }: { items: IntakeCandidate[] }) {
  const [decision, setDecision] = useState<Record<string, "accepted" | "rejected">>({});
  return (
    <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
      {items.map((it) => {
        const d = decision[it.id];
        return (
          <li key={it.id} className="flex flex-col gap-2 p-pad md:flex-row md:items-center">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-fg">{it.field}</span>
                {d === "accepted" ? (
                  <Badge tone="ok" icon="check">확정</Badge>
                ) : d === "rejected" ? (
                  <Badge icon="x">제외</Badge>
                ) : (
                  <Badge tone="info" icon="sparkles">AI 추출 후보</Badge>
                )}
              </div>
              <p className="text-num text-fg tabular-nums">{it.value}</p>
              <p className="text-caption text-fg-3">출처: {it.source}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon="check" onClick={() => setDecision({ ...decision, [it.id]: "accepted" })}>채택</Button>
              <Button size="sm" variant="ghost" icon="x" onClick={() => setDecision({ ...decision, [it.id]: "rejected" })}>제외</Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- LicenseStatusBadge ---------- */
export type LicenseStatus = "active" | "trial" | "update-expired" | "expired" | "device-limit";
const LICENSE: Record<LicenseStatus, { tone: Tone; icon: IconName; label: string }> = {
  active: { tone: "ok", icon: "key", label: "정품 사용 중" },
  trial: { tone: "info", icon: "key", label: "체험 중" },
  "update-expired": { tone: "warn", icon: "triangle-alert", label: "업데이트 만료" },
  expired: { tone: "danger", icon: "circle-x", label: "라이선스 만료" },
  "device-limit": { tone: "warn", icon: "triangle-alert", label: "기기 한도 도달" },
};

export function LicenseStatusBadge({ status }: { status: LicenseStatus }) {
  const l = LICENSE[status];
  return <Badge tone={l.tone} icon={l.icon}>{l.label}</Badge>;
}

/* ---------- VoiceButton ---------- */
export type VoiceState = "idle" | "listening" | "unavailable";

export function VoiceButton({ state, onToggle }: { state: VoiceState; onToggle: () => void }) {
  const listening = state === "listening";
  return (
    <button
      type="button"
      aria-pressed={listening}
      disabled={state === "unavailable"}
      onClick={onToggle}
      className={cn(
        "focus-ring relative inline-flex h-control items-center gap-1.5 rounded-control border px-3 text-body transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        listening ? "border-danger bg-danger text-danger-fg" : "border-input bg-surface text-fg hover:bg-raised",
      )}
    >
      <Icon name={state === "unavailable" ? "mic-off" : "mic"} className={cn(listening && "motion-safe:animate-pulse")} />
      {state === "unavailable" ? "음성 사용 불가" : listening ? "듣는 중 (눌러서 멈춤)" : "음성 입력"}
    </button>
  );
}

/* ---------- ChatThread: "AI 답변" 표시 + 출처 칩, 근거 없는 답은 명시 ---------- */
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; citations?: Citation[]; noSource?: boolean };

export function ChatThread({ messages }: { messages: ChatMessage[] }) {
  const [voice, setVoice] = useState<VoiceState>("idle");
  return (
    <section aria-label="AI 채팅" className="flex flex-col rounded-panel border border-line bg-surface">
      <ol role="log" aria-live="polite" className="flex flex-col gap-gap p-pad">
        {messages.map((m) => (
          <li key={m.id} className={cn("flex max-w-(--chat-bubble-max) flex-col gap-1.5", m.role === "user" ? "self-end items-end" : "self-start")}>
            {m.role === "assistant" ? <Badge icon="sparkles">AI 답변</Badge> : null}
            <p className={cn("rounded-panel px-3 py-2 text-body", m.role === "user" ? "bg-accent text-accent-fg" : "bg-raised text-fg")}>{m.text}</p>
            {m.citations?.map((c) => <RuleCitation key={c.article} {...c} />)}
            {m.noSource ? (
              <p className="flex items-center gap-1 text-caption text-warn">
                <Icon name="triangle-alert" className="size-3.5" /> 근거 조항을 찾지 못했습니다. 판정에 쓰지 마세요.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <form className="flex flex-col gap-2 border-t border-line p-pad md:flex-row" onSubmit={(e) => e.preventDefault()}>
        <Input aria-label="메시지" placeholder="법규나 판정 결과를 물어보세요" className="flex-1" />
        <div className="flex gap-2">
          <VoiceButton state={voice} onToggle={() => setVoice(voice === "listening" ? "idle" : "listening")} />
          <Button type="submit" variant="primary" icon="send">보내기</Button>
        </div>
      </form>
    </section>
  );
}
