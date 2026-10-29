// 속성 인스펙터(03장 3.5절 PropertyInspector): 선택 매스의 층 수·층고·바닥 높이·층별 용도·지붕을 mm 정수로 직접 넣는다.
// 선택이 없으면 "직사각형 매스 추가" 수치 입력(키보드만으로 매스를 만드는 경로). 열람이면 같은 값을 읽기 전용으로 보인다.
// 코어·발코니는 DesignModel v1 스키마에 칸이 없어 비활성 + 이유. 바닥 면적은 표시용(geometry area), 판정 값은 판정 패널이 정본.
import { formatAreaM2 } from "@arch-studio/domain";
import { area } from "@arch-studio/geometry";
import { Button, Field, Input, NumberInput, Select } from "@arch-studio/ui";
import { useId, useState, type KeyboardEvent } from "react";
import { LIMITS, ROOF_LABEL, ROOF_TYPES, rectOuter, sortedFloors, uniformFloorHeight, type Mass, type Model, type RoofType } from "../state/commands.ts";
import { massLabel, type Command } from "../state/store.ts";
import { massBounds, sceneBounds } from "../viewport/geometry.ts";

export const FLOOR_HEIGHT_INPUT_ID = "modeler-floor-height";
export const CORE_BALCONY_REASON = "설계 모델(DesignModel v1)에 코어·발코니 칸이 없어 아직 편집할 수 없습니다. 스키마를 넓힌 뒤 제공합니다.";
export const ROOF_SHAPE_NOTE = "경사 지붕 모양은 3D 보기에 아직 그리지 않습니다(평지붕 모양으로 표시). 종류·경사 값은 모델에 저장됩니다.";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export interface InspectorProps {
  readonly model: Model;
  readonly selection: string | null;
  readonly editable: boolean;
  readonly draftFloors: number;
  readonly draftFloorHeight: number;
  readonly onCommand: (c: Command) => void;
  readonly onDraftDefaults: (d: { floors?: number; floorHeight?: number }) => void;
  readonly className?: string;
}

export function Inspector(p: InspectorProps) {
  const mass = p.selection ? p.model.masses.find((m) => m.id === p.selection) : undefined;
  return (
    <section aria-labelledby="modeler-inspector-title" className={p.className ?? "flex min-w-0 flex-col gap-gap"}>
      <h2 id="modeler-inspector-title" className="text-h2 font-semibold text-fg">
        속성
      </h2>
      {mass ? <MassProps key={mass.id} {...p} mass={mass} /> : <NewMass {...p} />}
    </section>
  );
}

/** 글 입력: Enter·포커스 이탈 때 확정, Esc 되돌림. */
function CommitInput({ id, value, onCommit, disabled, label, inputMode, suffix, maxLength }: { id?: string; value: string; onCommit: (v: string) => void; disabled?: boolean; label?: string; inputMode?: "decimal" | "text"; suffix?: string; maxLength?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <Input
      id={id}
      aria-label={label}
      value={draft ?? value}
      disabled={disabled}
      inputMode={inputMode}
      suffix={suffix}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function MassProps({ model, mass, editable, onCommand }: InspectorProps & { mass: Mass }) {
  const base = useId();
  const floors = sortedFloors(mass);
  const uniform = uniformFloorHeight(mass);
  const b = massBounds(mass);
  let areaText = "-";
  try {
    areaText = `${formatAreaM2(area(mass.footprint))}㎡`;
  } catch {
    areaText = "계산할 수 없음(바닥 모양 확인)";
  }
  const id = mass.id;
  return (
    <div className="flex flex-col gap-gap">
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-caption">
        <dt className="text-fg-3">이름</dt>
        <dd className="text-fg">{massLabel(model, id)}</dd>
        <dt className="text-fg-3">바닥 면적(표시용)</dt>
        <dd className="text-fg tabular-nums">{areaText}</dd>
        <dt className="text-fg-3">바닥 폭 × 깊이</dt>
        <dd className="text-fg tabular-nums">
          {fmt(b.maxX - b.minX)} × {fmt(b.maxY - b.minY)}mm
        </dd>
        <dt className="text-fg-3">꼭짓점</dt>
        <dd className="text-fg tabular-nums">{mass.footprint.outer.length}개</dd>
        <dt className="text-fg-3">높이</dt>
        <dd className="text-fg tabular-nums">{fmt(floors.reduce((s, f) => s + f.height_mm, 0))}mm</dd>
      </dl>
      <Field label="층 수" htmlFor={`${base}-floors`} hint={`1~${LIMITS.floors}층. 줄이면 위층과 그 층 평면이 지워집니다(실행 취소 가능).`}>
        <NumberInput id={`${base}-floors`} unit="층" step={1} min={1} max={LIMITS.floors} value={floors.length} disabled={!editable} onChange={(n) => onCommand({ type: "floors", id, count: n })} />
      </Field>
      <Field label="층고(모든 층)" htmlFor={FLOOR_HEIGHT_INPUT_ID} hint={uniform === null ? "층마다 다릅니다. 값을 넣으면 모든 층이 같아집니다." : `${fmt(LIMITS.floorHeightMin)}~${fmt(LIMITS.floorHeightMax)}mm`}>
        <NumberInput
          id={FLOOR_HEIGHT_INPUT_ID}
          step={100}
          min={LIMITS.floorHeightMin}
          max={LIMITS.floorHeightMax}
          value={uniform}
          disabled={!editable}
          onChange={(n) => onCommand({ type: "floorHeight", id, floorId: null, height: n })}
        />
      </Field>
      <Field label="바닥 높이(지반 기준)" htmlFor={`${base}-base`}>
        <NumberInput id={`${base}-base`} step={100} min={LIMITS.baseLevelMin} max={LIMITS.baseLevelMax} value={mass.base_level_mm} disabled={!editable} onChange={(n) => onCommand({ type: "baseLevel", id, value: n })} />
      </Field>
      <details className="rounded-control border border-line">
        <summary className="focus-ring cursor-pointer rounded-control px-3 py-2 text-body font-medium text-fg">층별 층고·용도</summary>
        <ul className="flex flex-col gap-2 border-t border-line p-2">
          {floors.map((f) => (
            <li key={f.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
              <span className="text-caption font-medium text-fg-2 tabular-nums">{f.level > 0 ? `${f.level}F` : `B${1 - f.level}`}</span>
              <div className="grid min-w-0 grid-cols-2 gap-1">
                <NumberInput
                  label={`${f.level}층 층고`}
                  step={100}
                  min={LIMITS.floorHeightMin}
                  max={LIMITS.floorHeightMax}
                  value={f.height_mm}
                  disabled={!editable}
                  onChange={(n) => onCommand({ type: "floorHeight", id, floorId: f.id, height: n })}
                />
                <CommitInput label={`${f.level}층 용도`} value={f.use} maxLength={LIMITS.useMaxLength} disabled={!editable} onCommit={(v) => onCommand({ type: "floorUse", id, floorId: f.id, use: v })} />
              </div>
            </li>
          ))}
        </ul>
      </details>
      <Field label="지붕" htmlFor={`${base}-roof`} hint={mass.roof.type === "flat" ? undefined : ROOF_SHAPE_NOTE}>
        <Select id={`${base}-roof`} value={mass.roof.type} disabled={!editable} onChange={(e) => onCommand({ type: "roof", id, roof: e.target.value as RoofType })}>
          {ROOF_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOF_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      {mass.roof.type !== "flat" ? (
        <Field label="지붕 경사(높이/거리)" htmlFor={`${base}-pitch`} hint={`0~${LIMITS.pitchMax}, 예: 0.4`}>
          <CommitInput
            id={`${base}-pitch`}
            inputMode="decimal"
            value={mass.roof.pitch === undefined ? "" : String(mass.roof.pitch)}
            disabled={!editable}
            onCommit={(v) => {
              const n = Number(v.trim());
              onCommand({ type: "roof", id, roof: mass.roof.type, pitch: v.trim() === "" || !Number.isFinite(n) ? Number.NaN : n });
            }}
          />
        </Field>
      ) : null}
      <fieldset className="flex flex-col gap-1" aria-describedby={`${base}-core-why`}>
        <legend className="text-caption font-medium text-fg-2">코어·발코니</legend>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="plus" disabled>
            코어 추가
          </Button>
          <Button size="sm" icon="plus" disabled>
            발코니 추가
          </Button>
        </div>
        <p id={`${base}-core-why`} className="text-caption text-fg-3">
          {CORE_BALCONY_REASON}
        </p>
      </fieldset>
      {editable ? (
        <Button variant="danger" size="sm" icon="x" onClick={() => onCommand({ type: "delete", id })} aria-keyshortcuts="Delete">
          매스 삭제
        </Button>
      ) : null}
    </div>
  );
}

function NewMass({ model, editable, draftFloors, draftFloorHeight, onCommand, onDraftDefaults }: InspectorProps) {
  const base = useId();
  const s = sceneBounds(model);
  const [w, setW] = useState(8000);
  const [d, setD] = useState(8000);
  const [x, setX] = useState(() => Math.round((s.minX + s.maxX) / 2 / 100) * 100 - 4000);
  const [y, setY] = useState(() => Math.round((s.minY + s.maxY) / 2 / 100) * 100 - 4000);
  if (!editable) return <p className="text-caption text-fg-3">매스를 고르면 속성을 볼 수 있습니다.</p>;
  return (
    <form
      className="flex flex-col gap-2"
      aria-label="직사각형 매스 추가"
      onSubmit={(e) => {
        e.preventDefault();
        onCommand({ type: "add", input: { outer: rectOuter(x, y, w, d), floors: draftFloors, floorHeight: draftFloorHeight } });
      }}
    >
      <p className="text-caption text-fg-3">선택한 매스가 없습니다. 뷰포트에서 [매스 M]으로 바닥을 그리거나, 아래 수치로 직사각형 매스를 추가합니다.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="시작 X" htmlFor={`${base}-x`}>
          <NumberInput id={`${base}-x`} value={x} onChange={setX} />
        </Field>
        <Field label="시작 Y" htmlFor={`${base}-y`}>
          <NumberInput id={`${base}-y`} value={y} onChange={setY} />
        </Field>
        <Field label="폭" htmlFor={`${base}-w`}>
          <NumberInput id={`${base}-w`} value={w} min={100} max={200_000} onChange={setW} />
        </Field>
        <Field label="깊이" htmlFor={`${base}-d`}>
          <NumberInput id={`${base}-d`} value={d} min={100} max={200_000} onChange={setD} />
        </Field>
        <Field label="층 수" htmlFor={`${base}-n`}>
          <NumberInput id={`${base}-n`} unit="층" step={1} min={1} max={LIMITS.floors} value={draftFloors} onChange={(n) => onDraftDefaults({ floors: n })} />
        </Field>
        <Field label="층고" htmlFor={`${base}-h`}>
          <NumberInput id={`${base}-h`} min={LIMITS.floorHeightMin} max={LIMITS.floorHeightMax} value={draftFloorHeight} onChange={(n) => onDraftDefaults({ floorHeight: n })} />
        </Field>
      </div>
      <Button type="submit" icon="plus">
        매스 추가
      </Button>
    </form>
  );
}
