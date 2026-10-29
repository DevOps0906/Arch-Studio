// 도면 시트 화면의 조각들(03장 3.8절): 시트 목록 · 시트 설정 · 표제란 · 레이어 매핑 · 미리보기. 상태·권한은 index.tsx가 정한다.
import type { DesignModelV1, DraftingProfile, SheetSpec } from "@arch-studio/domain";
import { Badge, Banner, Button, Field, Select, Switch, Table, cn } from "@arch-studio/ui";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { LoadingState } from "../shell/index.ts";
import { LAYER_ROWS, LINETYPE_LABEL } from "../settings/drafting/layer-map.ts";
import {
  KIND_LABEL,
  ORIENTATION_LABEL,
  PAPERS,
  SCALE_CHOICES,
  UI_KINDS,
  kindSupport,
  layoutFloors,
  scaleLabel,
  sheetName,
  type Paper,
  type ScaleChoice,
  type SheetKind,
  type SheetSummary,
} from "./model.ts";

export function Panel({ title, id, children, className }: { title: string; id: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad", className)}>
      <h2 id={id} className="text-h2 font-semibold text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------- 시트 목록 ---------- */

export interface SheetListProps {
  specs: readonly SheetSpec[];
  model: DesignModelV1;
  selectedId: string | null;
  canEdit: boolean;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onMove(id: string, dir: -1 | 1): void;
  onAdd(kind: SheetKind): void;
  /** 종류별 만들 수 없는 이유(없으면 만들 수 있다). */
  blocked: Readonly<Partial<Record<SheetKind, string>>>;
  engineLabel: string | null;
}

export function SheetList(p: SheetListProps) {
  const id = useId();
  return (
    <Panel title="시트 목록" id={`${id}-list`}>
      {p.specs.length === 0 ? (
        <p className="text-caption text-fg-3">시트가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="시트">
          {p.specs.map((s, i) => {
            const selected = s.id === p.selectedId;
            const name = sheetName(s, p.specs, p.model);
            return (
              <li key={s.id} className={cn("flex flex-col rounded-control border", selected ? "border-accent bg-raised" : "border-line")}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => p.onSelect(s.id)}
                  className="focus-ring flex min-w-0 flex-col items-start rounded-control px-3 py-2 text-left"
                >
                  <span className="max-w-full truncate text-body font-medium text-fg">{name}</span>
                  <span className="text-caption text-fg-2">
                    {s.paper} · {s.scale === "auto" ? "축척 자동" : scaleLabel(s.scale)} · {ORIENTATION_LABEL[s.orientation]}
                  </span>
                </button>
                {p.canEdit ? (
                  <div className="flex flex-wrap items-center justify-end px-1 pb-1">
                    <Button size="sm" variant="ghost" aria-label={`${name} 위로`} disabled={i === 0} onClick={() => p.onMove(s.id, -1)}>
                      위
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`${name} 아래로`} disabled={i === p.specs.length - 1} onClick={() => p.onMove(s.id, 1)}>
                      아래
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`${name} 삭제`} onClick={() => p.onDelete(s.id)}>
                      삭제
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-caption font-medium text-fg-2">시트 만들기</p>
        {!p.canEdit ? <p className="text-caption text-fg-3">지금은 새 시트를 만들 수 없습니다.</p> : null}
        <ul className="flex flex-col gap-1">
          {UI_KINDS.map((k) => {
            const why = p.blocked[k] ?? null;
            const descId = `${id}-why-${k}`;
            return (
              <li key={k} className="flex flex-col gap-0.5">
                <Button size="sm" icon="plus" className="justify-start" disabled={!p.canEdit || why !== null} aria-describedby={why ? descId : undefined} onClick={() => p.onAdd(k)}>
                  {KIND_LABEL[k]}
                </Button>
                {why && p.canEdit ? (
                  <p id={descId} className="text-caption text-fg-3">
                    {why}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {p.engineLabel ? <p className="text-caption text-fg-3">엔진 {p.engineLabel}</p> : null}
    </Panel>
  );
}

/** 종류별 만들 수 없는 이유 표(지원 여부 + 빠진 입력은 호출 쪽이 합친다). */
export function unsupportedReasons(): Partial<Record<SheetKind, string>> {
  const out: Partial<Record<SheetKind, string>> = {};
  for (const k of UI_KINDS) {
    const s = kindSupport(k);
    if (!s.ok) out[k] = s.reason;
  }
  return out;
}

/* ---------- 시트 설정 ---------- */

export function SettingsPanel({
  spec,
  name,
  model,
  canEdit,
  onChange,
}: {
  spec: SheetSpec;
  name: string;
  model: DesignModelV1;
  canEdit: boolean;
  onChange(next: SheetSpec): void;
}) {
  const id = useId();
  const floors = layoutFloors(model);
  return (
    <Panel title="시트 설정" id={`${id}-set`}>
      <p className="text-caption text-fg-2">
        종류 <span className="font-medium text-fg">{KIND_LABEL[spec.kind]}</span> · {name}
      </p>
      {!canEdit ? <p className="text-caption text-fg-3">읽기 전용입니다. 설정을 바꾸려면 편집 권한이 필요합니다.</p> : null}
      <Field label="용지" htmlFor={`${id}-paper`}>
        <Select id={`${id}-paper`} value={spec.paper} disabled={!canEdit} onChange={(e) => onChange({ ...spec, paper: e.target.value as Paper })}>
          {PAPERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="방향" htmlFor={`${id}-ori`}>
        <Select id={`${id}-ori`} value={spec.orientation} disabled={!canEdit} onChange={(e) => onChange({ ...spec, orientation: e.target.value as SheetSpec["orientation"] })}>
          <option value="landscape">가로</option>
          <option value="portrait">세로</option>
        </Select>
      </Field>
      <Field label="축척" htmlFor={`${id}-scale`} hint="자동은 용지에 들어가는 가장 큰 축척을 고릅니다.">
        <Select
          id={`${id}-scale`}
          value={String(spec.scale)}
          disabled={!canEdit}
          onChange={(e) => onChange({ ...spec, scale: (e.target.value === "auto" ? "auto" : Number(e.target.value)) as ScaleChoice })}
        >
          {SCALE_CHOICES.map((s) => (
            <option key={String(s)} value={String(s)}>
              {scaleLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      {spec.kind === "floor_plan" ? (
        <Field label="층" htmlFor={`${id}-floor`}>
          <Select id={`${id}-floor`} value={spec.floor_id ?? ""} disabled={!canEdit || floors.length === 0} onChange={(e) => onChange({ ...spec, floor_id: e.target.value })}>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Switch checked={spec.include_in_proposal} disabled={!canEdit} onChange={(v) => onChange({ ...spec, include_in_proposal: v })} label="제안서에 넣기" />
      </div>
    </Panel>
  );
}

/* ---------- 표제란 ---------- */

export function TitleBlockPanel({ summary, officeMissing }: { summary: SheetSummary | null; officeMissing: boolean }) {
  const id = useId();
  const t = summary?.title_block;
  const rows: Array<[string, string]> = t
    ? [
        ["사무소", t.office_name || "(비어 있음)"],
        ["프로젝트", t.project_name],
        ["도면명", t.sheet_title],
        ["축척", t.scale_label],
        ["작성일", t.date],
        ["규칙 팩", t.rule_pack_version + (t.pending_changes ? ` · 이후 개정 ${t.pending_changes}건` : "")],
      ]
    : [];
  return (
    <Panel title="표제란" id={`${id}-tb`}>
      {officeMissing ? (
        <Banner tone="warn" title="사무소 정보가 없습니다">
          표제란에 사무소명이 비어 나옵니다.{" "}
          <Link to="/settings/drafting" className="focus-ring rounded-sm text-info underline">
            도면 설정에서 입력
          </Link>
        </Banner>
      ) : null}
      {t ? (
        <dl className="flex flex-col gap-1 text-caption">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-wrap gap-1">
              <dt className="w-16 shrink-0 text-fg-3">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-caption text-fg-3">시트를 만들면 표제란 값이 보입니다.</p>
      )}
      <p className="text-caption text-fg-2">
        {t ? t.disclaimer : "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다"}
        {t?.watermark ? " · 체험판" : ""}
      </p>
      <p className="text-caption text-fg-3">고지는 모든 시트에 고정이며 지울 수 없습니다. 표제란은 읽기 전용입니다.</p>
      <Link to="/settings/drafting" className="focus-ring w-fit rounded-sm text-caption text-info underline">
        표제란 설정 바꾸기
      </Link>
    </Panel>
  );
}

/* ---------- 레이어 매핑 ---------- */

export function LayerPanel({ profile }: { profile: DraftingProfile }) {
  const id = useId();
  const rows = LAYER_ROWS.map((r) => ({
    id: r.name,
    std: <span className="font-mono text-caption">{r.name}</span>,
    out: <span className="font-mono text-caption">{profile.layer_map[r.name] ?? r.name}</span>,
    line: LINETYPE_LABEL[r.linetype],
    desc: r.description,
  }));
  const changed = LAYER_ROWS.filter((r) => profile.layer_map[r.name] !== undefined && profile.layer_map[r.name] !== r.name).length;
  return (
    <Panel title="레이어 매핑 미리보기" id={`${id}-layer`}>
      <p className="text-caption text-fg-2">DXF 내보내기에서 사무소 매핑을 고르면 아래 이름으로 나옵니다. {changed > 0 ? `바꾼 이름 ${changed}개` : "바꾼 이름이 없어 표준 이름을 씁니다."}</p>
      <details className="min-w-0">
        <summary className="focus-ring cursor-pointer rounded-control text-body font-medium text-fg">레이어 표 보기(16개)</summary>
        <div className="mt-2">
          <Table
            caption="표준 레이어와 내보내는 이름"
            columns={[
              { key: "std", header: "표준 이름" },
              { key: "out", header: "내보낼 이름" },
              { key: "line", header: "선 종류" },
              { key: "desc", header: "쓰임" },
            ]}
            rows={rows}
          />
        </div>
      </details>
      <Link to="/settings/drafting" className="focus-ring w-fit rounded-sm text-caption text-info underline">
        매핑 바꾸기
      </Link>
    </Panel>
  );
}

/* ---------- 미리보기 ---------- */

export type PreviewData =
  | { status: "loading" }
  | { status: "ready"; url: string; summary: SheetSummary }
  | { status: "error"; code: string; title: string; description: string; action?: ReactNode };

export const ZOOMS = [100, 150, 200, 300] as const;

export function PreviewPane({ data, zoom, onZoom, name, watermark }: { data: PreviewData; zoom: number; onZoom(z: number): void; name: string; watermark: boolean }) {
  const id = useId();
  const idx = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
  return (
    <Panel title="미리보기" id={`${id}-prev`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onZoom(100)} disabled={zoom === 100}>
          맞춤
        </Button>
        <Button size="sm" aria-label="축소" disabled={idx <= 0} onClick={() => onZoom(ZOOMS[Math.max(0, idx - 1)] as number)}>
          축소
        </Button>
        <Button size="sm" aria-label="확대" disabled={idx >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[Math.min(ZOOMS.length - 1, idx + 1)] as number)}>
          확대
        </Button>
        <span className="text-caption text-fg-2" aria-live="polite">
          {zoom}%
        </span>
        {data.status === "ready" ? (
          <span className="text-caption text-fg-2">
            {data.summary.paper.size} · {data.summary.title_block.scale_label}
          </span>
        ) : null}
        {watermark ? <Badge tone="warn">체험판 표시</Badge> : null}
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${name} 미리보기 영역(방향키로 이동)`}
        className="focus-ring max-h-[70dvh] min-h-64 overflow-auto rounded-control border border-line bg-bg"
      >
        {data.status === "loading" ? (
          <div className="p-pad">
            <LoadingState label="도면 생성 중" rows={4} />
          </div>
        ) : data.status === "error" ? (
          <div className="p-pad">
            <Banner tone="danger" title={data.title} action={data.action}>
              {data.description}
            </Banner>
          </div>
        ) : (
          // SVG는 <img>로만 그린다(스크립트 실행 경로 없음). 흰 종이 위 그림이라 어두운 테마에서도 그대로 보인다.
          <img src={data.url} alt={`${name}, ${data.summary.paper.size} ${data.summary.title_block.scale_label}, 표제란 포함 도면 미리보기`} className="block h-auto max-w-none bg-sheet-paper" style={{ width: `${zoom}%` }} />
        )}
      </div>
    </Panel>
  );
}
