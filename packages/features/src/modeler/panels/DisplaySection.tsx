// 표시 절(03장 3.5절 "레이어/표시", AR-06-085)과 층 탭(9.2절 층·시트 탭, "1F" = 그 층만).
// 모두 화면 표시 값: 모델·도면·판정·저장·실행 취소와 무관하다. 열람 모드에서도 바꿀 수 있다.
import { Button, Checkbox, Field, Icon, Select, cn } from "@arch-studio/ui";
import { useId } from "react";
import type { Model } from "../state/commands.ts";
import {
  EXPLODE_LABEL,
  EXPLODE_STEPS,
  LIGHTING_LABEL,
  MATERIAL_LABEL,
  effectiveFloorOnly,
  floorTabLevels,
  levelLabel,
  splitOverLimit,
  type DisplaySettings,
  type LightingPreset,
  type MaterialPreset,
} from "../display/settings.ts";

export interface DisplaySectionProps {
  readonly model: Model;
  readonly display: DisplaySettings;
  readonly onChange: (patch: Partial<DisplaySettings>) => void;
}

export function DisplaySection({ model, display, onChange }: DisplaySectionProps) {
  const base = useId();
  const floorOnly = effectiveFloorOnly(model, display.floorOnly);
  const overLimit = splitOverLimit(model, display);
  return (
    <section aria-labelledby={`${base}-title`} className="flex min-w-0 flex-col gap-3">
      <h2 id={`${base}-title`} className="text-h2 font-semibold text-fg">
        표시
      </h2>
      <Field label="조명" htmlFor={`${base}-light`}>
        <Select id={`${base}-light`} value={display.lighting} onChange={(e) => onChange({ lighting: e.target.value as LightingPreset })}>
          {(Object.keys(LIGHTING_LABEL) as LightingPreset[]).map((k) => (
            <option key={k} value={k}>
              {LIGHTING_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="그림자 켜기" checked={display.shadows} onChange={(e) => onChange({ shadows: e.currentTarget.checked })} />
      <Field label="재질(표시용)" htmlFor={`${base}-material`}>
        <Select id={`${base}-material`} value={display.material} onChange={(e) => onChange({ material: e.target.value as MaterialPreset })}>
          {(Object.keys(MATERIAL_LABEL) as MaterialPreset[]).map((k) => (
            <option key={k} value={k}>
              {MATERIAL_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label="층 라벨" checked={display.floorLabels} onChange={(e) => onChange({ floorLabels: e.currentTarget.checked })} />
      <Field label="분해도(층 간격 띄우기)" htmlFor={`${base}-explode`} hint={display.explodeMm > 0 && !overLimit ? "분해도 중에는 측정할 수 없습니다." : undefined}>
        <Select id={`${base}-explode`} value={String(display.explodeMm)} onChange={(e) => onChange({ explodeMm: Number(e.target.value) })}>
          {EXPLODE_STEPS.map((v) => (
            <option key={v} value={String(v)}>
              {EXPLODE_LABEL[v]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-2 text-caption text-fg-2">
        <span>층 숨김: {floorOnly === null ? "전체 층" : `${levelLabel(floorOnly)}만`} (캔버스 아래 층 탭)</span>
        {floorOnly !== null ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({ floorOnly: null })}>
            전체 층 보기
          </Button>
        ) : null}
      </div>
      {overLimit ? (
        <p role="status" className="text-caption text-warn">
          <Icon name="triangle-alert" className="mr-1 inline size-3.5" />
          층이 많아 분해도·층 숨김을 그리지 않고 전체 매스로 보입니다(표시 삼각형 상한).
        </p>
      ) : null}
      <p className="text-caption text-fg-3">화면 표시만 바뀝니다. 모델·도면·판정에는 영향이 없고 이 PC에만 기억합니다(층 숨김은 기억하지 않음).</p>
    </section>
  );
}

export interface FloorTabsProps {
  readonly model: Model;
  readonly display: DisplaySettings;
  readonly onPick: (level: number | null) => void;
}

const tabCls = (on: boolean) =>
  cn("focus-ring inline-flex h-control-sm shrink-0 items-center rounded-control px-3 text-body disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-raised font-semibold text-fg" : "text-fg-2 hover:text-fg");

/** 층 탭: "전체" + 모델의 층. 층을 누르면 그 층만 보인다(다시 누르면 전체). */
export function FloorTabs({ model, display, onPick }: FloorTabsProps) {
  const hintId = useId();
  const levels = floorTabLevels(model);
  if (levels.length === 0) return null;
  // 삼각형 상한으로 층별 표시를 못 그리면 층 탭도 막는다(표시 절 안내와 같은 판정).
  const overLimit = splitOverLimit(model, display);
  const current = overLimit ? null : effectiveFloorOnly(model, display.floorOnly);
  return (
    <div role="group" aria-label="층 표시" aria-describedby={overLimit ? hintId : undefined} className="flex items-center gap-1">
      <button type="button" aria-pressed={current === null} disabled={overLimit} onClick={() => onPick(null)} className={tabCls(current === null)}>
        전체
      </button>
      {levels.map((l) => (
        <button key={l} type="button" aria-pressed={current === l} disabled={overLimit} onClick={() => onPick(current === l ? null : l)} className={tabCls(current === l)}>
          {levelLabel(l)}
        </button>
      ))}
      {overLimit ? (
        <span id={hintId} className="shrink-0 text-caption text-fg-3">
          층이 많아 층별 표시를 쓸 수 없습니다
        </span>
      ) : null}
    </div>
  );
}
