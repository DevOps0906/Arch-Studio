// `/projects/:id/model` 모델러 + 판정 패널(03장 3.5절, 2.2절). 소유: AR-06-036(modeler/**, suggest/ 제외).
// 함께 쓰는 폴더: 판정 패널 features/src/judgment/**(AR-06-037, 공개 파일 index.ts만), 매스 자동 제안 modeler/suggest/**(AR-06-028).
// - 3D 뷰포트(three·R3F)는 지연 로드 청크(viewport/Viewport.tsx). 이 파일·패널·상태는 three를 import하지 않는다.
// - 기하는 결정적 순수 함수만(state/commands.ts, 엔진 워커). 판정은 useJudgment(judge 레인, 최신만 유효)로만 요청하고 이 화면은 계산하지 않는다.
// - Manifold는 엔진 워커에서만(mass_meshes·mass_excess). 드래그 중에는 mesh 위치만 바꾸고, 초과분은 움직인 매스 1개만 합쳐서 요청, 놓으면 전체.
// - 열람(체험·구독 만료)·좁은 화면(~767)은 편집 잠금: 도구 막대 숨김 + 리듀서 거부(이중 차단).
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { Banner, Button, Toast, ToastRegion } from "@arch-studio/ui";
import { useSearchParams } from "react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { JudgmentPanel, useJudgment } from "../judgment/index.ts";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Workspace,
  bridgeErrorCode,
  bridgeErrorText,
  useAdapters,
  useCapabilities,
  useDisplayPrefs,
  useEngine,
  useEntitlement,
  usePreviewState,
  useProject,
  useShellStatus,
  useWorkspaceJudgment,
  useWorkspaceReveal,
} from "../shell/index.ts";
import { ModelerEngineClient } from "./engine/client.ts";
import { nextJudgeInput } from "./engine/coalesce.ts";
import { Inspector, FLOOR_HEIGHT_INPUT_ID } from "./panels/Inspector.tsx";
import { LayerPanel } from "./panels/LayerPanel.tsx";
import { statusSummary } from "./panels/StatusBar.tsx";
import { MeasureList, SectionControls } from "./panels/MeasureSection.tsx";
import { Toolbar } from "./panels/Toolbar.tsx";
import { useLayoutKind } from "./panels/layout.ts";
import { modelerAccess } from "./state/access.ts";
import { parseModelJson, sameModelJson } from "./state/load.ts";
import { createModelerState, isDirty, massLabel, modelerReducer, previewModel, type Action, type Command } from "./state/store.ts";
import { SuggestSection, suggestPreviewKind } from "./suggest/index.tsx";
import { isTypingTarget, keyAction } from "./tools/keymap.ts";
import { readSceneColors, type SceneColors } from "./viewport/colors.ts";
import type { ViewportHandle } from "./viewport/Viewport.tsx";
import type { Model } from "./state/commands.ts";

const Viewport = lazy(() => import("./viewport/Viewport.tsx"));

export function Screen() {
  const { load } = useProject();
  const preview = usePreviewState("ready");
  if (preview === "loading" || load.status !== "ready") return <LoadingState label="모델을 불러오는 중" />;
  return <ModelerScreen key={load.record.id} record={load.record} preview={preview} />;
}

/** 저장 직후 reload로 화면 상태가 바뀌어도 성공 알림을 보이기 위한 표시. */
let lastSaved: { id: string; version: number } | null = null;

type SaveState = { status: "idle" } | { status: "saving" } | { status: "conflict" } | { status: "failed"; message: string };

function hasWebGL2(): boolean {
  try {
    return typeof document !== "undefined" && document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

function ModelerScreen({ record, preview }: { record: ProjectRecord; preview: ReturnType<typeof usePreviewState> }) {
  const parsed = useMemo(() => parseModelJson(record.designModel), [record.designModel]);
  const { reload } = useProject();
  if (preview === "error" || !parsed.ok) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="모델·판정" />
        <ErrorState
          title="이 프로젝트의 설계 모델을 읽지 못했습니다"
          description="파일이 손상되었거나 이 버전에서 읽을 수 없는 형식입니다. 프로젝트 목록에서 다시 열거나 백업에서 복구하세요."
          onRetry={reload}
        />
      </div>
    );
  }
  // ?state=empty 미리보기: 매스를 비운 모델로 빈 상태를 보인다(저장하지 않는 한 원본 그대로).
  const initial = preview === "empty" ? { ...parsed.model, masses: [] } : parsed.model;
  return <Modeler record={record} initial={initial} />;
}

function Modeler({ record, initial }: { record: ProjectRecord; initial: Model }) {
  const { reload } = useProject();
  const { projects } = useAdapters();
  const { by } = useCapabilities();
  const host = useEngine();
  const prefs = useDisplayPrefs();
  const { setSaveLabel } = useShellStatus();
  const layout = useLayoutKind();
  const access = modelerAccess(useEntitlement(by("localProjects", "desktop_edit", "web_edit")), layout !== "narrow");
  const [s, dispatch] = useReducer(modelerReducer, initial, (m) => createModelerState(m, { editable: access.editable, reason: access.reason }));
  const present = s.history.present;
  const preview = useMemo(() => previewModel(s), [s]);
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(() => (lastSaved && lastSaved.id === record.id && lastSaved.version === record.version ? "모델을 저장했습니다." : null));
  const viewport = useRef<ViewportHandle>(null);
  const [webgl] = useState(hasWebGL2);
  const rootRef = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState<SceneColors | null>(null);
  // 매스 자동 제안(AR-06-028, suggest/): 열고 닫는 상태만 여기 둔다. `?state=suggest-*`는 데모 미리보기(개발 서버).
  const suggestKind = suggestPreviewKind(useSearchParams()[0].get("state"));
  const [suggestOpen, setSuggestOpen] = useState(suggestKind !== null);

  useEffect(() => {
    dispatch({ type: "access", editable: access.editable, reason: access.reason });
  }, [access.editable, access.reason]);

  // 테마가 바뀌면 장면 색(토큰)을 다시 읽는다.
  useEffect(() => {
    if (rootRef.current) setColors(readSceneColors(rootRef.current));
  }, [prefs]);

  // 저장 후 reload: 같은 모델이면 기준만 옮기고(이력 유지), 다른 모델(충돌 뒤 최신 열기 등)이면 새로 연다.
  const lastRecord = useRef(record);
  useEffect(() => {
    if (lastRecord.current === record) return;
    lastRecord.current = record;
    const next = parseModelJson(record.designModel);
    if (!next.ok) return;
    if (sameModelJson(present, record.designModel)) dispatch({ type: "saved", model: present });
    else dispatch({ type: "reset", model: next.model });
    // present는 비교용으로만 읽는다(기록이 바뀔 때만 실행).
  }, [record]);

  const dirty = isDirty(s);
  useEffect(() => {
    setSaveLabel(dirty ? "저장하지 않은 변경 있음" : null);
    return () => setSaveLabel(null);
  }, [dirty, setSaveLabel]);
  useEffect(() => {
    if (toast) lastSaved = null;
  }, [toast]);

  // 엔진 클라이언트(표시 메시). 이 effect가 다른 요청 effect보다 먼저 돈다(선언 순서). 화면을 떠나면 대기 요청을 취소한다.
  const client = useMemo(() => new ModelerEngineClient(host), [host]);
  useEffect(() => client.connect(), [client]);
  const engine = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  useEffect(() => client.syncMeshes(present.masses), [client, present]);
  useEffect(() => {
    if (!s.drag) client.requestExcess(present, null);
  }, [client, present, s.drag]);
  useEffect(() => {
    if (s.drag && (s.drag.dx !== 0 || s.drag.dy !== 0)) client.requestExcess(preview, [s.drag.id]);
  }, [client, preview, s.drag]);

  // 판정: judge 레인. 판정 중에는 입력을 합친다(드래그 매 프레임 요청 대신 응답마다 최신 1건).
  const [judgeInput, setJudgeInput] = useState<Model>(preview);
  const rev = useRef(0);
  const judgeRev = useMemo(() => `${record.version}:${(rev.current += 1)}`, [judgeInput, record.version]);
  const judgment = useJudgment({ model: judgeInput.masses.length > 0 ? judgeInput : null, modelRev: judgeRev });
  const busy = judgment.phase === "loading";
  // 판정 요약을 셸(6단계 막대·패널 띠·상태줄)에 올린다(03장 9.3절).
  useWorkspaceJudgment(judgment, judgeInput.masses.length > 0);
  useEffect(() => {
    const next = nextJudgeInput(preview, judgeInput, busy);
    if (next !== judgeInput) setJudgeInput(next);
  }, [preview, judgeInput, busy]);

  const onCommand = useCallback((c: Command) => dispatch({ type: "command", command: c }), []);

  const onSave = useCallback(async () => {
    if (!s.editable || !dirty || save.status === "saving") return;
    setSave({ status: "saving" });
    try {
      const saved = await projects.save({
        id: record.id,
        name: record.name,
        siteLabel: record.siteLabel,
        clientName: record.clientName,
        clientContact: record.clientContact,
        schemaVersion: record.schemaVersion,
        engineVersion: record.engineVersion,
        designModel: JSON.stringify(present),
        note: "모델 수정",
        expectedVersion: record.version,
      });
      lastSaved = { id: record.id, version: saved.version };
      setSave({ status: "idle" });
      setToast("모델을 저장했습니다.");
      reload();
    } catch (e) {
      if (bridgeErrorCode(e) === "VERSION_CONFLICT") setSave({ status: "conflict" });
      else setSave({ status: "failed", message: bridgeErrorText(e) });
    }
  }, [s.editable, dirty, save.status, projects, record, present, reload]);

  // 단축키(03장 6.1절). 입력칸에서는 Ctrl 조합만.
  // 압출(E·버튼): 오른쪽 패널과 '속성' 절을 펼친 뒤 층고 입력에 포커스(접혀 있으면 입력이 숨어 있다).
  const reveal = useWorkspaceReveal();
  const focusExtrude = useCallback(() => reveal("inspector", FLOOR_HEIGHT_INPUT_ID), [reveal]);
  const keyState = useRef({ s, onSave, focusExtrude });
  keyState.current = { s, onSave, focusExtrude };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { s: st, onSave: save, focusExtrude: extrude } = keyState.current;
      const a = keyAction(
        { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey },
        { tool: st.tool, drawing: st.tool === "draw" && st.draft.length > 0, hasSelection: st.selection !== null, typing: isTypingTarget(e.target as HTMLElement | null) },
      );
      if (!a) return;
      e.preventDefault();
      const d = (x: Action) => dispatch(x);
      switch (a.type) {
        case "undo":
        case "redo":
        case "fit":
        case "draftClose":
        case "draftPop":
          d({ type: a.type });
          return;
        case "save":
          void save();
          return;
        case "tool":
          d({ type: "tool", tool: a.tool });
          return;
        case "extrude":
          extrude();
          return;
        case "measurePop":
          d({ type: "measurePop" });
          return;
        case "toggleEnvelope":
          d({ type: "toggleLayer", layer: "envelope" });
          return;
        case "camera":
          d({ type: "camera", mode: a.mode });
          return;
        case "delete":
          if (st.selection) d({ type: "command", command: { type: "delete", id: st.selection } });
          return;
        case "nudge":
          if (st.selection) d({ type: "command", command: { type: "move", id: st.selection, dx: a.dx, dy: a.dy } });
          return;
        case "orbit":
          viewport.current?.orbit(a.dAzimuth, a.dPolar);
          return;
        case "escape":
          if (st.drag) d({ type: "dragCancel" });
          else if (st.draft.length > 0) d({ type: "draftCancel" });
          else if (st.measureStart) d({ type: "measureCancel" });
          else if (st.sectionDraft) d({ type: "sectionCancel" });
          else if (st.tool !== "select") d({ type: "tool", tool: "select" });
          else d({ type: "select", id: null });
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const undoLabel = s.history.past[s.history.past.length - 1]?.label ?? null;
  const redoLabel = s.history.future[0]?.label ?? null;
  const summary = statusSummary(present, judgment.data);
  const massIds = present.masses.map((m) => m.id);
  const excessIds = [...engine.excess.keys()].filter((id) => present.masses.some((m) => m.id === id));

  const judgmentPanel = (
    <JudgmentPanel
      phase={judgment.phase}
      data={judgment.data}
      errorCode={judgment.error?.code ?? null}
      onRetry={judgment.retry}
      hasMass={present.masses.length > 0}
      emptyAction={
        s.editable ? (
          <Button size="sm" icon="pentagon" onClick={() => dispatch({ type: "tool", tool: "draw" })}>
            매스 그리기 M
          </Button>
        ) : undefined
      }
      massIds={massIds}
      onHighlight={(ids) => dispatch({ type: "highlight", ids })}
    />
  );
  const layers = (
    <LayerPanel
      model={present}
      hidden={s.hidden}
      selection={s.selection}
      engine={engine}
      onToggle={(layer) => dispatch({ type: "toggleLayer", layer })}
      onSelect={(id) => dispatch({ type: "select", id })}
      onRetryEnvelope={() => client.retry(present)}
    />
  );
  const inspector = (
    <Inspector
      model={present}
      selection={s.selection}
      editable={s.editable}
      draftFloors={s.draftFloors}
      draftFloorHeight={s.draftFloorHeight}
      onCommand={onCommand}
      onDraftDefaults={(d) => dispatch({ type: "draftDefaults", ...d })}
    />
  );

  const suggest = suggestOpen ? (
    <SuggestSection
      model={present}
      editable={s.editable}
      lockReason={s.lockReason}
      preview={suggestKind}
      onApply={(masses) => dispatch({ type: "command", command: { type: "suggest", masses } })}
      onClose={() => setSuggestOpen(false)}
    />
  ) : null;

  // 캔버스 슬롯(03장 9.2절): 도구 막대 + 3D 보기가 캔버스 높이를 채운다. 매스 제안은 오른쪽 패널 절로 옮긴다.
  const view = (
    <section aria-labelledby="modeler-view-title" className="flex h-full min-h-0 min-w-0 flex-col gap-2 p-2">
      <h2 id="modeler-view-title" className="sr-only">
        3D 보기
      </h2>
      <Toolbar
        editable={s.editable}
        tool={s.tool}
        hasSelection={s.selection !== null}
        envelopeVisible={!s.hidden.includes("envelope")}
        camera={s.camera}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        onTool={(tool) => dispatch({ type: "tool", tool })}
        onExtrude={focusExtrude}
        onToggleEnvelope={() => dispatch({ type: "toggleLayer", layer: "envelope" })}
        onCamera={(mode) => dispatch({ type: "camera", mode })}
        onFit={() => dispatch({ type: "fit" })}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
      />
      {s.tool === "draw" ? (
        <p className="text-caption text-fg-2">
          바닥 꼭짓점을 차례로 찍습니다(100mm 격자). 첫 점을 다시 찍거나 Enter로 닫고, Backspace로 마지막 점을 지우고, Esc로 취소합니다. 찍은 점 {s.draft.length}개 · 새 매스 {s.draftFloors}층 × {s.draftFloorHeight.toLocaleString("ko-KR")}mm
        </p>
      ) : null}
      <MeasureList
        measures={s.measures}
        start={s.measureStart}
        active={s.tool === "measure"}
        onDelete={(id) => dispatch({ type: "measureDelete", id })}
        onClear={() => dispatch({ type: "measureClear" })}
      />
      <SectionControls
        section={s.section}
        draft={s.sectionDraft !== null}
        active={s.tool === "section"}
        view={s.sectionView}
        onPreset={() => dispatch({ type: "sectionPreset" })}
        onView={(on) => dispatch({ type: "sectionView", on })}
        onClear={() => dispatch({ type: "sectionClear" })}
      />
      <div className="relative min-h-64 w-full flex-1 overflow-hidden rounded-control border border-line bg-viewport">
        {!webgl ? (
          <div className="flex h-full items-center justify-center p-pad text-center text-body text-fg-2">
            이 환경에서는 3D 보기를 열 수 없습니다(WebGL2 필요). 레이어·속성·판정은 그대로 볼 수 있습니다.
          </div>
        ) : colors ? (
          <Suspense fallback={<LoadingState label="3D 보기를 여는 중" rows={1} />}>
            <Viewport
              handleRef={viewport}
              model={present}
              selection={s.selection}
              highlight={s.highlight}
              drag={s.drag}
              tool={s.tool}
              draft={s.draft}
              hidden={s.hidden}
              camera={s.camera}
              fitN={s.fitN}
              editable={s.editable}
              measures={s.measures}
              measureStart={s.measureStart}
              section={s.section}
              sectionDraft={s.sectionDraft}
              sectionView={s.sectionView}
              engine={engine}
              colors={colors}
              dispatch={dispatch}
            />
          </Suspense>
        ) : null}
      </div>
      {excessIds.length > 0 && !s.hidden.includes("excess") ? (
        <Banner tone="warn" title="엔벨로프 밖으로 나간 부분이 있습니다">
          빨간 부분: {excessIds.map((id) => massLabel(present, id)).join(", ")}. 판정 수치는 판정 패널을 확인하세요.
        </Banner>
      ) : null}
      {engine.envelopeStatus === "loading" ? <p className="text-caption text-fg-3">엔벨로프를 만드는 중입니다…</p> : null}
    </section>
  );

  // 권리 잠금 배너("열람 모드: …")는 ProjectShell이 이미 그린다. 여기서는 화면 폭 잠금(6.4절)만 알린다.
  const lockBanner =
    access.kind === "narrow" ? (
      <Banner tone="info" title="읽기 전용 보기">
        {access.reason}
      </Banner>
    ) : null;

  const notices =
    lockBanner || save.status !== "idle" || s.notice?.tone === "warn" ? (
      <>
        {lockBanner}
        {save.status === "conflict" ? (
          <ErrorState
            title="다른 곳에서 이 프로젝트가 먼저 저장되었습니다"
            description="병합하지 않습니다. 최신을 열면 저장하지 않은 모델 변경은 사라집니다."
            action={
              <Button size="sm" onClick={reload}>
                최신 열기
              </Button>
            }
          />
        ) : null}
        {save.status === "failed" ? <ErrorState title="모델을 저장하지 못했습니다" description={save.message} /> : null}
        {s.notice?.tone === "warn" ? (
          <Banner tone="warn" title="확인하세요">
            {s.notice.text}
          </Banner>
        ) : null}
      </>
    ) : undefined;

  return (
    <div ref={rootRef} className="contents">
      <Workspace
        title="모델·판정"
        description="엔벨로프 안에서 매스를 그리고 움직이며 판정을 봅니다. 판정은 참고 자료이며 최종 판단은 건축사와 허가권자가 합니다."
        actions={
          <>
            <Button size="sm" icon="sparkles" aria-expanded={suggestOpen} onClick={() => setSuggestOpen((v) => !v)}>
              매스 제안
            </Button>
            {s.editable ? (
              <Button size="sm" variant="primary" icon="check" onClick={() => void onSave()} loading={save.status === "saving"} disabled={!dirty} aria-keyshortcuts="Control+S">
                저장
              </Button>
            ) : null}
          </>
        }
        list={layers}
        listTitle="객체·레이어"
        canvas={view}
        canvasLabel="3D 보기"
        notices={notices}
        panels={[
          ...(suggest ? [{ id: "suggest", title: "매스 제안", content: suggest }] : []),
          { id: "inspector", title: "속성", content: inspector },
          { id: "judgment", title: "판정", content: judgmentPanel, defaultOpen: true },
        ]}
        panelsTitle="속성·판정"
        status={
          <>
            <span>매스 {summary.masses}개</span>
            <span>지상 최고 {summary.maxLevel}층</span>
            <span>판정은 참고 자료입니다</span>
            {s.notice?.tone === "info" ? <span className="min-w-0 truncate">{s.notice.text}</span> : null}
          </>
        }
      >
        <p role="status" aria-live="polite" className="sr-only">
          {s.notice?.text ?? ""}
        </p>
        {toast ? (
          <ToastRegion>
            <Toast tone="ok" title={toast} onClose={() => setToast(null)} />
          </ToastRegion>
        ) : null}
      </Workspace>
    </div>
  );
}
