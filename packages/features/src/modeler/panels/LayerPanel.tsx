// 레이어 패널(03장 3.5절 LayerPanel): 대지·엔벨로프·초과분·매스(층) 표시 토글과 선택. 표시 상태는 화면 상태라 저장하지 않는다.
// 3D 캔버스는 aria-hidden이라 이 목록이 키보드·스크린리더의 매스 선택 경로다. 주차구획·치수는 DesignModel v1에 칸이 없어 목록에 없다.
import { Button, Icon, IconButton, cn } from "@arch-studio/ui";
import type { ReactNode } from "react";
import { massHeight, sortedFloors, type Model } from "../state/commands.ts";
import { massLabel, type LayerKey } from "../state/store.ts";
import type { EngineSnapshot } from "../engine/client.ts";

export interface LayerPanelProps {
  readonly model: Model;
  readonly hidden: readonly LayerKey[];
  readonly selection: string | null;
  readonly engine: EngineSnapshot;
  readonly onToggle: (k: LayerKey) => void;
  readonly onSelect: (id: string) => void;
  readonly onRetryEnvelope: () => void;
  readonly className?: string;
}

const ENVELOPE_STATUS: Readonly<Record<EngineSnapshot["envelopeStatus"], string>> = {
  idle: "대기",
  loading: "만드는 중",
  ready: "표시 중",
  error: "만들지 못함",
  unavailable: "엔진 없음",
};

function Row({ label, layer, hidden, onToggle, children }: { label: string; layer: LayerKey; hidden: readonly LayerKey[]; onToggle: (k: LayerKey) => void; children?: ReactNode }) {
  const on = !hidden.includes(layer);
  return (
    <li className="flex min-w-0 items-center gap-1">
      <IconButton size="sm" icon={on ? "eye" : "eye-off"} label={`${label} ${on ? "숨기기" : "보이기"}`} pressed={on} onClick={() => onToggle(layer)} />
      {children ?? <span className={cn("min-w-0 truncate text-body", on ? "text-fg" : "text-fg-3")}>{label}</span>}
    </li>
  );
}

export function LayerPanel(p: LayerPanelProps) {
  const env = p.engine;
  return (
    <section aria-labelledby="modeler-layers-title" className={cn("flex min-w-0 flex-col gap-2", p.className)}>
      <h2 id="modeler-layers-title" className="text-h2 font-semibold text-fg">
        레이어
      </h2>
      <ul className="flex flex-col gap-1">
        <Row label="대지" layer="site" hidden={p.hidden} onToggle={p.onToggle} />
        <Row label="엔벨로프" layer="envelope" hidden={p.hidden} onToggle={p.onToggle}>
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="text-body text-fg">엔벨로프</span>
            <span className="text-caption text-fg-3">{ENVELOPE_STATUS[env.envelopeStatus]}</span>
          </span>
        </Row>
        <Row label="초과분(엔벨로프 밖)" layer="excess" hidden={p.hidden} onToggle={p.onToggle} />
      </ul>
      {env.envelopeStatus === "error" || env.envelopeStatus === "unavailable" ? (
        <div role="status" className="flex flex-col gap-1 rounded-control border border-line p-2 text-caption text-fg-2">
          <p>
            <Icon name="triangle-alert" className="mr-1 inline size-3.5 text-warn" />
            엔벨로프를 만들지 못했습니다. {env.envelopeError}
          </p>
          {env.envelopeStatus === "error" ? (
            <Button size="sm" variant="ghost" onClick={p.onRetryEnvelope}>
              다시 시도
            </Button>
          ) : null}
        </div>
      ) : null}
      {env.envelope && env.envelope.warnings.length > 0 ? (
        <details className="rounded-control border border-line text-caption text-fg-2">
          <summary className="focus-ring cursor-pointer rounded-control px-2 py-1">엔벨로프 안내 {env.envelope.warnings.length}건</summary>
          <ul className="flex list-disc flex-col gap-1 py-1 pr-2 pl-6">
            {env.envelope.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <h3 className="text-caption font-medium text-fg-2">매스 {p.model.masses.length}개</h3>
      {p.model.masses.length === 0 ? <p className="text-caption text-fg-3">매스가 없습니다.</p> : null}
      <ul className="flex flex-col gap-1" aria-label="매스 목록">
        {p.model.masses.map((m) => {
          const label = massLabel(p.model, m.id);
          const selected = p.selection === m.id;
          const excess = p.engine.excess.has(m.id);
          return (
            <Row key={m.id} label={label} layer={`mass:${m.id}`} hidden={p.hidden} onToggle={p.onToggle}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => p.onSelect(m.id)}
                className={cn(
                  "focus-ring flex min-w-0 flex-1 flex-col items-start rounded-control px-2 py-1 text-left hover:bg-raised",
                  selected && "bg-raised",
                )}
              >
                <span className="flex items-center gap-1 text-body font-medium text-fg">
                  {label}
                  {excess ? (
                    <span className="inline-flex items-center gap-0.5 text-caption text-danger">
                      <Icon name="triangle-alert" className="size-3.5" />
                      초과
                    </span>
                  ) : null}
                </span>
                <span className="text-caption text-fg-3 tabular-nums">
                  {sortedFloors(m)
                    .map((f) => (f.level > 0 ? `${f.level}F` : `B${1 - f.level}`))
                    .join(" ")}{" "}
                  · {(massHeight(m) / 1000).toFixed(1)}m
                </span>
              </button>
            </Row>
          );
        })}
      </ul>
    </section>
  );
}
