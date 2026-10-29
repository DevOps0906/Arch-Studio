// `/projects/:id/site` 대지(03장 3.4절, 2.2·2.4절, 5장). 소유: AR-06-035.
// 대지 입력 3경로: ① 주소·지번 조회(`POST /api/site/lookup`, 공공 API 값은 입력 후보) ② 직접 그리기(좌표 표 + SVG 클릭, 기본 경로·D-14)
// ③ DXF 가져오기(useAdapters().files.openImport("dxf") → packages/io importDxf, 단위가 모호하면 확인 대화상자 필수).
// 후보는 사용자가 "이 경계 쓰기"로 확정해야 초안에 들어가고, 저장은 adapters.projects.save(버전 충돌 VERSION_CONFLICT) 후 reload().
// 편집 권리(desktop_edit/web_edit)가 없으면 열람만(체험만료 5.1절 문구). 주소 문자열은 React 기본 이스케이프로만 그린다.
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import type { DxfUnit } from "@arch-studio/io";
import type { Point } from "@arch-studio/domain";
import { Banner, Button, Checkbox, Field, Input, Select, Toast, ToastRegion } from "@arch-studio/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { isApiError } from "../api-client/index.ts";
import {
  EmptyBlock,
  ErrorState,
  LoadingState,
  LockedState,
  PageHeader,
  bridgeErrorCode,
  bridgeErrorText,
  useAdapters,
  useApi,
  useCapabilities,
  useEntitlement,
  useOnline,
  usePreviewState,
  useProject,
  useShellStatus,
} from "../shell/index.ts";
import { LOOKUP_TEXT, lookupFailure, lookupInputOk, siteAccess, type LookupFailure } from "./access.ts";
import { DXF_TEXT, candidateFromDxf, confirmUnit, dxfNext, type DxfFlow } from "./dxf-flow.ts";
import {
  USE_DISTRICTS,
  applyDraft,
  candidateFromLookup,
  draftFromModel,
  draftWithCandidate,
  formatMm,
  hasSite,
  outlineIssue,
  parseAngleInput,
  parseDesignModel,
  parseLookupData,
  parseMmInput,
  roadsAfterRemove,
  sameDraft,
  vertexWarning,
  type SiteCandidateView,
  type SiteDraft,
} from "./model.ts";
import { CandidateList, CoordinateTable, MetricsReadout, SiteCanvas, UnitDialog } from "./parts.tsx";

/** 저장 직후 reload()로 화면이 다시 그려져도 성공 알림을 보이기 위한 표시(프로젝트 id·버전). */
let lastSaved: { id: string; version: number } | null = null;

export function Screen() {
  const { load } = useProject();
  const preview = usePreviewState("ready");
  if (preview === "loading" || load.status !== "ready") return <LoadingState label="대지를 불러오는 중" />;
  return <SiteScreen key={`${load.record.id}:${load.record.version}`} record={load.record} preview={preview} />;
}

type LookupKind = "address" | "jibun" | "pnu";
type LookupState = { status: "idle" } | { status: "loading" } | { status: "failed"; failure: LookupFailure };
type SaveState = { status: "idle" } | { status: "saving" } | { status: "conflict" } | { status: "failed"; message: string; issues?: string[] };
type Candidates = { items: SiteCandidateView[]; selected: number; notice: string; warning: string | null };

const KIND_LABEL: Readonly<Record<LookupKind, string>> = { address: "도로명 주소", jibun: "지번", pnu: "PNU(19자리)" };
const KIND_PLACEHOLDER: Readonly<Record<LookupKind, string>> = {
  address: "예: 경기도 성남시 분당구 운중로 135",
  jibun: "예: 성남시 분당구 운중동 12-4",
  pnu: "예: 4113510900100120004",
};

function SiteScreen({ record, preview }: { record: ProjectRecord; preview: ReturnType<typeof usePreviewState> }) {
  const { reload } = useProject();
  const { projects, files } = useAdapters();
  const api = useApi();
  const online = useOnline();
  const { by } = useCapabilities();
  const access = siteAccess(useEntitlement(by("localProjects", "desktop_edit", "web_edit")), online);
  const { setSaveLabel } = useShellStatus();

  const parsed = useMemo(() => parseDesignModel(record.designModel), [record.designModel]);
  const initial = useMemo(() => (parsed.ok ? draftFromModel(parsed.model) : null), [parsed]);
  const [draft, setDraft] = useState<SiteDraft | null>(initial);
  const siteExists = parsed.ok && hasSite(parsed.model) && preview !== "empty";
  const [drawing, setDrawing] = useState(false);
  const [started, setStarted] = useState(siteExists);
  const [lookupKind, setLookupKind] = useState<LookupKind>("jibun");
  const [lookupValue, setLookupValue] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [remaining, setRemaining] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [flow, setFlow] = useState<DxfFlow>({ step: "idle" });
  const bytesRef = useRef<Uint8Array | null>(null);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(() => (lastSaved && lastSaved.id === record.id && lastSaved.version === record.version ? "대지를 저장했습니다." : null));
  const [angleText, setAngleText] = useState(initial ? String(initial.north_angle_deg) : "0");
  const [districtText, setDistrictText] = useState(initial ? initial.districts.join(", ") : "");

  const dirty = draft !== null && initial !== null && !sameDraft(draft, initial);
  useEffect(() => {
    setSaveLabel(dirty ? "저장하지 않은 변경 있음" : null);
    return () => setSaveLabel(null);
  }, [dirty, setSaveLabel]);
  useEffect(() => {
    if (toast) lastSaved = null;
  }, [toast]);

  if (preview === "error" || !parsed.ok || !draft || !initial) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="대지" />
        <ErrorState
          title="이 프로젝트의 설계 모델을 읽지 못했습니다"
          description="파일이 손상되었거나 이 버전에서 읽을 수 없는 형식입니다. 프로젝트 목록에서 다시 열거나 백업에서 복구하세요."
          onRetry={reload}
        />
      </div>
    );
  }

  const model = parsed.model;
  const edit = access.edit;
  const update = (patch: Partial<SiteDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function runLookup() {
    if (!lookupInputOk(lookupKind, lookupValue)) {
      setLookup({ status: "failed", failure: { message: LOOKUP_TEXT.invalid, toDraw: false } });
      return;
    }
    setLookup({ status: "loading" });
    try {
      const data = await api.request({
        method: "POST",
        path: "/api/site/lookup",
        body: { query: { kind: lookupKind, value: lookupValue } },
        idempotencyKey: api.newIdempotencyKey(),
        parse: (d) => {
          const v = parseLookupData(d);
          if (!v) throw new Error("invalid");
          return v;
        },
      });
      setRemaining(data.remaining_today);
      const c = candidateFromLookup(data);
      if (!c) {
        setLookup({ status: "failed", failure: { message: LOOKUP_TEXT.badCandidate, toDraw: true } });
        return;
      }
      setLookup({ status: "idle" });
      setCandidates({ items: [c], selected: 0, notice: data.notice, warning: null });
    } catch (e) {
      const failure = isApiError(e) ? lookupFailure(e.code, e.details?.reason, e.userMessage) : { message: LOOKUP_TEXT.AR021, toDraw: true };
      setLookup({ status: "failed", failure });
    }
  }

  function startDrawing() {
    setStarted(true);
    setDrawing(true);
    setLookup({ status: "idle" });
  }

  async function parseDxf(unit?: DxfUnit) {
    const bytes = bytesRef.current;
    if (!bytes) return;
    setFlow({ step: "reading" });
    await new Promise((r) => setTimeout(r, 0)); // 로딩 표시를 먼저 그린다(파싱은 메인 스레드, 20MB 약 1.5초 — 로그 "미해결")
    const { importDxf } = await import("@arch-studio/io");
    const next = dxfNext(importDxf(bytes, unit ? { unit } : {}), unit !== undefined);
    if (next.step === "choose") {
      bytesRef.current = null;
      setCandidates({
        items: next.candidates.map(candidateFromDxf),
        selected: 0,
        notice: "DXF에서 찾은 닫힌 선입니다. 대지 경계로 쓸 선을 고르세요. 정북 방향은 아래 속성에서 지정합니다.",
        warning: next.warning,
      });
      setFlow({ step: "idle" });
    } else {
      setFlow(next);
    }
  }

  async function startDxf() {
    setFlow({ step: "reading" });
    try {
      bytesRef.current = await files.openImport("dxf");
    } catch (e) {
      const code = bridgeErrorCode(e);
      if (code === "CANCELLED") setFlow({ step: "idle" });
      else setFlow({ step: "error", message: code === "AR055" ? DXF_TEXT.AR055 : bridgeErrorText(e) });
      return;
    }
    await parseDxf();
  }

  function chooseUnit(u: DxfUnit) {
    if (flow.step === "confirm_unit") {
      const r = confirmUnit(flow, u);
      if ("rerun" in r) void parseDxf(r.rerun);
      else if (r.next.step === "choose") {
        const next = r.next;
        bytesRef.current = null;
        setCandidates({ items: next.candidates.map(candidateFromDxf), selected: 0, notice: "DXF에서 찾은 닫힌 선입니다. 대지 경계로 쓸 선을 고르세요.", warning: next.warning });
        setFlow({ step: "idle" });
      } else setFlow(r.next);
    } else if (flow.step === "ask_unit") void parseDxf(u);
  }

  function applyCandidate() {
    if (!candidates) return;
    const c = candidates.items[candidates.selected];
    if (!c) return;
    const next = draftWithCandidate(draft as SiteDraft, c);
    setDraft(next);
    setDistrictText(next.districts.join(", "));
    setCandidates(null);
    setStarted(true);
    setDrawing(false);
  }

  async function onSave() {
    const r = applyDraft(model, draft as SiteDraft);
    if (!r.ok) {
      setSave({ status: "failed", message: "저장하기 전에 고칠 항목이 있습니다.", issues: r.issues });
      return;
    }
    setSave({ status: "saving" });
    try {
      const saved = await projects.save({
        id: record.id,
        name: record.name,
        siteLabel: r.siteLabel ?? record.siteLabel,
        clientName: record.clientName,
        clientContact: record.clientContact,
        schemaVersion: record.schemaVersion,
        engineVersion: record.engineVersion,
        designModel: JSON.stringify(r.model),
        note: "대지 수정",
        expectedVersion: record.version,
      });
      lastSaved = { id: record.id, version: saved.version };
      setSave({ status: "idle" });
      reload();
    } catch (e) {
      if (bridgeErrorCode(e) === "VERSION_CONFLICT") setSave({ status: "conflict" });
      else setSave({ status: "failed", message: bridgeErrorText(e) });
    }
  }

  const issue = draft.outer.length > 0 ? outlineIssue(draft.outer) : null;
  const vWarn = vertexWarning(draft.outer.length);
  const lookupDisabled = access.lookup !== "ok" || lookup.status === "loading";
  const actions = (
    <Button variant="primary" icon="check" onClick={onSave} loading={save.status === "saving"} disabled={!edit || !dirty}>
      저장
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-gap">
      <PageHeader title="대지" description="주소·지번 조회, 직접 그리기, DXF 가져오기로 대지 경계를 넣고 도로·정북·용도지역을 확인합니다." actions={actions} />

      {access.lockReason ? (
        <LockedState
          title="대지를 편집할 수 없습니다"
          reason={access.lockReason}
          action={
            <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
              라이선스 보기
            </Link>
          }
        />
      ) : null}

      <section aria-labelledby="site-lookup-title" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="site-lookup-title" className="text-h2 font-semibold text-fg">
            주소·지번 조회
          </h2>
          <p className="text-caption text-fg-2">{remaining !== null ? `오늘 남은 조회 ${formatMm(remaining)}회` : "조회 결과는 입력 후보입니다. 판정 기준이 아닙니다."}</p>
        </div>
        <form
          className="flex flex-col gap-2 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup();
          }}
        >
          <Field label="찾는 방법" htmlFor="site-lookup-kind" className="md:w-40">
            <Select id="site-lookup-kind" value={lookupKind} disabled={lookupDisabled} onChange={(e) => setLookupKind(e.target.value as LookupKind)}>
              {(Object.keys(KIND_LABEL) as LookupKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="주소·지번" htmlFor="site-lookup-value" className="min-w-0 flex-1">
            <Input
              id="site-lookup-value"
              value={lookupValue}
              maxLength={200}
              autoComplete="off"
              placeholder={KIND_PLACEHOLDER[lookupKind]}
              disabled={lookupDisabled}
              onChange={(e) => setLookupValue(e.target.value)}
            />
          </Field>
          <Button type="submit" icon="send" loading={lookup.status === "loading"} disabled={lookupDisabled || lookupValue.trim() === ""}>
            조회
          </Button>
        </form>
        {access.lookup === "offline" ? <p className="text-caption text-fg-2">{LOOKUP_TEXT.offline}</p> : null}
      </section>

      {lookup.status === "failed" ? (
        <Banner
          tone="warn"
          title="대지를 불러오지 못했습니다"
          action={
            lookup.failure.toDraw && edit ? (
              <Button size="sm" icon="pentagon" onClick={startDrawing}>
                직접 그리기
              </Button>
            ) : undefined
          }
        >
          {lookup.failure.message}
        </Banner>
      ) : null}

      {flow.step === "reading" ? <LoadingState label="DXF를 읽는 중" rows={1} /> : null}
      {flow.step === "error" ? (
        <ErrorState title="DXF에서 대지를 가져오지 못했습니다" description={flow.message} action={<Button size="sm" onClick={() => setFlow({ step: "idle" })}>닫기</Button>} />
      ) : null}
      <UnitDialog
        flow={flow}
        onChoose={chooseUnit}
        onCancel={() => {
          bytesRef.current = null;
          setFlow({ step: "idle" });
        }}
      />

      {candidates ? (
        <CandidateList
          candidates={candidates.items}
          selected={candidates.selected}
          onSelect={(i) => setCandidates({ ...candidates, selected: i })}
          onApply={applyCandidate}
          onDiscard={() => setCandidates(null)}
          notice={candidates.notice}
          warning={candidates.warning}
          disabled={!edit}
        />
      ) : null}

      {!started && !candidates ? (
        <EmptyBlock
          icon="inbox"
          title="대지가 없습니다"
          description="주소나 지번을 넣으면 대지 경계와 용도지역을 불러옵니다."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon="pentagon" disabled={!edit} onClick={startDrawing}>
                직접 그리기
              </Button>
              <Button icon="download" disabled={!edit || flow.step === "reading"} onClick={() => void startDxf()}>
                DXF에서 가져오기
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid min-w-0 gap-gap xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="site-view-title" className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="site-view-title" className="text-h2 font-semibold text-fg">
                대지 경계
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon="pentagon" variant={drawing ? "primary" : "secondary"} disabled={!edit} aria-pressed={drawing} onClick={() => (drawing ? setDrawing(false) : startDrawing())}>
                  {drawing ? "그리기 끝내기" : "직접 그리기"}
                </Button>
                <Button size="sm" icon="download" disabled={!edit || flow.step === "reading"} onClick={() => void startDxf()}>
                  DXF에서 가져오기
                </Button>
                <Button size="sm" variant="ghost" icon="x" disabled={!edit || draft.outer.length === 0} onClick={() => update({ outer: [], roads: {} })}>
                  경계 지우기
                </Button>
              </div>
            </div>
            <SiteCanvas
              outer={draft.outer}
              roads={draft.roads}
              northAngleDeg={draft.north_angle_deg}
              candidate={candidates ? candidates.items[candidates.selected]?.outer : null}
              drawing={drawing && edit}
              onAddPoint={(p) => update({ outer: [...draft.outer, p] })}
            />
            <MetricsReadout outer={draft.outer} />
            {issue && !drawing ? (
              <Banner tone="danger" title="대지 경계를 확인하세요">
                {issue}
              </Banner>
            ) : null}
            {vWarn ? (
              <Banner tone="warn" title="꼭짓점이 많습니다">
                {vWarn}
              </Banner>
            ) : null}
            <details className="rounded-control border border-line" open={drawing}>
              <summary className="focus-ring cursor-pointer rounded-control px-3 py-2 text-body font-medium text-fg">좌표 표(mm)로 입력·수정</summary>
              <div className="border-t border-line p-2">
                <CoordinateTable
                  outer={draft.outer}
                  disabled={!edit}
                  onChange={(i, p: Point) => update({ outer: draft.outer.map((q, j) => (j === i ? p : q)) })}
                  onRemove={(i) => update({ outer: draft.outer.filter((_, j) => j !== i), roads: roadsAfterRemove(draft.roads, i, draft.outer.length) })}
                  onAdd={(p) => update({ outer: [...draft.outer, p] })}
                />
              </div>
            </details>
          </section>

          <PropertiesPanel
            draft={draft}
            edit={edit}
            angleText={angleText}
            districtText={districtText}
            onAngle={(t) => {
              setAngleText(t);
              const v = parseAngleInput(t);
              if (v !== null) update({ north_angle_deg: v });
            }}
            onDistricts={(t) => {
              setDistrictText(t);
              update({ districts: t.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) });
            }}
            update={update}
          />
        </div>
      )}

      {save.status === "conflict" ? (
        <ErrorState
          title="다른 곳에서 이 프로젝트가 먼저 저장되었습니다"
          description="병합하지 않습니다. 서버 최신을 열면 저장하지 않은 대지 변경은 사라집니다."
          action={
            <Button size="sm" onClick={reload}>
              최신 열기
            </Button>
          }
        />
      ) : null}
      {save.status === "failed" ? (
        <ErrorState
          title={save.message}
          description={
            save.issues ? (
              <ul className="list-disc pl-5">
                {save.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      ) : null}

      {toast ? (
        <ToastRegion>
          <Toast tone="ok" title={toast} onClose={() => setToast(null)} />
        </ToastRegion>
      ) : null}
    </div>
  );
}

function PropertiesPanel({
  draft,
  edit,
  angleText,
  districtText,
  onAngle,
  onDistricts,
  update,
}: {
  draft: SiteDraft;
  edit: boolean;
  angleText: string;
  districtText: string;
  onAngle: (t: string) => void;
  onDistricts: (t: string) => void;
  update: (patch: Partial<SiteDraft>) => void;
}) {
  const districts: readonly string[] = USE_DISTRICTS.includes(draft.use_district as (typeof USE_DISTRICTS)[number]) || draft.use_district === "" ? USE_DISTRICTS : [draft.use_district, ...USE_DISTRICTS];
  const edges = draft.outer.length >= 3 ? draft.outer.length : 0;
  return (
    <section aria-labelledby="site-props-title" className="flex min-w-0 flex-col gap-gap rounded-panel border border-line bg-surface p-pad">
      <h2 id="site-props-title" className="text-h2 font-semibold text-fg">
        속성
      </h2>
      {draft.parcel.address_label || draft.parcel.pnu ? (
        <dl className="flex flex-col gap-1 text-caption">
          {draft.parcel.address_label ? (
            <div className="flex flex-wrap gap-1">
              <dt className="text-fg-3">지번</dt>
              <dd className="min-w-0 break-all text-fg">{draft.parcel.address_label}</dd>
            </div>
          ) : null}
          {draft.parcel.pnu ? (
            <div className="flex flex-wrap gap-1">
              <dt className="text-fg-3">PNU</dt>
              <dd className="text-fg tabular-nums">{draft.parcel.pnu}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <Field label="용도지역" htmlFor="site-use-district" hint="조회 값은 후보입니다. 토지이용계획확인서와 맞는지 확인하세요." error={draft.use_district === "" ? "용도지역을 고르세요." : undefined}>
        <Select id="site-use-district" value={draft.use_district} disabled={!edit} onChange={(e) => update({ use_district: e.target.value })} invalid={draft.use_district === ""}>
          <option value="">선택</option>
          {districts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="용도지구·구역(쉼표로 구분)" htmlFor="site-districts">
        <Input id="site-districts" value={districtText} maxLength={400} disabled={!edit} onChange={(e) => onDistricts(e.target.value)} placeholder="예: 지구단위계획구역" />
      </Field>
      <Field label="정북 각도" htmlFor="site-north" hint="모델 +Y축에서 정북까지 시계 방향 각도입니다." error={parseAngleInput(angleText) === null ? "숫자로 넣으세요(예: 0, 17.5)." : undefined}>
        <Input id="site-north" inputMode="decimal" suffix="°" value={angleText} disabled={!edit} invalid={parseAngleInput(angleText) === null} onChange={(e) => onAngle(e.target.value)} />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-caption font-medium text-fg-2">도로(접한 변마다 폭 입력)</legend>
        {edges === 0 ? <p className="text-caption text-fg-3">경계를 먼저 그리면 변마다 도로를 지정할 수 있습니다.</p> : null}
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {Array.from({ length: edges }, (_, i) => (
            <RoadRow key={i} index={i} width={draft.roads[i]} edit={edit} onChange={(w) => {
              const roads = { ...draft.roads };
              if (w === null) delete roads[i];
              else roads[i] = w;
              update({ roads });
            }} />
          ))}
        </ul>
      </fieldset>
      <Field label="허가 신청 예정일" htmlFor="site-app-date" hint="일조사선 신·구 기준을 이 날짜로 고릅니다.">
        <Input id="site-app-date" type="date" value={draft.application_date} disabled={!edit} onChange={(e) => update({ application_date: e.target.value })} />
      </Field>
      <Checkbox label="조례 반영 여부(지자체 조례 개정 반영)" checked={draft.ordinance_applied} disabled={!edit} onChange={(e) => update({ ordinance_applied: e.target.checked })} />
      <p className="text-caption text-fg-3">규칙 팩 {draft.rule_pack_version || "미선택"}</p>
    </section>
  );
}

function RoadRow({ index, width, edit, onChange }: { index: number; width: number | undefined; edit: boolean; onChange: (w: number | null) => void }) {
  const [text, setText] = useState(width ? String(width) : "");
  const on = width !== undefined;
  const parsed = parseMmInput(text, false);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Checkbox
        label={`변 ${index + 1}`}
        checked={on}
        disabled={!edit}
        onChange={(e) => {
          if (!e.target.checked) onChange(null);
          else {
            const w = parsed && parsed > 0 ? parsed : 6000;
            setText(String(w));
            onChange(w);
          }
        }}
      />
      {on ? (
        <Input
          aria-label={`변 ${index + 1} 도로 폭`}
          className="w-36"
          inputMode="numeric"
          suffix="mm"
          value={text}
          disabled={!edit}
          invalid={parsed === null || parsed <= 0}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseMmInput(e.target.value, false);
            if (v !== null && v > 0) onChange(v);
          }}
        />
      ) : null}
    </li>
  );
}
