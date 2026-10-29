// 평면 화면 패널(03장 3.7절): 실 목록(왼쪽), 실 속성·도구 패널(오른쪽), 하단 검사 줄, 도면 미리보기.
// 표시 전용: 면적·목표 차이·AR051은 layout 검사 결과를 그대로 보인다. 색만으로 구분하지 않고 부호·아이콘·글자를 함께 쓴다.
import type { Point } from "@arch-studio/domain";
import type { FloorLayout, ProgramTarget } from "@arch-studio/layout";
import { Badge, Banner, Button, Field, Icon, Input, NumberInput, Select } from "@arch-studio/ui";
import { useState } from "react";
import type { Tool } from "./editor.ts";
import { diffText, m2Text } from "./format.ts";
import { issueText, type Analysis } from "./model.ts";
import { edgeLength, type OpeningPatch, type Selection } from "./ops.ts";

export interface PlanActions {
  pickRoom(id: string): void;
  placeTarget(t: ProgramTarget): void;
  rename(id: string, name: string, use: string): void;
  selectEdge(id: string, edge: number): void;
  addOpening(kind: "door" | "window"): void;
  pickOpening(id: string): void;
  updateOpening(id: string, patch: OpeningPatch): void;
  removeOpening(id: string): void;
  removeRoom(id: string): void;
  drawClose(): void;
  drawBack(): void;
  drawAtCursor(): void;
  addRect(x: number, y: number, w: number, h: number): void;
  split(id: string, axis: 0 | 1, at: number): void;
  merge(keep: string, other: string): void;
}

const SECTION = "flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-surface p-pad";

// ---------- 왼쪽: 실 목록 ----------

export function RoomList({ layout, analysis, sel, edit, actions, mergeMode }: { layout: FloorLayout; analysis: Analysis; sel: Selection; edit: boolean; actions: PlanActions; mergeMode: boolean }) {
  return (
    <section aria-labelledby="plan-rooms" className={SECTION}>
      <h2 id="plan-rooms" className="text-h2 font-semibold text-fg">
        실 목록
      </h2>
      {layout.rooms.length === 0 ? <p className="text-caption text-fg-2">배치한 실이 없습니다.</p> : null}
      <ul className="flex flex-col gap-1">
        {layout.rooms.map((r) => {
          const row = analysis.rows.get(r.id);
          const on = sel.kind === "room" && sel.id === r.id;
          const bad = analysis.badRooms.has(r.id);
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => actions.pickRoom(r.id)}
                className={`focus-ring flex min-h-row w-full min-w-0 flex-col items-start rounded-control border px-2 py-1 text-left ${on ? "border-selection bg-raised" : "border-line bg-surface"}`}
              >
                <span className="flex w-full min-w-0 items-center gap-1 text-body font-medium text-fg">
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {bad ? (
                    <Badge tone="danger" icon="triangle-alert">
                      오류
                    </Badge>
                  ) : null}
                </span>
                <span className="text-num text-fg-2 tabular-nums">
                  {row ? `현재 ${m2Text(row.area_h100)}㎡` : ""}
                  {row && row.target_h100 !== null && row.diff_h100 !== null ? ` · 목표 ${m2Text(row.target_h100)}㎡` : ""}
                </span>
                {row && row.target_h100 !== null && row.diff_h100 !== null ? <span className="text-num text-fg tabular-nums">차이 {diffText(row.diff_h100, row.target_h100)}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {mergeMode ? <p className="text-caption text-fg-2">합칠 두 번째 실을 캔버스에서 누르거나 오른쪽 패널에서 고르세요.</p> : null}
      {analysis.unplaced.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <h3 className="text-caption font-medium text-fg-2">미배치(면적표)</h3>
          <ul className="flex flex-col gap-1">
            {analysis.unplaced.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-body text-fg">
                  <span className="block truncate">{t.name}</span>
                  <span className="text-num text-fg-2 tabular-nums">목표 {t.target_area_m2.toFixed(2)}㎡</span>
                </span>
                <Button size="sm" icon="plus" disabled={!edit} onClick={() => actions.placeTarget(t)} aria-label={`${t.name} 놓기`}>
                  놓기
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ---------- 오른쪽: 속성·도구 ----------

function RoomFields({ id, name, use, edit, actions }: { id: string; name: string; use: string; edit: boolean; actions: PlanActions }) {
  const [n, setN] = useState(name);
  const [u, setU] = useState(use);
  const commit = () => {
    if (n !== name || u !== use) actions.rename(id, n, u);
  };
  const onKey = (e: { key: string; currentTarget: { blur(): void } }) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label="이름" htmlFor={`plan-name-${id}`}>
        <Input id={`plan-name-${id}`} value={n} maxLength={60} disabled={!edit} onChange={(e) => setN(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      </Field>
      <Field label="용도" htmlFor={`plan-use-${id}`}>
        <Input id={`plan-use-${id}`} value={u} maxLength={60} disabled={!edit} onChange={(e) => setU(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      </Field>
    </div>
  );
}

function DrawPanel({ draw, cursor, actions }: { draw: readonly Point[]; cursor: Point; actions: PlanActions }) {
  const [x, setX] = useState<number | null>(cursor[0]);
  const [y, setY] = useState<number | null>(cursor[1]);
  const [w, setW] = useState<number | null>(4_000);
  const [h, setH] = useState<number | null>(3_000);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-fg-2">
        캔버스를 눌러 꼭짓점을 찍거나, 방향키로 커서를 옮기고 Space로 점을 더합니다. Enter로 닫고 Backspace로 마지막 점을 취소합니다.
      </p>
      <p className="text-num text-fg tabular-nums">
        커서 X {cursor[0]} · Y {cursor[1]} mm · 점 {draw.length}개
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={actions.drawAtCursor}>
          점 더하기 (Space)
        </Button>
        <Button size="sm" variant="primary" disabled={draw.length < 3} onClick={actions.drawClose}>
          닫기 (Enter)
        </Button>
        <Button size="sm" disabled={draw.length === 0} onClick={actions.drawBack}>
          점 취소 (Backspace)
        </Button>
      </div>
      <fieldset className="flex flex-col gap-2 border-t border-line pt-2">
        <legend className="text-caption font-medium text-fg-2">직사각형으로 한 번에</legend>
        <div className="grid grid-cols-2 gap-2">
          <Field label="왼쪽 아래 X (mm)" htmlFor="plan-rect-x">
            <NumberInput id="plan-rect-x" value={x} onChange={setX} label="왼쪽 아래 X" />
          </Field>
          <Field label="왼쪽 아래 Y (mm)" htmlFor="plan-rect-y">
            <NumberInput id="plan-rect-y" value={y} onChange={setY} label="왼쪽 아래 Y" />
          </Field>
          <Field label="가로 (mm)" htmlFor="plan-rect-w">
            <NumberInput id="plan-rect-w" value={w} min={100} onChange={setW} label="가로" />
          </Field>
          <Field label="세로 (mm)" htmlFor="plan-rect-h">
            <NumberInput id="plan-rect-h" value={h} min={100} onChange={setH} label="세로" />
          </Field>
        </div>
        <Button size="sm" icon="square" disabled={x === null || y === null || !w || !h} onClick={() => actions.addRect(x as number, y as number, w as number, h as number)}>
          사각형 실 더하기
        </Button>
      </fieldset>
    </div>
  );
}

function SplitPanel({ layout, sel, actions }: { layout: FloorLayout; sel: Selection; actions: PlanActions }) {
  const room = sel.kind === "room" ? layout.rooms.find((r) => r.id === sel.id) : undefined;
  const [axis, setAxis] = useState<0 | 1>(0);
  const [at, setAt] = useState<number | null>(null);
  if (!room) return <p className="text-caption text-fg-2">나눌 실을 고르세요. 캔버스에서 나눌 위치를 누르면 그 위치에서 나뉩니다.</p>;
  const xs = room.polygon.outer.map((p) => p[axis]);
  const mid = Math.round((Math.min(...xs) + Math.max(...xs)) / 2 / 100) * 100;
  const value = at ?? mid;
  return (
    <div className="flex flex-col gap-2">
      <Field label="분할선 방향" htmlFor="plan-split-axis">
        <Select id="plan-split-axis" value={String(axis)} onChange={(e) => (setAxis(e.target.value === "1" ? 1 : 0), setAt(null))}>
          <option value="0">세로선 (X 위치)</option>
          <option value="1">가로선 (Y 위치)</option>
        </Select>
      </Field>
      <Field label={axis === 0 ? "X 위치 (mm)" : "Y 위치 (mm)"} htmlFor="plan-split-at">
        <NumberInput id="plan-split-at" value={value} onChange={setAt} label="분할 위치" />
      </Field>
      <Button size="sm" variant="primary" onClick={() => actions.split(room.id, axis, value)}>
        나누기
      </Button>
    </div>
  );
}

function MergePanel({ layout, sel, actions }: { layout: FloorLayout; sel: Selection; actions: PlanActions }) {
  const [other, setOther] = useState("");
  if (sel.kind !== "room") return <p className="text-caption text-fg-2">합칠 첫 번째 실을 고르세요.</p>;
  const keep = sel.id;
  const choices = layout.rooms.filter((r) => r.id !== keep);
  const value = choices.some((r) => r.id === other) ? other : (choices[0]?.id ?? "");
  return (
    <div className="flex flex-col gap-2">
      <Field label="합칠 이웃 실" htmlFor="plan-merge-other" hint="변이 맞닿은 실만 합쳐집니다. 앞 실의 이름·용도를 유지합니다.">
        <Select id="plan-merge-other" value={value} disabled={choices.length === 0} onChange={(e) => setOther(e.target.value)}>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button size="sm" variant="primary" disabled={value === ""} onClick={() => actions.merge(keep, value)}>
        합치기
      </Button>
    </div>
  );
}

export function Inspector({
  layout,
  analysis,
  sel,
  tool,
  draw,
  cursor,
  edit,
  actions,
}: {
  layout: FloorLayout;
  analysis: Analysis;
  sel: Selection;
  tool: Tool;
  draw: readonly Point[];
  cursor: Point;
  edit: boolean;
  actions: PlanActions;
}) {
  const room = sel.kind === "room" ? layout.rooms.find((r) => r.id === sel.id) : undefined;
  const opening = sel.kind === "opening" ? layout.openings.find((o) => o.id === sel.id) : undefined;
  const openingRoom = opening ? layout.rooms.find((r) => r.id === opening.host.room_id) : undefined;
  const row = room ? analysis.rows.get(room.id) : undefined;
  return (
    <section aria-labelledby="plan-props" className={SECTION}>
      <h2 id="plan-props" className="text-h2 font-semibold text-fg">
        {tool === "room" ? "실 그리기" : tool === "split" ? "실 나누기" : tool === "merge" ? "실 합치기" : opening ? "문·창 속성" : "실 속성"}
      </h2>
      {tool === "room" ? <DrawPanel draw={draw} cursor={cursor} actions={actions} /> : null}
      {tool === "split" ? <SplitPanel layout={layout} sel={sel} actions={actions} /> : null}
      {tool === "merge" ? <MergePanel layout={layout} sel={sel} actions={actions} /> : null}
      {(tool === "select" || tool === "door" || tool === "window") && !room && !opening ? <p className="text-caption text-fg-2">캔버스나 실 목록에서 실을 고르면 속성이 보입니다.</p> : null}
      {tool !== "room" && tool !== "split" && tool !== "merge" && room ? (
        <div className="flex flex-col gap-3">
          <RoomFields key={`${room.id}:${room.name}:${room.use}`} id={room.id} name={room.name} use={room.use} edit={edit} actions={actions} />
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-caption">
            <dt className="text-fg-3">면적</dt>
            <dd className="text-num text-fg tabular-nums">{row ? `${m2Text(row.area_h100)}㎡` : "-"}</dd>
            <dt className="text-fg-3">목표</dt>
            <dd className="text-num text-fg tabular-nums">{row && row.target_h100 !== null ? `${m2Text(row.target_h100)}㎡` : "목표 없음"}</dd>
            <dt className="text-fg-3">차이</dt>
            <dd className="text-num text-fg tabular-nums">{row && row.target_h100 !== null && row.diff_h100 !== null ? diffText(row.diff_h100, row.target_h100) : "-"}</dd>
            <dt className="text-fg-3">벽</dt>
            <dd className="text-fg">외벽 200 · 내벽 100 (고정 제안값)</dd>
          </dl>
          <div className="flex flex-col gap-1">
            <h3 className="text-caption font-medium text-fg-2">변 (키보드: [ ] 로 고르고 화살표로 이동)</h3>
            <ul className="flex flex-wrap gap-1">
              {room.polygon.outer.map((_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-pressed={sel.kind === "room" && sel.edge === i}
                    onClick={() => actions.selectEdge(room.id, i)}
                    className={`focus-ring rounded-control border px-2 py-1 text-num tabular-nums ${sel.kind === "room" && sel.edge === i ? "border-selection bg-raised text-fg" : "border-line text-fg-2"}`}
                  >
                    변 {i + 1} · {edgeLength(room.polygon, i)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-caption font-medium text-fg-2">문·창</h3>
            <ul className="flex flex-col gap-1">
              {layout.openings
                .filter((o) => o.host.room_id === room.id)
                .map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => actions.pickOpening(o.id)} className="focus-ring w-full rounded-control border border-line px-2 py-1 text-left text-num text-fg tabular-nums">
                      {o.kind === "door" ? "문" : "창"} · 변 {o.host.edge_index + 1} · {o.width_mm}mm
                    </button>
                  </li>
                ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!edit || sel.kind !== "room" || sel.edge === null} onClick={() => actions.addOpening("door")}>
                문 놓기 (D)
              </Button>
              <Button size="sm" disabled={!edit || sel.kind !== "room" || sel.edge === null} onClick={() => actions.addOpening("window")}>
                창 놓기 (W)
              </Button>
            </div>
            {sel.kind === "room" && sel.edge === null ? <p className="text-caption text-fg-2">문·창을 놓을 변을 먼저 고르세요.</p> : null}
          </div>
          <Button size="sm" variant="danger" disabled={!edit} onClick={() => actions.removeRoom(room.id)}>
            실 지우기 (Delete)
          </Button>
        </div>
      ) : null}
      {tool !== "room" && tool !== "split" && tool !== "merge" && opening ? (
        <div className="flex flex-col gap-2">
          <p className="text-body text-fg">
            {opening.kind === "door" ? "문" : "창"} · {openingRoom?.name ?? ""} · 변 {opening.host.edge_index + 1}
          </p>
          <Field label="폭 (mm)" htmlFor="plan-op-width">
            <NumberInput id="plan-op-width" value={opening.width_mm} min={100} step={100} disabled={!edit} onChange={(v) => actions.updateOpening(opening.id, { width_mm: v })} label="폭" />
          </Field>
          <Field label="변 시작점부터 위치 (mm)" htmlFor="plan-op-offset">
            <NumberInput id="plan-op-offset" value={opening.offset_mm} min={0} step={100} disabled={!edit} onChange={(v) => actions.updateOpening(opening.id, { offset_mm: v })} label="위치" />
          </Field>
          {opening.kind === "door" ? (
            <Field label="여닫이 방향" htmlFor="plan-op-swing" hint="실 안에서 벽을 보았을 때 경첩이 있는 쪽">
              <Select id="plan-op-swing" value={opening.swing ?? "left"} disabled={!edit} onChange={(e) => actions.updateOpening(opening.id, { swing: e.target.value === "right" ? "right" : "left" })}>
                <option value="left">왼쪽 경첩</option>
                <option value="right">오른쪽 경첩</option>
              </Select>
            </Field>
          ) : null}
          <p className="text-caption text-fg-2">방향키 좌우로 벽을 따라 100mm씩(Shift 1,000mm) 움직입니다.</p>
          <Button size="sm" variant="danger" disabled={!edit} onClick={() => actions.removeOpening(opening.id)}>
            지우기 (Delete)
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ---------- 하단 검사 줄 ----------

export function CheckBar({
  layout,
  analysis,
  blocker,
  onPick,
}: {
  layout: FloorLayout;
  analysis: Analysis;
  blocker: string | null;
  onPick(roomId: string): void;
}) {
  return (
    <section aria-labelledby="plan-checks" className={SECTION}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="plan-checks" className="text-h2 font-semibold text-fg">
          배치 검사
        </h2>
        <p className="text-num text-fg tabular-nums">
          층 합계 {m2Text(analysis.totalH100)} / {m2Text(analysis.outlineH100)}㎡
        </p>
      </div>
      {analysis.issues.length === 0 ? (
        <p className="flex items-center gap-1 text-body text-fg">
          <Icon name="circle-check" className="size-4 text-ok" />
          겹침·외곽 이탈·문창 범위 오류가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="배치 오류 목록">
          {analysis.issues.map((i, k) => (
            <li key={k} className="flex flex-wrap items-center gap-2 text-body text-fg">
              <Icon name="triangle-alert" className="size-4 text-danger" />
              <span className="min-w-0 flex-1">
                오류 {k + 1}(AR051): {issueText(i, layout)}
              </span>
              {i.room_ids[0] ? (
                <Button size="sm" onClick={() => onPick(i.room_ids[0] as string)}>
                  보기
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {blocker ? <Banner tone="warn" title={blocker} /> : null}
    </section>
  );
}

// ---------- 도면 미리보기 ----------

export type PreviewView =
  | { kind: "idle"; text: string }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; text: string };

export function PreviewPanel({ view, floorLabel }: { view: PreviewView; floorLabel: string }) {
  return (
    <section aria-labelledby="plan-preview" className={SECTION}>
      <h2 id="plan-preview" className="text-h2 font-semibold text-fg">
        도면 미리보기 · {floorLabel}
      </h2>
      <p className="text-caption text-fg-2">도면 엔진이 만든 평면 시트입니다. 내보내는 SVG와 같습니다.</p>
      <div className="flex min-h-40 items-center justify-center rounded-control border border-line bg-sheet-paper p-2" aria-live="polite">
        {view.kind === "ready" ? <img src={view.url} alt={`${floorLabel} 평면 개략도 시트 미리보기`} className="h-auto max-h-full w-full" /> : null}
        {view.kind === "loading" ? <p className="text-caption text-fg-2">도면을 만드는 중…</p> : null}
        {view.kind === "idle" || view.kind === "error" ? <p className="text-caption text-fg-2">{view.text}</p> : null}
      </div>
    </section>
  );
}
