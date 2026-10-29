// `/projects` 홈(03장 3.3·8.5절, D-33). 소유: AR-06-034.
// 위에서 아래: 머리(주 행동 "새 프로젝트") → 저장소 배너(AR061) → 오늘 처리할 일 → 프로젝트 목록(넓게) + 새로 시작(좁게).
// 데이터는 useAdapters().projects(070 ProjectStore)로만 읽고 쓴다. 쓰기는 모두 expectedVersion을 보낸다:
// 새 = null, 이름 바꾸기·복원 = 목록에서 본 버전, 삭제 = 목록에서 본 버전 → 다르면 VERSION_CONFLICT(병합 없음·저장 안 됨) → 2선택 대화상자.
// 클라우드 사본은 표시(칩)와 충돌 대화상자 골격까지(업로드·내려받기 버튼은 AR-06-077).
// 편집 권리(desktop_edit)가 없으면 새 프로젝트·이름 바꾸기·삭제·복원을 막고 열람만(5.1절). 설치형은 041·074 전까지 unverified로 잠기는 게 정상.
import type { ProjectSummary, SaveProjectInput } from "@arch-studio/shell-bridge";
import { Banner, Button, Toast, ToastRegion } from "@arch-studio/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  EmptyBlock,
  ErrorState,
  LoadingState,
  LockedState,
  PageHeader,
  bridgeErrorText,
  useAdapters,
  useApi,
  useDemoMode,
  useEntitlement,
  useOnline,
  useSession,
} from "../shell/index.ts";
import { cloudVersionByLocalId, cloudVersionOf, parseCloudList, type CloudList } from "./cloud.ts";
import { demoCloudList, parsePreview } from "./demo-fixture.ts";
import { ConflictDialog, DeleteDialog, NewProjectDialog, RenameDialog } from "./dialogs.tsx";
import { renameInput, restoreInput, revisionSourceOf, SessionHistory, type RevisionSource } from "./history.ts";
import { HistorySheet, type HistoryLoad } from "./HistorySheet.tsx";
import { applyListQuery, isFiltered, parseListQuery, writeListQuery, type ListQuery } from "./list-query.ts";
import { classifyStoreError, localError, storeErrorText, TEXT, viewOnlyReason } from "./messages.ts";
import { copyName, newProjectInput, uuidV7, type NewProjectValues } from "./new-project.ts";
import { FilterBar, ProjectTable, TodayBlock, type TableRow } from "./parts.tsx";
import { todayItems } from "./today.ts";

type Load = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; items: readonly ProjectSummary[] };

/** 충돌 1건: 저장하지 못한 "내 변경"(사본으로 저장할 본문)을 들고 있다. */
interface Conflict {
  readonly key: number;
  readonly kind: "local" | "cloud";
  readonly id: string;
  readonly name: string;
  /** null이면 사본으로 저장할 본문이 없다(미리보기). */
  readonly pending: SaveProjectInput | null;
}

type DialogState =
  | { kind: "none" }
  | { kind: "new" }
  | { kind: "rename"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "history"; id: string };

function newId(): string {
  return uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
}

function useProjectList() {
  const { projects } = useAdapters();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    projects.list().then(
      (items) => alive && setLoad({ status: "ready", items }),
      (error: unknown) => alive && setLoad({ status: "error", error }),
    );
    return () => {
      alive = false;
    };
  }, [projects, tick]);
  return { load, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** 클라우드 사본 목록. 로그인·온라인일 때만 부른다. 데모는 픽스처(셸 데모 fetch에 이 API가 없다). */
function useCloudList(localIds: readonly string[] | null, demo: boolean) {
  const api = useApi();
  const { state } = useSession();
  const online = useOnline();
  const signedIn = state.kind === "ready";
  const [result, setResult] = useState<{ status: "idle" | "ready" | "error"; list: CloudList | null }>({ status: "idle", list: null });
  const idsKey = localIds?.join(",") ?? "";
  useEffect(() => {
    if (!signedIn || !online || localIds === null) {
      setResult({ status: "idle", list: null });
      return;
    }
    if (demo) {
      setResult({ status: "ready", list: demoCloudList(localIds, "2026-10-28T09:00:00.000Z") });
      return;
    }
    let alive = true;
    api.request({ method: "GET", path: "/api/cloud-projects", parse: parseCloudList }).then(
      (list) => alive && setResult({ status: "ready", list }),
      () => alive && setResult({ status: "error", list: null }),
    );
    return () => {
      alive = false;
    };
    // idsKey: 목록 구성이 바뀔 때만 다시 부른다(localIds 배열은 렌더마다 새로 만들어진다).
  }, [api, signedIn, online, demo, idsKey]);
  const note = !signedIn || !online ? TEXT.cloudSignedOut : result.status === "error" ? TEXT.cloudUnavailable : null;
  return { list: result.list, note };
}

export function Screen() {
  const { projects } = useAdapters();
  const demo = useDemoMode();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const preview = demo ? parsePreview(params.get("state")) : null;
  const query = parseListQuery(params);
  const setQuery = (next: ListQuery) => setParams(writeListQuery(params, next), { replace: true });

  const { load, reload } = useProjectList();
  const edit = useEntitlement("desktop_edit");
  const cloudReview = useEntitlement("cloud_review");

  const [readOnly, setReadOnly] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<readonly Conflict[]>([]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const conflictKey = useRef(0);

  // 리비전 원천: 저장소 메서드(006·070 후속) → 데모 세션 픽스처 → 없음(안내).
  const sessionHistory = useMemo(() => (demo ? new SessionHistory(projects) : null), [demo, projects]);
  const revisions: RevisionSource | null = useMemo(() => revisionSourceOf(projects) ?? sessionHistory, [projects, sessionHistory]);

  const effective: Load = preview === "loading" ? { status: "loading" } : preview === "error" ? { status: "error", error: null } : preview === "ar060" ? { status: "error", error: localError("AR060") } : preview === "empty" && load.status === "ready" ? { status: "ready", items: [] } : load;
  const corrupt = effective.status === "error" && classifyStoreError(effective.error) === "corrupt";
  const storeReadOnly = readOnly || preview === "ar061";
  const editAllowed = edit?.allowed === true;
  const writable = editAllowed && !storeReadOnly && !corrupt;
  const items = effective.status === "ready" ? effective.items : null;
  const cloud = useCloudList(items ? items.map((p) => p.id) : null, demo);
  const cloudMap = cloudVersionByLocalId(cloud.list);

  // 미리보기: 충돌 대화상자(데모 전용).
  useEffect(() => {
    if ((preview === "conflict" || preview === "conflict-cloud") && items && items[0]) {
      const first = items[0];
      setConflicts([{ key: -1, kind: preview === "conflict-cloud" ? "cloud" : "local", id: first.id, name: first.name, pending: null }]);
      setConflictOpen(true);
    }
  }, [preview, items]);

  // 미리보기: 첫 프로젝트 관리 시트(데모 전용).
  const firstId = items?.[0]?.id ?? null;
  useEffect(() => {
    if (preview === "manage" && firstId) setDialog({ kind: "history", id: firstId });
  }, [preview, firstId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const rowOf = (id: string) => items?.find((p) => p.id === id) ?? null;

  const closeDialog = () => {
    setDialog({ kind: "none" });
    setDialogError(null);
    setBusy(false);
  };

  /** 쓰기 공통: 성공이면 목록 새로 고침 + 데모 이력 기억, 실패는 분류해서 돌려준다. */
  const write = async (input: SaveProjectInput, note: string | null): Promise<{ ok: true; version: number } | { ok: false; error: unknown }> => {
    try {
      const r = await projects.save(input);
      if (sessionHistory) {
        const rec = await projects.open(input.id).catch(() => null);
        if (rec) sessionHistory.remember(rec, note);
      }
      reload();
      return { ok: true, version: r.version };
    } catch (error) {
      if (classifyStoreError(error) === "readOnly") setReadOnly(true);
      return { ok: false, error };
    }
  };

  const pushConflict = (c: Omit<Conflict, "key">) => {
    conflictKey.current += 1;
    setConflicts((list) => [...list, { ...c, key: conflictKey.current }]);
    setConflictOpen(true);
  };

  const createProject = async (values: NewProjectValues) => {
    setBusy(true);
    setDialogError(null);
    const r = await write(newProjectInput(newId(), values), "새 프로젝트");
    setBusy(false);
    if (r.ok) {
      closeDialog();
      setToast(`"${values.name}"을(를) 만들었습니다.`);
    } else setDialogError(storeErrorText(r.error));
  };

  const renameProject = async (id: string, name: string) => {
    const row = rowOf(id);
    if (!row) return;
    setBusy(true);
    setDialogError(null);
    try {
      const current = await projects.open(id);
      if (!current) throw localError("NOT_FOUND");
      const input = renameInput(current, row.version, name);
      const r = await write(input, "이름 바꾸기");
      if (r.ok) {
        closeDialog();
        setToast(`이름을 바꿨습니다(v${r.version}).`);
      } else if (classifyStoreError(r.error) === "conflict") {
        closeDialog();
        pushConflict({ kind: "local", id, name: row.name, pending: input });
      } else setDialogError(storeErrorText(r.error));
    } catch (error) {
      setDialogError(storeErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteProject = async (id: string) => {
    const row = rowOf(id);
    if (!row) return;
    setBusy(true);
    setDialogError(null);
    try {
      await projects.delete(id, row.version);
      closeDialog();
      reload();
      setToast(`"${row.name}"을(를) 삭제했습니다.`);
    } catch (error) {
      const kind = classifyStoreError(error);
      if (kind === "readOnly") setReadOnly(true);
      if (kind === "conflict") reload();
      setDialogError(kind === "conflict" ? "목록에서 본 뒤 다른 곳에서 먼저 저장되어 삭제하지 않았습니다. 목록을 새로 고쳤으니 다시 확인하세요." : storeErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const [history, setHistory] = useState<HistoryLoad>({ status: "loading" });
  const [restoring, setRestoring] = useState<number | null>(null);
  const historyId = dialog.kind === "history" ? dialog.id : null;
  useEffect(() => {
    if (!historyId) return;
    const row = items?.find((p) => p.id === historyId);
    if (!row) return;
    if (!revisions) {
      setHistory({ status: "unavailable", current: row.version });
      return;
    }
    let alive = true;
    setHistory({ status: "loading" });
    revisions.list(historyId).then(
      (list) => alive && setHistory({ status: "ready", items: list, current: row.version }),
      (e: unknown) => alive && setHistory({ status: "error", message: storeErrorText(e) }),
    );
    return () => {
      alive = false;
    };
  }, [historyId, revisions, items]);

  const restore = async (id: string, version: number) => {
    const row = rowOf(id);
    if (!row || !revisions) return;
    setRestoring(version);
    setDialogError(null);
    try {
      const [rev, current] = await Promise.all([revisions.open(id, version), projects.open(id)]);
      if (!rev || !current) throw localError("NOT_FOUND");
      // expectedVersion은 목록에서 본 버전(최신으로 바꿔 끼우지 않는다).
      const input = restoreInput({ ...current, version: row.version }, rev, TEXT.historyRestoreNote(version));
      if (!input) return;
      const r = await write(input, TEXT.historyRestoreNote(version));
      if (r.ok) {
        closeDialog();
        setToast(`v${version}을(를) 새 버전 v${r.version}으로 복원했습니다.`);
      } else if (classifyStoreError(r.error) === "conflict") {
        closeDialog();
        pushConflict({ kind: "local", id, name: row.name, pending: input });
      } else setDialogError(storeErrorText(r.error));
    } catch (error) {
      setDialogError(storeErrorText(error));
    } finally {
      setRestoring(null);
    }
  };

  const conflict = conflicts[0] ?? null;
  const resolveConflict = () => {
    setConflicts((list) => list.slice(1));
    setConflictOpen(conflicts.length > 1);
    setDialogError(null);
  };
  const saveConflictCopy = async () => {
    if (!conflict) return;
    if (!conflict.pending) {
      resolveConflict();
      return;
    }
    setBusy(true);
    const r = await write({ ...conflict.pending, id: newId(), name: copyName(conflict.name), note: "충돌 사본", expectedVersion: null }, "충돌 사본");
    setBusy(false);
    if (r.ok) {
      resolveConflict();
      setToast(`내 변경을 "${copyName(conflict.name)}"으로 저장했습니다.`);
    } else setDialogError(storeErrorText(r.error));
  };
  const openLatest = () => {
    if (!conflict) return;
    const id = conflict.id;
    const real = conflict.pending !== null;
    resolveConflict();
    reload();
    if (real) void navigate(`/projects/${id}/model`);
  };

  const viewOnly = viewOnlyReason(edit);
  const today = todayItems({ edit, cloudReview, openConflicts: conflicts.length });

  const newButton = (
    <Button variant="primary" icon="plus" disabled={!writable} onClick={() => setDialog({ kind: "new" })}>
      {TEXT.newProject}
    </Button>
  );
  const sampleButton = (
    <Button disabled title={TEXT.sampleLater}>
      {TEXT.sample}
    </Button>
  );

  let list;
  if (effective.status === "loading") list = <LoadingState label={TEXT.loading} />;
  else if (corrupt) list = <ErrorState title={TEXT.corruptTitle} description={TEXT.corruptBody} onRetry={reload} />;
  else if (effective.status === "error")
    list = <ErrorState title={TEXT.listErrorTitle} description={bridgeErrorText(effective.error)} onRetry={reload} />;
  else if (effective.items.length === 0)
    list = (
      <EmptyBlock
        icon="box"
        title={TEXT.emptyTitle}
        description={TEXT.emptyDescription}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {sampleButton}
            {newButton}
          </div>
        }
      />
    );
  else {
    const rows: TableRow[] = applyListQuery(
      effective.items.map((p) => ({ ...p, cloudVersion: cloudVersionOf(cloudMap, p.id) })),
      query,
    );
    list = (
      <>
        <FilterBar query={query} onChange={setQuery} />
        {rows.length === 0 && isFiltered(query) ? (
          <EmptyBlock
            icon="inbox"
            title={TEXT.filteredEmptyTitle}
            description={TEXT.filteredEmptyDescription}
            action={<Button onClick={() => setQuery({ ...query, q: "", store: "all" })}>필터 지우기</Button>}
          />
        ) : (
          <ProjectTable rows={rows} onManage={(id) => setDialog({ kind: "history", id })} />
        )}
        <p className="text-caption text-fg-2" aria-live="polite">
          {rows.length}개 표시 · 전체 {effective.items.length}개
        </p>
      </>
    );
  }

  const active = dialog.kind === "rename" || dialog.kind === "delete" || dialog.kind === "history" ? rowOf(dialog.id) : null;

  return (
    <div className="flex flex-col gap-gap">
      <PageHeader title={TEXT.title} description={TEXT.description} actions={newButton} />
      {storeReadOnly ? <Banner tone="danger" title={TEXT.readOnlyTitle}>{TEXT.readOnlyBody}</Banner> : null}
      {corrupt ? null : <TodayBlock items={today} cloudNote={cloud.note} onConflict={() => setConflictOpen(true)} />}
      <div className="grid grid-cols-1 gap-gap xl:grid-cols-4">
        <section aria-labelledby="projects-list-title" className="flex min-w-0 flex-col gap-2 xl:col-span-3">
          <h2 id="projects-list-title" className="text-h2 font-semibold text-fg">
            최근 프로젝트
          </h2>
          {list}
        </section>
        <aside aria-labelledby="projects-start-title" className="flex flex-col gap-2">
          <h2 id="projects-start-title" className="text-h2 font-semibold text-fg">
            새로 시작
          </h2>
          {viewOnly ? (
            <LockedState
              title={TEXT.newLocked}
              reason={viewOnly}
              action={
                <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
                  라이선스 보기
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-pad md:flex-row md:flex-wrap md:items-center xl:flex-col xl:items-stretch">
              {newButton}
              {sampleButton}
              <p className="text-caption text-fg-2">{storeReadOnly || corrupt ? "저장소 문제로 지금은 새로 만들 수 없습니다." : TEXT.sampleLater}</p>
            </div>
          )}
        </aside>
      </div>

      {dialog.kind === "new" ? <NewProjectDialog open busy={busy} error={dialogError} onClose={closeDialog} onSubmit={(v) => void createProject(v)} /> : null}
      {dialog.kind === "rename" && active ? (
        <RenameDialog open initial={active.name} busy={busy} error={dialogError} onClose={closeDialog} onSubmit={(n) => void renameProject(active.id, n)} />
      ) : null}
      {dialog.kind === "delete" && active ? (
        <DeleteDialog open name={active.name} version={active.version} busy={busy} error={dialogError} onClose={closeDialog} onConfirm={() => void deleteProject(active.id)} />
      ) : null}
      {dialog.kind === "history" && active ? (
        <HistorySheet
          open
          name={active.name}
          load={history}
          writable={writable}
          busyVersion={restoring}
          restoreError={dialogError}
          onClose={closeDialog}
          onRestore={(v) => void restore(active.id, v)}
          onRename={() => {
            setDialogError(null);
            setDialog({ kind: "rename", id: active.id });
          }}
          onDelete={() => {
            setDialogError(null);
            setDialog({ kind: "delete", id: active.id });
          }}
        />
      ) : null}
      {conflict ? (
        <ConflictDialog
          open={conflictOpen}
          kind={conflict.kind}
          name={conflict.name}
          busy={busy}
          error={dialogError}
          onClose={() => setConflictOpen(false)}
          onSaveCopy={() => void saveConflictCopy()}
          onOpenLatest={openLatest}
        />
      ) : null}
      <ToastRegion>{toast ? <Toast tone="ok" title={toast} onClose={() => setToast(null)} /> : null}</ToastRegion>
    </div>
  );
}
