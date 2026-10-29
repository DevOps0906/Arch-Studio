// `/projects/:id/plans` 평면 개략도 편집기(03장 3.7절, P1). 소유: AR-06-027.
// 층별 평면 위에서 실·벽·문창을 고친다. 기하·면적·겹침 검사는 @arch-studio/layout·geometry의 결정적 순수 함수(ops.ts·model.ts)만 쓰고,
// 편집은 불변 모델 + 실행취소 이력(editor.ts, 100단계)이다. 판정은 useJudgment(엔진 judge 레인), 도면 미리보기는 엔진 sheet 레인(floor_plan 뷰).
// 저장은 adapters.projects.save(버전 충돌 VERSION_CONFLICT). 겹침·외곽 이탈(AR051)이 있으면 저장하지 않는다. 편집 권리가 없거나 폭이 768 미만이면 열람만.
// 키보드: keys.ts(03장 6.1절). 포인터 전용 기능은 없다 — 끌어 놓기는 "놓기" 버튼(+Enter), 경계 끌기는 [ ] + 화살표.
import { Badge, Banner, Button, Field, Kbd, Select, Toast, ToastRegion } from "@arch-studio/ui";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { ProjectRecord } from "@arch-studio/shell-bridge";
import { useJudgment } from "../judgment/index.ts";
import {
  EmptyBlock,
  ErrorState,
  LoadingState,
  LockedState,
  PageHeader,
  bridgeErrorCode,
  bridgeErrorText,
  useAdapters,
  useCapabilities,
  useEngine,
  useEntitlement,
  useShellStatus,
  usePreviewState,
  useProject,
} from "../shell/index.ts";
import { NARROW_TEXT, plansAccess } from "./access.ts";
import { PlanCanvas } from "./canvas.tsx";
import {
  applyOp,
  currentLayout,
  doRedo,
  doUndo,
  drawAdd,
  drawBack,
  gridMm,
  initEditor,
  layouts as layoutsOf,
  moveCursor,
  arrowStep,
  select,
  setFloor,
  setTool,
  stepEdge,
  type EditorState,
  type Tool,
} from "./editor.ts";
import { canRedo, canUndo } from "./history.ts";
import { isTypingTarget, keyAction, type Action } from "./keys.ts";
import { analyze, findSlot, floorsOf, outlineOf, parseDesignModel, saveBlocker, withLayouts } from "./model.ts";
import { CheckBar, Inspector, PreviewPanel, RoomList, type PlanActions, type PreviewView } from "./panels.tsx";
import { addOpening, addOpeningAt, pointerSplit, drawRoom, mergeRooms, moveRoomEdge, rectPolygon, removeOpening, removeRoom, renameRoom, slideOpening, splitRoom, uniqueId, updateOpening } from "./ops.ts";
import { buildSheetRequest, localDate, placeholderJudgment, planSheetInput, previewErrorText, readPreviewResponse } from "./preview.ts";

/** 저장 직후 reload()로 화면이 다시 그려져도 성공 알림을 보이기 위한 표시(프로젝트 id·버전). */
let lastSaved: { id: string; version: number } | null = null;

export function Screen() {
  const { load } = useProject();
  const preview = usePreviewState("ready");
  if (preview === "loading" || load.status !== "ready") return <LoadingState label="평면을 불러오는 중" rows={4} />;
  return <PlansScreen key={`${load.record.id}:${load.record.version}`} record={load.record} preview={preview} />;
}

const TOOLS: readonly { id: Tool; label: string; key: string }[] = [
  { id: "select", label: "선택", key: "V" },
  { id: "room", label: "실 그리기", key: "R" },
  { id: "split", label: "분할", key: "X" },
  { id: "merge", label: "병합", key: "J" },
  { id: "door", label: "문", key: "D" },
  { id: "window", label: "창", key: "W" },
];

type SaveState = { status: "idle" } | { status: "saving" } | { status: "conflict" } | { status: "failed"; message: string };

/** 768(태블릿) 이상인가. 토큰 --breakpoint-md를 읽고, 못 읽으면 48rem(= 같은 값). 좁으면 열람만(03장 6.4절). */
function useWide(): boolean {
  const query = useMemo(() => {
    if (typeof matchMedia !== "function") return null;
    const bp = (typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-md").trim() : "") || "48rem";
    return matchMedia(`(min-width: ${bp})`);
  }, []);
  const [wide, setWide] = useState(query ? query.matches : true);
  useEffect(() => {
    if (!query) return;
    const on = (e: { matches: boolean }) => setWide(e.matches);
    setWide(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, [query]);
  return wide;
}

function PlansScreen({ record, preview }: { record: ProjectRecord; preview: ReturnType<typeof usePreviewState> }) {
  const { reload } = useProject();
  const { projects } = useAdapters();
  const engine = useEngine();
  const { by } = useCapabilities();
  const wide = useWide();
  const access = plansAccess(useEntitlement(by("localProjects", "desktop_edit", "web_edit")), wide);
  const { setSaveLabel } = useShellStatus();

  const parsed = useMemo(() => parseDesignModel(record.designModel), [record.designModel]);
  const model = parsed.ok ? parsed.model : null;
  const floors = useMemo(() => (model ? floorsOf(model) : []), [model]);
  const previewEmpty = preview === "empty";
  const initialLayouts = useMemo(() => {
    if (!model) return [];
    return previewEmpty ? model.floor_layouts.map((l) => ({ ...l, rooms: [], openings: [] })) : model.floor_layouts;
  }, [model, previewEmpty]);
  const [ed, setEd] = useState<EditorState>(() => initEditor(initialLayouts, floors[0]?.id ?? ""));
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(() => (lastSaved && lastSaved.id === record.id && lastSaved.version === record.version ? "평면을 저장했습니다." : null));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast) lastSaved = null;
  }, [toast]);

  const layouts = layoutsOf(ed);
  const dirty = layouts !== initialLayouts;
  useEffect(() => {
    setSaveLabel(dirty ? "저장하지 않은 변경 있음" : null);
    return () => setSaveLabel(null);
  }, [dirty, setSaveLabel]);

  const layout = currentLayout(ed);
  const outline = useMemo(() => (model && ed.floor ? outlineOf(model, ed.floor) : []), [model, ed.floor]);
  const analysis = useMemo(() => (model ? analyze(model, ed.floor, outline, layout) : null), [model, ed.floor, outline, layout]);
  const editedModel = useMemo(() => (model ? withLayouts(model, layouts) : null), [model, layouts]);
  const deferredModel = useDeferredValue(editedModel);
  const judge = useJudgment({ model: floors.length > 0 ? deferredModel : null, modelRev: `${record.version}:${ed.rev}`, enabled: preview !== "error" });

  const blocker = analysis ? saveBlocker(analysis) : null;
  const canSave = access.edit && dirty && blocker === null && !previewEmpty && save.status !== "saving";

  // ---------- 도면 미리보기(엔진 sheet 레인) ----------
  const [view, setView] = useState<PreviewView>({ kind: "idle", text: "판정이 끝나면 도면을 만듭니다." });
  const seqRef = useRef(0);
  const judgeResult = judge.data?.result ?? null;
  const judgment = useMemo(() => judgeResult ?? (judge.phase === "error" && deferredModel ? placeholderJudgment(deferredModel) : null), [judgeResult, judge.phase, deferredModel]);
  const issueCount = analysis ? analysis.issues.length : 0;
  const hasLayout = layout.rooms.length > 0;
  useEffect(() => {
    if (!deferredModel || !ed.floor) return;
    if (!engine) return setView({ kind: "error", text: previewErrorText("ENGINE_UNAVAILABLE") });
    if (issueCount > 0) return setView({ kind: "idle", text: previewErrorText("AR051") });
    if (!hasLayout) return setView({ kind: "idle", text: "실을 배치하면 도면이 보입니다." });
    if (!judgment) return setView({ kind: "loading" });
    seqRef.current += 1;
    const seq = seqRef.current;
    const reqId = `plans-preview-${seq}`;
    let url: string | null = null;
    setView((v) => (v.kind === "ready" ? v : { kind: "loading" }));
    const unsub = engine.subscribe((res) => {
      const r = readPreviewResponse(res, reqId);
      if (r.kind === "ok") {
        url = URL.createObjectURL(new Blob([r.svg], { type: "image/svg+xml" }));
        setView({ kind: "ready", url });
      } else if (r.kind === "error") setView({ kind: "error", text: previewErrorText(r.code) });
    });
    const timer = setTimeout(() => {
      try {
        engine.send(buildSheetRequest(reqId, seq, planSheetInput(deferredModel, judgment, ed.floor, record.name, localDate(new Date()))));
      } catch {
        setView({ kind: "error", text: previewErrorText("ENGINE_UNAVAILABLE") });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      unsub();
      if (url) URL.revokeObjectURL(url);
    };
  }, [engine, deferredModel, judgment, ed.floor, issueCount, hasLayout, judge.phase, record.name]);

  // ---------- 동작 ----------
  const edit = access.edit;
  const mut = (f: (s: EditorState) => EditorState) => {
    if (edit) setEd(f);
  };
  const toSelect = (s: EditorState, before: EditorState): EditorState => (s.rev !== before.rev ? { ...s, tool: "select", draw: [] } : s);

  const merge = (keep: string, other: string) =>
    mut((s) => toSelect(applyOp(s, (l) => mergeRooms(l, keep, other)), s));

  const actions: PlanActions = {
    pickRoom: (id) => {
      if (edit && ed.tool === "merge" && ed.sel.kind === "room" && ed.sel.id !== id) merge(ed.sel.id, id);
      else setEd((s) => select(s, { kind: "room", id, edge: null }));
    },
    placeTarget: (t) =>
      mut((s) =>
        applyOp(s, (l) => {
          const id = uniqueId("r", l.rooms.map((r) => r.id));
          const slot = findSlot(s.floor, outline, l, t.target_area_m2, id);
          return slot ? drawRoom(l, slot.outer, t.name, t.use) : { ok: false, reason: `‘${t.name}’을(를) 놓을 빈 자리가 없습니다. 실 그리기(R)로 직접 그리세요.` };
        }),
      ),
    rename: (id, name, use) => mut((s) => applyOp(s, (l) => renameRoom(l, id, name, use), `rename:${id}`)),
    selectEdge: (id, edge) => setEd((s) => select(s, { kind: "room", id, edge })),
    addOpening: (kind) =>
      mut((s) => (s.sel.kind === "room" && s.sel.edge !== null ? applyOp(s, (l) => addOpening(l, (s.sel as { id: string }).id, (s.sel as { edge: number }).edge, kind)) : { ...s, notice: { tone: "warn", text: "먼저 실과 벽(변)을 고르세요." } })),
    pickOpening: (id) => setEd((s) => select(s, { kind: "opening", id })),
    updateOpening: (id, patch) => mut((s) => applyOp(s, (l) => updateOpening(l, id, patch), `opening:${id}`)),
    removeOpening: (id) => mut((s) => applyOp(s, (l) => removeOpening(l, id))),
    removeRoom: (id) => mut((s) => applyOp(s, (l) => removeRoom(l, id))),
    drawClose: () => mut((s) => toSelect(applyOp(s, (l) => drawRoom(l, s.draw, "새 실", "미정")), s)),
    drawBack: () => mut(drawBack),
    drawAtCursor: () => mut((s) => drawAdd(s, s.cursor)),
    addRect: (x, y, w, h) => mut((s) => toSelect(applyOp(s, (l) => drawRoom(l, rectPolygon(x, y, w, h).outer, "새 실", "미정")), s)),
    split: (id, axis, at) => mut((s) => toSelect(applyOp(s, (l) => splitRoom(l, id, axis, at)), s)),
    merge,
  };

  function onAction(a: Action) {
    switch (a.t) {
      case "undo":
        return edit ? setEd(doUndo) : undefined;
      case "redo":
        return edit ? setEd(doRedo) : undefined;
      case "save":
        return canSave ? void onSave() : undefined;
      case "grid":
        return setEd((s) => ({ ...s, grid: !s.grid }));
      case "tool":
        if (!edit && a.tool !== "select") return;
        return setEd((s) => {
          if ((a.tool === "door" || a.tool === "window") && s.sel.kind === "room" && s.sel.edge !== null) {
            const sel = s.sel;
            const next = applyOp(s, (l) => addOpening(l, sel.id, sel.edge as number, a.tool === "door" ? "door" : "window"));
            return next.rev !== s.rev ? { ...next, tool: "select" } : { ...next, tool: a.tool };
          }
          const next = setTool(s, a.tool);
          return a.tool === "door" || a.tool === "window" ? { ...next, notice: { tone: "info", text: "벽을 누르거나, 실과 변을 고른 뒤 다시 누르세요." } } : next;
        });
      case "escape":
        return setEd((s) => (s.draw.length > 0 ? { ...s, draw: [] } : s.tool !== "select" ? setTool(s, "select") : select(s, { kind: "none" })));
      case "delete":
        return mut((s) => (s.sel.kind === "opening" ? applyOp(s, (l) => removeOpening(l, (s.sel as { id: string }).id)) : s.sel.kind === "room" ? applyOp(s, (l) => removeRoom(l, (s.sel as { id: string }).id)) : s));
      case "enter":
        return mut((s) => (s.tool === "room" ? toSelect(applyOp(s, (l) => drawRoom(l, s.draw, "새 실", "미정")), s) : s));
      case "backspace":
        return mut((s) => (s.tool === "room" ? drawBack(s) : s));
      case "space":
        return mut((s) => (s.tool === "room" ? drawAdd(s, s.cursor) : s));
      case "edge":
        return setEd((s) => stepEdge(s, a.dir));
      case "arrow":
        return mut((s) => {
          const step = arrowStep(a.shift, a.alt, s.grid);
          if (s.tool === "room") return moveCursor(s, a.ux * step, a.uy * step);
          if (s.sel.kind === "opening") {
            const id = s.sel.id;
            return applyOp(s, (l) => slideOpening(l, id, (a.ux + a.uy) * step), `slide:${id}`);
          }
          if (s.sel.kind === "room") {
            const sel = s.sel;
            if (sel.edge === null) return { ...s, notice: { tone: "warn", text: "[ ] 키로 움직일 변을 먼저 고르세요." } };
            return applyOp(s, (l) => moveRoomEdge(l, sel.id, sel.edge as number, a.ux * step, a.uy * step), `edge:${sel.id}:${sel.edge}`);
          }
          return s;
        });
    }
  }

  // 문서 단축키: 이 화면 안이거나 아무 곳도 포커스되지 않았을 때만 받는다. 글자 입력 칸·대화상자 안에서는 가로채지 않는다.
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      const inside = target === document.body || !!(rootRef.current && target && rootRef.current.contains(target));
      if (!inside) return;
      const typing = isTypingTarget(target);
      const a = keyAction({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
      if (!a) return;
      if (typing && !(a.t === "save")) return;
      const onControl = !!target && (target.tagName === "BUTTON" || target.tagName === "A");
      if (onControl && (a.t === "space" || a.t === "enter")) return; // 버튼은 자기 동작을 한다
      e.preventDefault();
      handlerRef.current(a);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function onSave() {
    if (!model) return;
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
        designModel: JSON.stringify(withLayouts(model, layouts)),
        note: "평면 수정",
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

  if (preview === "error" || !model || !analysis) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="평면" />
        <ErrorState title="이 프로젝트의 설계 모델을 읽지 못했습니다" description="파일이 손상되었거나 이 버전에서 읽을 수 없는 형식입니다. 프로젝트 목록에서 다시 열거나 백업에서 복구하세요." onRetry={reload} />
      </div>
    );
  }

  if (floors.length === 0) {
    return (
      <div className="flex flex-col gap-gap">
        <PageHeader title="평면" description="층별 평면 위에서 실·벽·문창을 고칩니다." />
        <EmptyBlock
          icon="box"
          title="평면을 그릴 층이 없습니다"
          description="모델·판정 화면에서 매스를 먼저 만드세요. 매스의 층이 이 화면의 층이 됩니다."
          action={
            <Link to={`/projects/${record.id}/model`} className="focus-ring rounded-sm text-body text-info underline">
              모델·판정으로 이동
            </Link>
          }
        />
      </div>
    );
  }

  const floorInfo = floors.find((f) => f.id === ed.floor) ?? floors[0];
  const selRoom = ed.sel.kind === "room" ? layout.rooms.find((r) => r.id === (ed.sel as { id: string }).id) : undefined;
  const selOpening = ed.sel.kind === "opening" ? layout.openings.find((o) => o.id === (ed.sel as { id: string }).id) : undefined;
  const announce =
    ed.notice?.text ??
    (selOpening ? `${selOpening.kind === "door" ? "문" : "창"} ${selOpening.width_mm}mm 선택` : selRoom ? `${selRoom.name} 선택${ed.sel.kind === "room" && ed.sel.edge !== null ? `, 변 ${ed.sel.edge + 1}` : ""}` : "");
  const canvasLabel = `${floorInfo?.label ?? ""} 평면 2D 보기: 실 ${layout.rooms.length}개, 문·창 ${layout.openings.length}개${analysis.issues.length > 0 ? `, 배치 오류 ${analysis.issues.length}건` : ""}. 같은 정보는 왼쪽 실 목록과 오른쪽 속성에 글자로 있습니다.`;

  const actionsBar = (
    <>
      <Button size="sm" disabled={!edit || !canUndo(ed.history)} onClick={() => setEd(doUndo)} aria-label="실행취소 (Ctrl+Z)">
        실행취소
      </Button>
      <Button size="sm" disabled={!edit || !canRedo(ed.history)} onClick={() => setEd(doRedo)} aria-label="다시 실행 (Ctrl+Shift+Z)">
        다시 실행
      </Button>
      <Button variant="primary" icon="check" loading={save.status === "saving"} disabled={!canSave} onClick={() => void onSave()}>
        저장
      </Button>
    </>
  );

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-gap">
      <PageHeader title="평면" description="층별 평면 위에서 실·벽·문창을 고칩니다. 면적과 겹침은 편집 즉시 다시 계산합니다." actions={actionsBar} />

      {save.status === "conflict" ? (
        <ErrorState
          title="다른 곳에서 이 프로젝트가 먼저 저장되었습니다"
          description="병합하지 않습니다. 서버 최신을 열면 저장하지 않은 평면 변경은 사라집니다."
          action={
            <Button size="sm" onClick={reload}>
              최신 열기
            </Button>
          }
        />
      ) : null}
      {save.status === "failed" ? <ErrorState title={save.message} /> : null}
      {access.lockReason ? (
        <LockedState
          title="평면을 편집할 수 없습니다"
          reason={access.lockReason}
          action={
            <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
              라이선스 보기
            </Link>
          }
        />
      ) : access.narrow ? (
        <Banner tone="info" title="열람 전용">
          {NARROW_TEXT}
        </Banner>
      ) : null}
      {previewEmpty ? <Banner tone="info" title="빈 상태 미리보기">이 화면은 `?state=empty` 미리보기라 저장하지 않습니다.</Banner> : null}

      <div className="flex flex-wrap items-end gap-2" role="toolbar" aria-label="평면 도구">
        <Field label="층" htmlFor="plan-floor" className="w-40">
          <Select id="plan-floor" value={ed.floor} onChange={(e) => setEd((s) => setFloor(s, e.target.value))}>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <Button key={t.id} size="sm" variant={ed.tool === t.id ? "primary" : "secondary"} aria-pressed={ed.tool === t.id} disabled={!edit && t.id !== "select"} onClick={() => setEd((s) => setTool(s, t.id))} aria-keyshortcuts={t.key}>
              {t.label} <Kbd>{t.key}</Kbd>
            </Button>
          ))}
        </div>
        <Button size="sm" aria-pressed={ed.grid} onClick={() => setEd((s) => ({ ...s, grid: !s.grid }))} aria-keyshortcuts="G">
          그리드 100mm {ed.grid ? "켬" : "끔"} <Kbd>G</Kbd>
        </Button>
        <Badge tone="neutral">
          {judge.phase === "loading" ? "법규 판정 갱신 중" : judge.phase === "error" ? "법규 판정 실패" : judge.data ? `법규 판정 ${judge.data.result.items.length}개 항목` : "법규 판정 대기"}
        </Badge>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {ed.notice ? (
        <Banner tone={ed.notice.tone === "warn" ? "warn" : "info"} title={ed.notice.text} />
      ) : null}

      {layout.rooms.length === 0 ? (
        <EmptyBlock
          icon="pentagon"
          title="이 층에 배치한 실이 없습니다"
          description="왼쪽 실 목록에서 [놓기]로 면적표 실을 놓거나 [실 그리기 R]로 직접 그리세요. 면적표가 비어 있으면 프로그램에서 면적표를 먼저 만드세요."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" icon="pentagon" disabled={!edit} onClick={() => setEd((s) => setTool(s, "room"))}>
                실 그리기 (R)
              </Button>
              <Link to={`/projects/${record.id}/program`} className="focus-ring inline-flex h-control-sm items-center rounded-control border border-line px-3 text-body text-fg">
                프로그램에서 면적표 만들기
              </Link>
            </div>
          }
        />
      ) : null}

      <div className="grid min-w-0 gap-gap md:grid-cols-2 xl:grid-cols-[var(--sidebar-w)_minmax(0,1fr)_var(--sidebar-w)]">
        <div className="order-2 min-w-0 xl:order-1">
          <RoomList layout={layout} analysis={analysis} sel={ed.sel} edit={edit} actions={actions} mergeMode={ed.tool === "merge"} />
        </div>
        <div className="order-1 col-span-full min-w-0 xl:order-2 xl:col-span-1">
          <PlanCanvas
            outline={outline}
            layout={layout}
            analysis={analysis}
            sel={ed.sel}
            tool={ed.tool}
            draw={ed.draw}
            cursor={ed.cursor}
            grid={gridMm(ed)}
            edit={edit}
            label={canvasLabel}
            onPick={(sel) => setEd((s) => select(s, sel))}
            onDrawPoint={(p) => mut((s) => drawAdd(s, p))}
            onPlace={(hit, kind) => mut((s) => ({ ...applyOp(s, (l) => addOpeningAt(l, hit.room_id, hit.edge_index, hit.offset_mm, kind)), tool: "select" }))}
            onSplitAt={(id, p) =>
              mut((s) =>
                toSelect(
                  applyOp(s, (l) => {
                    const c = pointerSplit(l, id, p);
                    return splitRoom(l, id, c.axis, c.at);
                  }),
                  s,
                ),
              )
            }
            onMergeWith={(id) => {
              if (ed.sel.kind === "room" && ed.sel.id !== id) merge(ed.sel.id, id);
              else setEd((s) => select(s, { kind: "room", id, edge: null }));
            }}
            onDragStart={() => mut((s) => ({ ...s, dragSeq: s.dragSeq + 1 }))}
            onDragEdge={(dx, dy) =>
              mut((s) => {
                if (s.sel.kind !== "room" || s.sel.edge === null) return s;
                const sel = s.sel;
                const next = applyOp(s, (l) => moveRoomEdge(l, sel.id, sel.edge as number, dx, dy), `drag:${s.dragSeq}`);
                return next.rev === s.rev ? s : next;
              })
            }
          />
          <p className="mt-1 text-caption text-fg-2">
            키보드: <Kbd>[</Kbd> <Kbd>]</Kbd> 변 고르기 · 화살표 100mm(<Kbd>Shift</Kbd> 1,000mm) 이동 · <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> 실행취소 · <Kbd>Esc</Kbd> 도구 해제
          </p>
        </div>
        <div className="order-3 flex min-w-0 flex-col gap-gap">
          <Inspector layout={layout} analysis={analysis} sel={ed.sel} tool={ed.tool} draw={ed.draw} cursor={ed.cursor} edit={edit} actions={actions} />
        </div>
      </div>

      <CheckBar layout={layout} analysis={analysis} blocker={blocker} onPick={(id) => setEd((s) => select(s, { kind: "room", id, edge: null }))} />
      <PreviewPanel view={view} floorLabel={floorInfo?.label ?? ""} />

      <ToastRegion>{toast ? <Toast tone="ok" title={toast} onClose={() => setToast(null)} /> : null}</ToastRegion>
    </div>
  );
}
