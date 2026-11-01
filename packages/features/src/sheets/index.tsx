// `/projects/:id/sheets` 도면 시트·내보내기(03장 3.8절, 5.1·5.3절, PRD 4.3·9.4절). 소유: AR-06-030.
// 시트 미리보기·내보내기는 useEngine()의 drafting 워커(sheet·export 레인, 017)가 packages/drafting 순수 함수로 만든다 —
// 이 화면은 기하·도면 값을 만들지 않는다. PNG는 워커가 만든 SVG를 어댑터 Rasterizer(설치형 AR-06-080)에 넘겨 변환한다(없으면 비활성 + 이유).
// 저장은 useAdapters().files.save(format, bytes)(경로는 받지 않는다). 0 크레딧·오프라인 출력.
// 권리: view_export는 모든 상태에서 허용(실패 닫힘으로 거부되면 잠금 안내). 편집 권리가 없으면(체험·구독 만료) 설정·미리보기는 읽기 전용이고
// 마지막으로 만든 시트를 다시 내보내기만 된다. 체험판 표시는 라이선스 상태로 정하며 화면에서 끌 수 없다.
import { Badge, Banner, Button, EmptyState, Kbd, Toast, ToastRegion } from "@arch-studio/ui";
import type { DesignModelV1 } from "@arch-studio/domain";
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useJudgment } from "../judgment/index.ts";
import { defaultStorage, type StorageLike } from "../settings/drafting/cache.ts";
import {
  ErrorState,
  LoadingState,
  LockedState,
  PageHeader,
  Workspace,
  useAdapters,
  useCapabilities,
  useEngine,
  useEntitlement,
  useEntitlementStatus,
  useProject,
  usePreviewState,
  useSession,
  useWorkspaceJudgment,
} from "../shell/index.ts";
import { ExportDialog, type ExportRun, type ExportSelection } from "./ExportDialog.tsx";
import {
  AR059_TEXT,
  JUDGMENT_REQUIRED_TEXT,
  ar058Text,
  kindSupport,
  localDate,
  missingInputs,
  newSpec,
  nextPaper,
  outputErrorText,
  parseModel,
  parseStored,
  serializeStored,
  sheetAccess,
  sheetName,
  storeKey,
  MAX_SHEETS,
  type SheetInput,
  type SheetKind,
  type StoredSheets,
} from "./model.ts";
import { LayerPanel, PreviewPane, SettingsPanel, SheetList, TitleBlockPanel, type PreviewData } from "./parts.tsx";
import { createSheetBuilder, runExport } from "./runner.ts";
import { useDraftingProfile } from "./useProfile.ts";

export function Screen() {
  const { load, reload } = useProject();
  const forced = usePreviewState("ready");
  if (forced === "loading" || load.status === "loading") {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="도면" />
        <LoadingState label="도면을 불러오는 중" />
      </div>
    );
  }
  if (forced === "error" || load.status === "error") {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="도면" />
        <ErrorState title="프로젝트를 읽지 못했습니다" description="저장소를 읽는 중 문제가 생겼습니다. 다시 시도하거나 프로젝트 목록에서 다시 여세요." onRetry={reload} />
      </div>
    );
  }
  if (load.status !== "ready") return <LoadingState label="도면을 불러오는 중" />;
  return <SheetsScreen key={`${load.record.id}:${load.record.version}`} record={load.record} forcedEmpty={forced === "empty"} />;
}

function readStored(storage: StorageLike | null, projectId: string): StoredSheets {
  try {
    return parseStored(storage?.getItem(storeKey(projectId)) ?? null);
  } catch {
    return parseStored(null);
  }
}

function SheetsScreen({ record, forcedEmpty }: { record: ProjectRecord; forcedEmpty: boolean }) {
  const adapters = useAdapters();
  const engine = useEngine();
  const { by } = useCapabilities();
  const { state: sessionState } = useSession();
  const editDecision = useEntitlement(by("localProjects", "desktop_edit", "web_edit"));
  const exportDecision = useEntitlement("view_export");
  const status = useEntitlementStatus();
  const planCode = sessionState.kind === "ready" ? sessionState.session.plan_code : null;
  const access = sheetAccess(editDecision, exportDecision, status, planCode);
  const profileState = useDraftingProfile();

  const parsed = useMemo(() => parseModel(record.designModel), [record.designModel]);
  const storage = useMemo(() => defaultStorage(), []);
  const [stored, setStored] = useState<StoredSheets>(() => (forcedEmpty ? parseStored(null) : readStored(storage, record.id)));
  const [selectedId, setSelectedId] = useState<string | null>(stored.specs[0]?.id ?? null);
  const [zoom, setZoom] = useState(100);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const [preview, setPreview] = useState<PreviewData>({ status: "loading" });
  const [date] = useState(() => localDate(new Date()));
  const reqCounter = useRef(0);
  const engineVersionRef = useRef<string | null>(null);

  const model = parsed.ok ? parsed.model : null;
  const specs = stored.specs;
  const selected = specs.find((s) => s.id === selectedId) ?? specs[0] ?? null;

  const persist = useCallback(
    (next: StoredSheets) => {
      setStored(next);
      try {
        storage?.setItem(storeKey(record.id), serializeStored(next));
      } catch {
        // 보관 실패(용량·차단)는 무시한다 — 이번 실행 동안은 화면 상태로 계속 쓴다.
      }
    },
    [storage, record.id],
  );

  // 판정(규칙 팩은 엔진이 가진 것). 실패하면 판정 값 없는 시트로 만든다(안내 표시).
  const judgeEnabled = model !== null && specs.length > 0 && missingInputs(model, "site_plan").length === 0;
  const judgment = useJudgment({ model, modelRev: record.sha256, enabled: judgeEnabled });
  // 판정 요약을 셸(6단계 막대·패널 띠·상태줄)에 올린다(03장 9.3절).
  useWorkspaceJudgment(judgment, judgeEnabled);
  const judgeSettled = !judgeEnabled || judgment.phase === "ready" || judgment.phase === "error";
  const judgeFailed = judgeEnabled && judgment.phase === "error";

  const builder = useMemo(() => createSheetBuilder(engine), [engine]);

  const makeInput = useCallback(
    (spec: SheetInput["sheet"]): SheetInput | null => {
      if (!model || profileState.status !== "ready" || !judgment.data) return null;
      return {
        model,
        judgment: judgment.data.result,
        sheet: spec,
        profile: profileState.profile,
        license: { drafting_watermark: access.watermark },
        engine_version: judgment.data.result.engine_version, // 표시용 — 시트에 남는 엔진 버전은 워커가 정한다
        project_name: record.name,
        date,
      };
    },
    [model, profileState, judgment.data, access.watermark, record.name, date],
  );

  // 선택한 시트 미리보기(엔진 워커). 입력 JSON이 같으면 큐 캐시가 같은 결과를 돌려준다.
  const input = useMemo(() => (selected && judgeSettled && !access.editPending ? makeInput(selected) : null), [selected, judgeSettled, access.editPending, makeInput]);
  const inputKey = input ? JSON.stringify(input) : null;
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!input) {
      setPreview(judgeFailed ? { status: "error", code: "JUDGMENT", title: "시트를 만들 수 없습니다", description: JUDGMENT_REQUIRED_TEXT } : { status: "loading" });
      return;
    }
    let alive = true;
    setPreview({ status: "loading" });
    void builder.build(input).then((r) => {
      if (!alive) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      if (!r.ok) {
        setPreview({ status: "error", code: r.code, title: "시트를 만들지 못했습니다", description: outputErrorText(r.code) });
        return;
      }
      urlRef.current = URL.createObjectURL(new Blob([r.built.svg], { type: "image/svg+xml" }));
      setPreview({ status: "ready", url: urlRef.current, summary: r.built.summary });
      // 처음 만든 엔진 버전을 기록한다(이후 엔진이 바뀌면 AR059).
      if (stored.engine_version === null && access.edit) persist({ ...stored, engine_version: r.built.engineVersion });
      engineVersionRef.current = r.built.engineVersion;
    });
    return () => {
      alive = false;
    };
    // inputKey(JSON)가 입력 값을 대표한다.
  }, [builder, inputKey, judgeFailed]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // Ctrl+E (macOS는 ⌘E): 내보내기 대화상자.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!parsed.ok || !model) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="도면" />
        <ErrorState title="이 프로젝트의 설계 모델을 읽지 못했습니다" description="파일이 손상되었거나 이 버전에서 읽을 수 없는 형식입니다. 프로젝트 목록에서 다시 열거나 백업에서 복구하세요." />
      </div>
    );
  }

  const blocked: Partial<Record<SheetKind, string>> = {};
  for (const k of ["site_plan", "area_plan", "sunlight_section", "floor_plan"] as const) {
    const sup = kindSupport(k);
    if (!sup.ok) blocked[k] = sup.reason;
    else {
      const miss = missingInputs(model, k);
      if (miss.length > 0) blocked[k] = `빠진 정보: ${miss.map((m) => m.label).join(", ")}`;
    }
  }
  const full = specs.length >= MAX_SHEETS;

  const add = (kind: SheetKind) => {
    if (!access.edit || full) return;
    const profile = profileState.status === "ready" ? profileState.profile : null;
    const spec = newSpec(kind, specs, model, profile && (profile.default_paper === "A2" || profile.default_paper === "A1" || profile.default_paper === "A3") ? profile.default_paper : "A3");
    persist({ ...stored, specs: [...specs, spec] });
    setSelectedId(spec.id);
  };
  const remove = (id: string) => {
    if (!access.edit) return;
    const next = specs.filter((s) => s.id !== id);
    persist({ ...stored, specs: next });
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    setToast("시트를 목록에서 뺐습니다. 이미 내보낸 파일은 그대로입니다.");
  };
  const move = (id: string, dir: -1 | 1) => {
    if (!access.edit) return;
    const i = specs.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= specs.length) return;
    const next = [...specs];
    [next[i], next[j]] = [next[j] as (typeof next)[number], next[i] as (typeof next)[number]];
    persist({ ...stored, specs: next });
  };
  const change = (next: NonNullable<typeof selected>) => {
    if (!access.edit) return;
    persist({ ...stored, specs: specs.map((s) => (s.id === next.id ? next : s)) });
  };

  const names = specs.map((s) => ({ id: s.id, name: sheetName(s, specs, model) }));
  const selectedName = selected ? sheetName(selected, specs, model) : "";
  const summary = preview.status === "ready" ? preview.summary : null;
  const stale = summary !== null && stored.engine_version !== null && engineVersionRef.current !== null && stored.engine_version !== engineVersionRef.current && !staleDismissed;
  const ar058 = summary?.warnings.some((w) => w.code === "AR058") ?? false;
  const officeMissing = profileState.status === "ready" && profileState.source === "default";
  const pngSupport = adapters.rasterizer
    ? ({ ok: true } as const)
    : ({ ok: false, reason: "이 환경에는 PNG 변환기가 없습니다. 설치형 앱에서 PNG를 내보내거나 SVG·PDF를 쓰세요(웹은 서버 변환 연결 후 제공)." } as const);
  const exportReady = access.exportState === "allowed" && specs.length > 0 && judgment.data !== null && profileState.status === "ready";

  async function onRun(sel: ExportSelection, onProgress: Parameters<typeof runExport>[2]): Promise<ExportRun> {
    const chosen = specs.filter((s) => sel.ids.includes(s.id));
    const sheets: unknown[] = [];
    for (const spec of chosen) {
      const inp = makeInput(spec);
      if (!inp) return { kind: "build_failed", code: "AR050" };
      const r = await builder.build(inp);
      if (!r.ok) return { kind: "build_failed", code: r.code };
      sheets.push(r.built.sheet);
    }
    const outcome = await runExport(
      {
        formats: sel.formats,
        sheets,
        layerMap: sel.layerNames === "office" && profileState.status === "ready" ? profileState.profile.layer_map : {},
        projectName: record.name,
        date,
      },
      { engine, files: adapters.files, rasterizer: adapters.rasterizer, newReqId: () => `sheet-export-${Date.now()}-${++reqCounter.current}` },
      onProgress,
    );
    if (outcome.saved > 0 && outcome.failures.length === 0 && !outcome.canceled) setToast(`${outcome.saved}개 파일을 내보냈습니다.`);
    return { kind: "done", outcome };
  }

  const headerActions = (
    <>
      <Badge tone="neutral">0 크레딧</Badge>
      <Button variant="primary" icon="download" disabled={!exportReady} aria-keyshortcuts="Control+E" onClick={() => setExportOpen(true)}>
        내보내기 <Kbd>Ctrl+E</Kbd>
      </Button>
    </>
  );

  // 편집 권리가 없고 보관된 시트도 없으면: 권리 거부(잠금) 상태.
  const noLegacyAndLocked = !access.edit && !access.editPending && specs.length === 0;
  const hasSheets = !noLegacyAndLocked && specs.length > 0;

  const notices =
    access.exportState === "denied" || (access.viewOnly && access.editReason && !noLegacyAndLocked) || stale || (ar058 && selected && summary) || access.watermark ? (
      <>
        {access.exportState === "denied" ? <LockedState title="내보내기를 쓸 수 없습니다" reason={access.exportReason ?? "내보내기 권한을 확인하지 못했습니다."} action={<LicenseLink />} /> : null}
        {access.viewOnly && access.editReason && !noLegacyAndLocked ? (
          <Banner tone="info" title="마지막으로 만든 시트만 다시 내보낼 수 있습니다" action={<LicenseLink />}>
            {access.editReason}
          </Banner>
        ) : null}
        {stale ? (
          <Banner
            tone="warn"
            title="이전 엔진으로 만든 시트입니다"
            action={
              <div className="flex gap-2">
                <Button size="sm" disabled={!access.edit} onClick={() => engineVersionRef.current && persist({ ...stored, engine_version: engineVersionRef.current })}>
                  다시 만들기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStaleDismissed(true)}>
                  그대로 보기
                </Button>
              </div>
            }
          >
            {AR059_TEXT}
          </Banner>
        ) : null}
        {ar058 && selected && summary ? (
          <Banner
            tone="warn"
            title="용지에 들어가지 않습니다"
            action={
              nextPaper(selected.paper) && access.edit ? (
                <Button size="sm" onClick={() => change({ ...selected, paper: nextPaper(selected.paper) as typeof selected.paper })}>
                  {nextPaper(selected.paper)}로 키우기
                </Button>
              ) : undefined
            }
          >
            {ar058Text(selected.paper)}
          </Banner>
        ) : null}
        {access.watermark ? (
          <p className="rounded-control border border-line bg-surface p-2 text-caption text-fg-2" role="note">
            체험판: 출력하면 표제란에 "체험판"이 표시됩니다. 라이선스나 구독이 있으면 표시되지 않습니다.
          </p>
        ) : null}
      </>
    ) : undefined;

  // 캔버스 슬롯(03장 9.2절): 시트 미리보기. 시트 목록은 왼쪽, 시트 설정·표제란·레이어는 오른쪽 패널, 시트 이름은 아래 탭.
  const canvas = noLegacyAndLocked ? (
    <div className="p-pad">
      <LockedState title="내보낼 시트가 없습니다" reason={access.editReason ?? "새 시트를 만들 권한이 없습니다."} action={<LicenseLink />} />
    </div>
  ) : specs.length === 0 ? (
    <div className="p-pad">
      <EmptyState
        icon="inbox"
        title="아직 시트가 없습니다"
        description={blocked.site_plan ? `배치도를 만들려면 먼저 입력이 필요합니다. ${blocked.site_plan}` : "배치도부터 만들어 보세요."}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon="plus" disabled={!access.edit || blocked.site_plan !== undefined} onClick={() => add("site_plan")}>
              배치도 만들기
            </Button>
            {blocked.site_plan ? <MissingLinks model={model} /> : null}
          </div>
        }
      />
    </div>
  ) : (
    <div className="flex min-w-0 flex-col gap-gap p-2">
      {selected ? <PreviewPane data={preview} zoom={zoom} onZoom={setZoom} name={selectedName} watermark={access.watermark} /> : null}
      {preview.status === "error" && selected ? <PreviewErrorActions code={preview.code} model={model} kind={selected.kind} /> : null}
    </div>
  );

  const sheetTabs = hasSheets ? (
    <div role="group" aria-label="시트" className="flex items-center gap-1">
      {names.map((n) => (
        <button
          key={n.id}
          type="button"
          aria-pressed={selected?.id === n.id}
          onClick={() => setSelectedId(n.id)}
          className={`focus-ring inline-flex h-control-sm shrink-0 items-center rounded-control px-3 text-body whitespace-nowrap ${selected?.id === n.id ? "bg-raised font-semibold text-fg" : "text-fg-2 hover:text-fg"}`}
        >
          {n.name}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <Workspace
      title="도면"
      description="시트는 이 PC에서 0 크레딧으로 만들며 오프라인에서도 됩니다."
      actions={headerActions}
      list={
        hasSheets ? (
          <SheetList
            specs={specs}
            model={model}
            selectedId={selected?.id ?? null}
            canEdit={access.edit && !full}
            onSelect={setSelectedId}
            onDelete={remove}
            onMove={move}
            onAdd={add}
            blocked={blocked}
            engineLabel={stored.engine_version}
          />
        ) : undefined
      }
      listTitle="시트 목록"
      canvas={canvas}
      canvasLabel="시트 미리보기"
      notices={notices}
      panels={
        hasSheets
          ? [
              ...(selected ? [{ id: "settings", title: "시트 설정", content: <SettingsPanel spec={selected} name={selectedName} model={model} canEdit={access.edit} onChange={change} /> }] : []),
              { id: "titleblock", title: "표제란", content: <TitleBlockPanel summary={summary} officeMissing={officeMissing} /> },
              ...(profileState.status === "ready" ? [{ id: "layers", title: "레이어 매핑", content: <LayerPanel profile={profileState.profile} /> }] : []),
            ]
          : []
      }
      panelsTitle="시트 설정·표제란·레이어"
      tabs={sheetTabs}
      status={
        <>
          {selected ? <span>{selectedName}</span> : null}
          <span>확대 {zoom}%</span>
          <span>0 크레딧 · 오프라인 출력</span>
        </>
      }
    >
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        items={names}
        initialIds={selected ? [selected.id] : []}
        access={access}
        png={pngSupport}
        hasOfficeMap={profileState.status === "ready" && Object.keys(profileState.profile.layer_map).length > 0}
        onRun={onRun}
      />

      {toast ? (
        <ToastRegion>
          <Toast tone="ok" title={toast} onClose={() => setToast(null)} />
        </ToastRegion>
      ) : null}
    </Workspace>
  );
}

function LicenseLink() {
  return (
    <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
      라이선스 보기
    </Link>
  );
}

/** 프로젝트 탭으로 이동(03장 5.3절 AR050 "항목별 이동 버튼"). 경로는 상대: 같은 프로젝트의 형제 탭. */
function TabLink({ to, label }: { to: "site" | "model" | "plans"; label: string }) {
  const { id } = useProject();
  return (
    <Link to={`/projects/${id}/${to}`} className="focus-ring inline-flex h-control-sm items-center rounded-control border border-input px-3 text-body text-fg">
      {label}
    </Link>
  );
}

function MissingLinks({ model }: { model: DesignModelV1 }) {
  const miss = missingInputs(model, "site_plan");
  return (
    <>
      {miss.map((m) => (
        <TabLink key={m.id} to={m.to} label={`${m.label} 입력하러 가기`} />
      ))}
    </>
  );
}

function PreviewErrorActions({ code, model, kind }: { code: string; model: DesignModelV1; kind: SheetKind }) {
  if (code === "JUDGMENT") return <TabLink to="model" label="모델·판정 보기" />;
  if (code === "AR051") return <TabLink to="plans" label="평면에서 고치기" />;
  if (code === "AR050") {
    const miss = missingInputs(model, kind);
    return (
      <div className="flex flex-wrap gap-2">
        {miss.map((m) => (
          <TabLink key={m.id} to={m.to} label={`${m.label} 입력하러 가기`} />
        ))}
      </div>
    );
  }
  return null;
}
