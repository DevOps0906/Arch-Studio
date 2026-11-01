// `/projects` 홈(03장 3.3·8.5절, D-33). 소유: AR-06-034, 대시보드 강화 AR-06-082.
// 위에서 아래: 머리(날짜·"오늘 이어서 할 작업"·주 행동) → 저장소 배너(AR061) → 요약 4칸 → 프로젝트 카드(정렬) + 오른쪽 열
// (오늘 할 일 → 크레딧 → 클라우드 작업·최근 활동 → 법규 개정 알림). 3구간: 모바일 1열(요약 2×2), 태블릿 카드 2열 + 오른쪽 열 2열, 데스크톱 카드 2열 + 오른쪽 열 1열.
// 데이터는 useAdapters().projects(070 ProjectStore)로만 읽고 쓴다. 쓰기는 모두 expectedVersion을 보낸다:
// 새 = null, 이름 바꾸기·복원 = 목록에서 본 버전, 삭제 = 목록에서 본 버전 → 다르면 VERSION_CONFLICT(병합 없음·저장 안 됨) → 2선택 대화상자.
// 클라우드 사본은 표시(칩)와 충돌 대화상자 골격까지(업로드·내려받기 버튼은 AR-06-077).
// 편집 권리(desktop_edit)가 없으면 새 프로젝트·이름 바꾸기·삭제·복원을 막고 열람만(5.1절). 설치형은 041·074 전까지 unverified로 잠기는 게 정상.
import type { DesignModelV1, SheetSpec } from "@arch-studio/domain";
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
import { demoCloudList, demoVerdicts, parsePreview } from "./demo-fixture.ts";
import { requestSiteLookup } from "../site/lookup.ts";
import type { SiteMapSource } from "./site-map-style.ts";
import { requestSiteSearch } from "./site-search.ts";
import { siteAccess } from "../site/access.ts";
import { ConflictDialog, DeleteDialog, NewProjectDialog, RenameDialog, type SiteLookupPort } from "./dialogs.tsx";
import { renameInput, restoreInput, revisionSourceOf, SessionHistory, type RevisionSource } from "./history.ts";
import { HistorySheet, type HistoryLoad } from "./HistorySheet.tsx";
import { classifyStoreError, localError, storeErrorText, TEXT, viewOnlyReason } from "./messages.ts";
import { copyName, newProjectInput, uuidV7, type NewProjectValues } from "./new-project.ts";
import { todayItems } from "./today.ts";
import { parseDesignModel } from "../site/model.ts";
import { parseStored, storeKey } from "../sheets/model.ts";
import { buildCard, projectTodos, sortCards, summarize, type VerdictFacts } from "./dashboard.ts";
import { CloudActivityCard, CreditCard, DASH_TEXT, ProjectCard, ProjectCardSkeleton, RevisionCard, SummaryStrip, TodoPanel } from "./cards.tsx";
import { applyListQuery, isFiltered, parseListQuery, writeListQuery, type ListQuery } from "./list-query.ts";
import { FilterBar } from "./parts.tsx";
import { loadProjectMemo, type ProjectMemo } from "../shell/workspace.ts";
import { useCreditBalance } from "./useCreditBalance.ts";

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

/** 카드 한 장의 사실: 저장된 모델(열어서 검증)·시트 목록(도면 화면 저장소)·셸이 남긴 마지막 단계와 판정 요약(shell/workspace.ts). */
interface Facts {
  readonly model: DesignModelV1 | null;
  readonly sheets: readonly SheetSpec[];
  readonly memo: ProjectMemo;
}

function readSheets(id: string): readonly SheetSpec[] {
  try {
    return parseStored(globalThis.localStorage?.getItem(storeKey(id)) ?? null).specs;
  } catch {
    return [];
  }
}

const factsKey = (p: ProjectSummary) => `${p.id}:${p.version}`;

/**
 * 목록의 프로젝트마다 최신 리비전을 열어 모델을 검증한다. 이미 연(또는 여는 중인) id:version은 다시 열지 않고,
 * 목록에 없는 키는 지운다(이름 바꾸기 한 건이면 그 카드만 다시 연다). 열기 실패·형식 오류는 model null.
 */
function useProjectFacts(items: readonly ProjectSummary[] | null) {
  const { projects } = useAdapters();
  const [facts, setFacts] = useState<ReadonlyMap<string, Facts>>(new Map());
  const requested = useRef(new Set<string>());
  const live = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = items?.map(factsKey).join(",") ?? "";
  useEffect(() => {
    if (!items) return;
    live.current = new Set(items.map(factsKey));
    for (const k of [...requested.current]) if (!live.current.has(k)) requested.current.delete(k);
    setFacts((m) => {
      const stale = [...m.keys()].filter((k) => !live.current.has(k));
      if (stale.length === 0) return m;
      const next = new Map(m);
      for (const k of stale) next.delete(k);
      return next;
    });
    const put = (k: string, id: string, model: DesignModelV1 | null) => {
      if (!mounted.current || !live.current.has(k)) return;
      setFacts((m) => new Map(m).set(k, { model, sheets: readSheets(id), memo: loadProjectMemo(id) }));
    };
    for (const p of items) {
      const k = factsKey(p);
      if (requested.current.has(k)) continue;
      requested.current.add(k);
      projects.open(p.id).then(
        (rec) => {
          const parsed = rec ? parseDesignModel(rec.designModel) : null;
          put(k, p.id, parsed?.ok ? parsed.model : null);
        },
        () => put(k, p.id, null),
      );
    }
    // key: 목록 구성·버전이 바뀔 때만(items 배열은 렌더마다 새로 만들어질 수 있다).
  }, [projects, key]);
  return facts;
}

function todayLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${"일월화수목금토"[d.getDay()]}요일`;
}

const GRID_MAP: SiteMapSource = Object.freeze({ kind: "grid" });

export function Screen() {
  const { projects } = useAdapters();
  const demo = useDemoMode();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const preview = demo ? parsePreview(params.get("state")) : null;
  const query = parseListQuery(params);
  const setQuery = (next: ListQuery) => setParams(writeListQuery(params, next), { replace: true });
  const credit = useCreditBalance();
  const [doneTodos, setDoneTodos] = useState<ReadonlySet<string>>(new Set());

  const { load, reload } = useProjectList();
  const edit = useEntitlement("desktop_edit");
  const cloudReview = useEntitlement("cloud_review");
  // 새 프로젝트 창 대지 조회(03장 3.3절): 대지 화면과 같은 호출(site/lookup.ts)·같은 잠금 규칙(siteAccess).
  const api = useApi();
  const online = useOnline();
  // 지도 배경: 데모는 로컬 모눈(외부 요청 0). 운영 타일(GET /api/site/tiles, Bearer)은 셸이 타일 원천(baseUrl·토큰)을 내줄 때 연결한다 — 그 전과 설치형은 경계 그림(SVG).
  const siteLookup: SiteLookupPort = useMemo(
    () => ({
      state: siteAccess(edit, online).lookup,
      search: (kind, value) => requestSiteSearch(api, kind, value),
      run: (kind, value) => requestSiteLookup(api, kind, value),
      map: demo ? GRID_MAP : null,
    }),
    [api, edit, online, demo],
  );

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
  const facts = useProjectFacts(items);
  // 판정 기록: 셸이 남긴 마지막 요약(기준 시각). 없으면 "판정 기록 없음". 데모는 기록이 없을 때만 [예시].
  const demoVerdictMap: ReadonlyMap<string, VerdictFacts> = useMemo(() => (demo && items ? demoVerdicts(items.map((p) => p.id)) : new Map()), [demo, items]);

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

  const loaded = effective.status === "ready" ? effective.items.map((p) => ({ p, f: facts.get(`${p.id}:${p.version}`) ?? null })) : [];
  const allCards = loaded.flatMap(({ p, f }) => {
    if (!f) return [];
    const v = f.memo.verdict;
    const verdict: VerdictFacts | null = v ? { pass: v.pass, warn: v.warn, fail: v.fail, example: false, at: v.at } : (demoVerdictMap.get(p.id) ?? null);
    return [buildCard({ ...p, cloudVersion: cloudVersionOf(cloudMap, p.id), model: f.model, sheets: f.sheets, verdict, lastStage: f.memo.stage })];
  });
  // 검색·저장 위치·최근 수정·이름순은 applyListQuery, 초과 많은 순은 판정 기록으로 sortCards.
  const filtered = applyListQuery(allCards, query);
  const cards = query.sort === "violations" ? sortCards(filtered, "violations") : filtered;
  const pending = loaded.filter(({ f }) => f === null).map(({ p }) => p).filter((p) => applyListQuery([{ ...p, cloudVersion: cloudVersionOf(cloudMap, p.id) }], query).length > 0);
  const summary = effective.status === "ready" && loaded.every(({ f }) => f !== null) ? summarize(allCards) : null;
  const todos = projectTodos(sortCards(allCards, "updated"));
  const fallback = cloudReview !== undefined && !cloudReview.allowed && cloudReview.reason === "fallback";

  const newTile = viewOnly ? (
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
    <div className="flex flex-col justify-center gap-2 rounded-panel border border-dashed border-line p-pad">
      <p className="text-body font-semibold text-fg">{TEXT.newProject}</p>
      <p className="text-caption text-fg-2">{storeReadOnly || corrupt ? "저장소 문제로 지금은 새로 만들 수 없습니다." : "지번·도로명으로 대지를 조회하거나 가로·세로를 직접 입력합니다."}</p>
      <div className="flex flex-wrap gap-2">
        {newButton}
        {sampleButton}
      </div>
    </div>
  );

  let list;
  if (effective.status === "loading") list = <LoadingState label={TEXT.loading} />;
  else if (corrupt) list = <ErrorState title={TEXT.corruptTitle} description={TEXT.corruptBody} onRetry={reload} />;
  else if (effective.status === "error")
    list = <ErrorState title={TEXT.listErrorTitle} description={bridgeErrorText(effective.error)} onRetry={reload} />;
  else if (effective.items.length === 0)
    list = (
      <>
        <EmptyBlock
          icon="box"
          title={TEXT.emptyTitle}
          description={TEXT.emptyDescription}
          action={
            viewOnly ? undefined : (
              <div className="flex flex-wrap justify-center gap-2">
                {sampleButton}
                {newButton}
              </div>
            )
          }
        />
        {viewOnly ? newTile : null}
      </>
    );
  else
    list = (
      <>
        <FilterBar query={query} onChange={setQuery} />
        {cards.length === 0 && pending.length === 0 && isFiltered(query) ? (
          <EmptyBlock
            icon="inbox"
            title={TEXT.filteredEmptyTitle}
            description={TEXT.filteredEmptyDescription}
            action={<Button onClick={() => setQuery({ ...query, q: "", store: "all" })}>필터 지우기</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-gap md:grid-cols-2">
            {cards.map((c) => (
              <ProjectCard key={c.id} card={c} onManage={(id) => setDialog({ kind: "history", id })} />
            ))}
            {pending.map((p) => (
              <ProjectCardSkeleton key={p.id} name={p.name} />
            ))}
            {newTile}
          </div>
        )}
        <p className="text-caption text-fg-2" aria-live="polite">
          {cards.length + pending.length}개 표시 · 전체 {effective.items.length}개
        </p>
      </>
    );

  const active = dialog.kind === "rename" || dialog.kind === "delete" || dialog.kind === "history" ? rowOf(dialog.id) : null;

  return (
    <div className="flex flex-col gap-gap">
      <PageHeader
        title={DASH_TEXT.heading}
        description={`${todayLabel(new Date())} · ${TEXT.description}`}
        actions={
          <>
            {sampleButton}
            {newButton}
          </>
        }
      />
      {storeReadOnly ? <Banner tone="danger" title={TEXT.readOnlyTitle}>{TEXT.readOnlyBody}</Banner> : null}
      {corrupt || effective.status === "error" ? null : <SummaryStrip summary={summary} credit={credit} onViolations={() => setQuery({ ...query, sort: "violations", dir: "desc" })} />}
      <div className="flex flex-col gap-gap xl:flex-row xl:items-start">
        <section aria-labelledby="projects-list-title" className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="projects-list-title" className="text-h2 font-semibold text-fg">
              {TEXT.title}
            </h2>
          </div>
          {list}
        </section>
        <aside aria-label="오늘" className="grid grid-cols-1 gap-gap md:grid-cols-2 xl:w-80 xl:shrink-0 xl:grid-cols-1">
          {corrupt ? null : (
            <TodoPanel
              system={today}
              todos={todos}
              done={doneTodos}
              onToggle={(k, checked) =>
                setDoneTodos((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(k);
                  else next.delete(k);
                  return next;
                })
              }
              onConflict={() => setConflictOpen(true)}
            />
          )}
          <CreditCard view={credit} />
          <CloudActivityCard cloudNote={cloud.note} />
          <RevisionCard fallback={fallback} />
        </aside>
      </div>

      {dialog.kind === "new" ? <NewProjectDialog open busy={busy} error={dialogError} lookup={siteLookup} onClose={closeDialog} onSubmit={(v) => void createProject(v)} /> : null}
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
