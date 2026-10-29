// /projects 순수 로직 + 화면 조각 구조(renderToStaticMarkup) + 소스 규칙(hex·px·금지 문구).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { designModelV1Schema } from "@arch-studio/domain";
import { BridgeError, type ProjectRecord, type ProjectStore } from "@arch-studio/shell-bridge";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { cloudVersionByLocalId, cloudVersionOf, parseCloudList } from "./cloud.ts";
import { demoCloudList, parsePreview } from "./demo-fixture.ts";
import { renameInput, restoreInput, revisionSourceOf, SessionHistory } from "./history.ts";
import { applyListQuery, DEFAULT_QUERY, isFiltered, parseListQuery, writeListQuery, type ListQuery } from "./list-query.ts";
import { classifyCloudError, classifyStoreError, cloudErrorText, formatDate, storeErrorText, TEXT, viewOnlyReason } from "./messages.ts";
import { buildInitialModel, copyName, EMPTY_FORM, NAME_MAX_CHARS, newProjectInput, uuidV7, validateName, validateNewProject } from "./new-project.ts";
import { todayItems } from "./today.ts";

register("./tsx-hooks.mjs", import.meta.url);
const parts = await import("./parts.tsx");
const dialogs = await import("./dialogs.tsx");
const sheet = await import("./HistorySheet.tsx");

const ID1 = "0192f0a0-1c00-7a01-8a01-000000000001";
const ID2 = "0192f0a0-1c00-7a01-8a01-000000000002";
const ID3 = "0192f0a0-1c00-7a01-8a01-000000000003";

/* ---------- 정렬·필터 URL 직렬화 ---------- */

test("URL 쿼리: 기본값은 URL에 쓰지 않고, 다른 쿼리(?state·?demo-*)는 보존한다", () => {
  const base = new URLSearchParams("demo-license=expired&state=empty");
  assert.equal(writeListQuery(base, DEFAULT_QUERY).toString(), "demo-license=expired&state=empty");
  const q: ListQuery = { sort: "name", dir: "asc", q: "  운중  ", store: "cloud" };
  const written = writeListQuery(base, q);
  assert.equal(written.get("sort"), "name");
  assert.equal(written.has("dir"), false, "이름 정렬 기본 방향(asc)은 생략");
  assert.equal(written.get("q"), "운중");
  assert.equal(written.get("store"), "cloud");
  assert.equal(written.get("demo-license"), "expired");
  assert.deepEqual(parseListQuery(written), { sort: "name", dir: "asc", q: "운중", store: "cloud" });
  // 왕복: parse(write(x)) = x
  for (const sort of ["updated", "name"] as const)
    for (const dir of ["asc", "desc"] as const)
      for (const store of ["all", "local", "cloud"] as const) {
        const x: ListQuery = { sort, dir, q: "a", store };
        assert.deepEqual(parseListQuery(writeListQuery(new URLSearchParams(), x)), x);
      }
});

test("URL 쿼리: 모르는 값은 기본값, 검색어 80자 자름, 정렬 키별 기본 방향", () => {
  assert.deepEqual(parseListQuery(new URLSearchParams("sort=evil&dir=sideways&store=__proto__")), DEFAULT_QUERY);
  assert.equal(parseListQuery(new URLSearchParams(`q=${"가".repeat(100)}`)).q.length, 80);
  assert.equal(parseListQuery(new URLSearchParams("sort=name")).dir, "asc");
  assert.equal(parseListQuery(new URLSearchParams("sort=updated")).dir, "desc");
  assert.equal(isFiltered(DEFAULT_QUERY), false);
  assert.equal(isFiltered({ ...DEFAULT_QUERY, store: "local" }), true);
});

test("정렬·필터: 이름(한글 가나다)·수정일, 같은 값은 id로 고정, 검색은 이름+대지, 클라우드 미확인 행은 cloud 필터에서 빠진다", () => {
  const rows = [
    { id: ID2, name: "송도 주택", siteLabel: "송도동", updatedAt: "2026-10-27T00:00:00Z", cloudVersion: null },
    { id: ID1, name: "가람 주택", siteLabel: "운중동", updatedAt: "2026-10-28T00:00:00Z", cloudVersion: 2 },
    { id: ID3, name: "나래 주택", siteLabel: null, updatedAt: "2026-10-28T00:00:00Z", cloudVersion: undefined },
  ];
  const ids = (q: Partial<ListQuery>) => applyListQuery(rows, { ...DEFAULT_QUERY, ...q }).map((r) => r.id);
  assert.deepEqual(ids({}), [ID1, ID3, ID2], "수정일 desc, 같은 수정일은 id 오름차순으로 고정");
  assert.deepEqual(ids({ sort: "name", dir: "asc" }), [ID1, ID3, ID2]);
  assert.deepEqual(ids({ sort: "name", dir: "desc" }), [ID2, ID3, ID1]);
  assert.deepEqual(ids({ q: "운중" }), [ID1]);
  assert.deepEqual(ids({ q: "주택", store: "cloud" }), [ID1]);
  assert.deepEqual(ids({ store: "local" }), [ID3, ID2]);
  assert.equal(rows[0]!.id, ID2, "입력 배열을 바꾸지 않는다");
});

/* ---------- 새 프로젝트 입력 ---------- */

test("새 프로젝트: 필수·형식·상한 검증, 값은 문구에 넣지 않는다", () => {
  const r = validateNewProject(EMPTY_FORM);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["depthM", "name", "useDistrict", "widthM"]);
  const bad = validateNewProject({ name: "가".repeat(NAME_MAX_CHARS + 1), siteLabel: "a\nb", useDistrict: "없는지역", widthM: "1e3", depthM: "-5" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.match(bad.errors.name!, /120자/);
    assert.match(bad.errors.siteLabel!, /제어 문자/);
    assert.match(bad.errors.useDistrict!, /고르세요/);
    assert.match(bad.errors.widthM!, /숫자만/);
    assert.match(bad.errors.depthM!, /숫자만/);
    assert.ok(!JSON.stringify(bad.errors).includes("없는지역"));
  }
  const zero = validateNewProject({ name: "a", siteLabel: "", useDistrict: "준주거지역", widthM: "0", depthM: "1001" });
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.ok(zero.errors.widthM && zero.errors.depthM);
  assert.equal(validateName("  "), "프로젝트 이름을 넣으세요.");
  assert.equal(validateName("탭\t이름") !== null, true);
  assert.equal(validateName("운중동 단독주택"), null);
});

test("새 프로젝트: 첫 모델은 DesignModel v1 스키마를 통과하고, 같은 입력 → 같은 바이트(mm 정수, 반시계 직사각형)", () => {
  const r = validateNewProject({ name: " 새 주택 ", siteLabel: "[예시] 성남시 000-0", useDistrict: "제2종일반주거지역", widthM: "18.5", depthM: "22" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.values.name, "새 주택");
  assert.equal(r.values.widthMm, 18500);
  const model = buildInitialModel(r.values);
  assert.ok(designModelV1Schema.safeParse(model).success);
  assert.deepEqual(model.site.boundary.outer, [
    [0, 0],
    [18500, 0],
    [18500, 22000],
    [0, 22000],
  ]);
  const a = newProjectInput(ID1, r.values);
  const b = newProjectInput(ID1, r.values);
  assert.equal(a.designModel, b.designModel);
  assert.equal(a.expectedVersion, null, "새 프로젝트는 expectedVersion null");
  assert.equal(a.siteLabel, "[예시] 성남시 000-0");
  assert.ok(designModelV1Schema.safeParse(JSON.parse(a.designModel)).success);
  const noLabel = validateNewProject({ name: "x", siteLabel: "", useDistrict: "준주거지역", widthM: "10", depthM: "10" });
  assert.ok(noLabel.ok && designModelV1Schema.safeParse(buildInitialModel(noLabel.values)).success);
});

test("UUIDv7: 시각 앞 48비트·버전 7·변형 10, ProjectStore id 형식", () => {
  const id = uuidV7(0x0192f0a01c00, new Uint8Array(10).fill(0xff));
  assert.match(id, /^0192f0a0-1c00-7fff-bfff-ffffffffffff$/);
  assert.match(uuidV7(Date.UTC(2026, 9, 29), new Uint8Array(10)), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => uuidV7(-1, new Uint8Array(10)));
  assert.throws(() => uuidV7(1, new Uint8Array(9)));
  assert.equal(copyName("운중동"), "운중동 (내 변경)");
  assert.equal(Array.from(copyName("가".repeat(200))).length, NAME_MAX_CHARS);
});

/* ---------- 오류 문구 매핑 ---------- */

test("저장소 오류: VERSION_CONFLICT·AR060·AR061·NOT_FOUND 분류와 문구(03장 5장, 04장 7.3절), 모르는 오류는 일반 문구", () => {
  assert.equal(classifyStoreError(new BridgeError("VERSION_CONFLICT")), "conflict");
  assert.equal(classifyStoreError(new BridgeError("AR060")), "corrupt");
  assert.equal(classifyStoreError(new BridgeError("AR061")), "readOnly");
  assert.equal(classifyStoreError(new BridgeError("NOT_FOUND")), "notFound");
  assert.equal(classifyStoreError(new Error("AR060")), "other", "모양이 BridgeError가 아니면 분류하지 않는다");
  assert.match(storeErrorText(new BridgeError("VERSION_CONFLICT")), /먼저 저장되었습니다\. 병합하지 않습니다/);
  assert.match(storeErrorText(new BridgeError("AR060")), /backups\/pre-migrate\.db/);
  assert.match(storeErrorText(new BridgeError("AR060")), /고객지원/);
  assert.match(storeErrorText(new BridgeError("AR061")), /열람·내보내기만/);
  assert.equal(storeErrorText(new Error("C:\\Users\\kim\\secret.db")), TEXT.saveFailed);
});

test("클라우드 오류: AR041 충돌(2선택)·AR040 상한(n)·402 편집 권한·오프라인", () => {
  assert.equal(classifyCloudError("AR041"), "conflict");
  assert.equal(classifyCloudError("AR040"), "limit");
  assert.equal(classifyCloudError("entitlement_expired", 402), "noEdit");
  assert.equal(classifyCloudError("network_offline"), "offline");
  assert.match(cloudErrorText("AR041"), /병합하지 않습니다/);
  assert.match(cloudErrorText("AR041"), /파일로 내려받기/);
  assert.equal(cloudErrorText("AR040", 403, 3), "클라우드 사본은 3개까지 올립니다. 오래된 사본을 지우세요.");
  assert.match(cloudErrorText("AR040"), /한도/);
  assert.match(cloudErrorText("x", 402), /편집 권한이 없어 저장하지 못했습니다/);
  assert.equal(TEXT.conflictCopy, "내 변경을 사본으로 저장");
  assert.equal(TEXT.conflictLatestCloud, "서버 최신 열기");
});

test("열람 모드: 만료는 5.1절 문구 그대로, 그 밖 사유는 짧은 사유 + 열람 안내, 허용·판정 중은 null", () => {
  assert.equal(viewOnlyReason({ allowed: false, reason: "expired" }), "체험이 끝나 열람과 내보내기만 됩니다. 라이선스나 구독으로 편집을 이어 가세요.");
  assert.match(viewOnlyReason({ allowed: false, reason: "unverified" })!, /권한을 아직 확인하지 못했습니다/);
  assert.equal(viewOnlyReason({ allowed: true }), null);
  assert.equal(viewOnlyReason(undefined), null);
  assert.equal(formatDate("nope"), "-");
});

/* ---------- 오늘 처리할 일 ---------- */

test("오늘 처리할 일: 근거 있는 항목만(충돌·열람·폴백), 없으면 빈 배열", () => {
  assert.deepEqual(todayItems({ edit: { allowed: true }, cloudReview: { allowed: true }, openConflicts: 0 }), []);
  assert.deepEqual(todayItems({ edit: undefined, cloudReview: undefined, openConflicts: 0 }), []);
  const all = todayItems({ edit: { allowed: false, reason: "expired" }, cloudReview: { allowed: false, reason: "expired" }, openConflicts: 2 });
  assert.deepEqual(all.map((i) => i.id), ["conflict", "view-only"]);
  assert.match(all[0]!.title, /2건/);
  const fb = todayItems({ edit: { allowed: true }, cloudReview: { allowed: false, reason: "fallback" }, openConflicts: 0 });
  assert.deepEqual(fb.map((i) => i.id), ["fallback"]);
  assert.ok(!JSON.stringify(fb).match(/\d+건/), "개정 건수는 근거가 없어 숫자로 만들지 않는다");
});

/* ---------- 클라우드 목록 ---------- */

test("클라우드 목록: 형식 틀린 행 버림, 로컬 id별 최신 사본 버전, 확인 못 함(undefined)·없음(null) 구분", () => {
  const list = parseCloudList({
    items: [
      { project_uuid: "11111111-1111-4111-8111-111111111111", local_id: ID1, name: "a", version: 2, bytes: 10, updated_at: "2026-10-28T00:00:00Z", org_id: "x" },
      { project_uuid: "22222222-2222-4222-8222-222222222222", local_id: ID1, name: "b", version: 5, bytes: 10, updated_at: "2026-10-28T00:00:00Z" },
      { project_uuid: "bad", local_id: ID2, name: "c", version: 1, bytes: 1, updated_at: "2026-10-28T00:00:00Z" },
      { project_uuid: "33333333-3333-4333-8333-333333333333", local_id: null, name: "web", version: 1, bytes: 1, updated_at: "2026-10-28T00:00:00Z" },
    ],
    next: null,
    max: 3,
    retention_until: null,
  });
  assert.equal(list.items.length, 3);
  assert.ok(!("org_id" in (list.items[0] as object)));
  const map = cloudVersionByLocalId(list);
  assert.equal(cloudVersionOf(map, ID1), 5);
  assert.equal(cloudVersionOf(map, ID2), null);
  assert.equal(cloudVersionOf(null, ID1), undefined);
  assert.throws(() => parseCloudList({ items: "x" }));
  assert.equal(demoCloudList([ID1], "2026-10-28T00:00:00Z").items[0]?.localId, ID1);
  assert.equal(parsePreview("conflict"), "conflict");
  assert.equal(parsePreview("../x"), null);
});

/* ---------- 버전 이력·복원 ---------- */

function record(version: number, over: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: ID1,
    name: "운중동",
    siteLabel: "성남",
    clientName: null,
    clientContact: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: `2026-10-0${version}T00:00:00Z`,
    version,
    schemaVersion: 1,
    engineVersion: "e",
    designModel: `{"v":${version}}`,
    sha256: String(version).repeat(64),
    ...over,
  };
}

test("복원·이름 바꾸기: 새 버전으로 저장(expectedVersion = 목록에서 본 버전), 지금 버전 복원은 없음", () => {
  const cur = record(4);
  const input = restoreInput(cur, { version: 2, schemaVersion: 1, engineVersion: "old", designModel: '{"v":2}' }, "v2에서 복원");
  assert.ok(input);
  assert.equal(input!.expectedVersion, 4);
  assert.equal(input!.designModel, '{"v":2}');
  assert.equal(input!.name, "운중동");
  assert.equal(restoreInput(cur, { version: 4, schemaVersion: 1, engineVersion: "e", designModel: "{}" }, "x"), null);
  const rn = renameInput(record(5), 4, "새 이름");
  assert.equal(rn.expectedVersion, 4, "최신(5)으로 바꿔 끼우지 않는다 → 저장소가 VERSION_CONFLICT");
  assert.equal(rn.designModel, '{"v":5}');
});

test("버전 이력 원천: 저장소에 리비전 메서드가 없으면 null, 있으면 최신 먼저. 세션 이력은 본·저장한 버전만", async () => {
  const base: ProjectStore = { list: async () => [], open: async () => record(3), save: async () => ({ version: 1, sha256: "" }), delete: async () => {} };
  assert.equal(revisionSourceOf(base), null);
  const withRev = Object.assign(Object.create(base) as ProjectStore, {
    listRevisions: async () => [
      { version: 1, savedAt: "a", sha256: "1", note: null },
      { version: 3, savedAt: "c", sha256: "3", note: null },
    ],
    openRevision: async (_id: string, v: number) => ({ version: v, schemaVersion: 1, engineVersion: "e", designModel: "{}" }),
  });
  const src = revisionSourceOf(withRev);
  assert.ok(src);
  assert.deepEqual((await src!.list(ID1)).map((r) => r.version), [3, 1]);
  const session = new SessionHistory(base);
  session.remember(record(2), "이름 바꾸기");
  assert.deepEqual((await session.list(ID1)).map((r) => [r.version, r.note]), [
    [3, null],
    [2, "이름 바꾸기"],
  ]);
  assert.equal((await session.open(ID1, 2))?.designModel, '{"v":2}');
  assert.equal(await session.open(ID1, 1), null);
});

/* ---------- 화면 조각 구조 ---------- */

const html = (node: ReactNode) => renderToStaticMarkup(h(MemoryRouter, null, node));

test("구조: 표는 열 5개(이름·대지·저장·수정일·작업), 이름은 모델 탭 링크, 저장 칩은 5.1절 문구, 행 작업은 관리 하나", () => {
  const rows = [
    { id: ID1, name: "운중동 단독주택", siteLabel: "제1종", updatedAt: "2026-10-28T00:00:00Z", version: 3, cloudVersion: 2 },
    { id: ID2, name: "송도", siteLabel: null, updatedAt: "2026-10-27T00:00:00Z", version: 1, cloudVersion: null },
    { id: ID3, name: "역삼", siteLabel: null, updatedAt: "2026-10-26T00:00:00Z", version: 1, cloudVersion: undefined },
  ];
  const out = html(h(parts.ProjectTable, { rows, onManage: () => {} }));
  assert.equal((out.match(/<th /g) ?? []).length, 5);
  assert.match(out, new RegExp(`href="/projects/${ID1}/model"`));
  assert.match(out, /이 PC v3 · 클라우드 사본 v2/);
  assert.match(out, /이 PC에만 · v1/);
  assert.match(out, /이 PC · v1/, "클라우드 미확인 행은 '이 PC에만'이라고 단정하지 않는다");
  assert.equal((out.match(/<button[^>]*>관리<\/button>/g) ?? []).length, 3, "행 작업은 관리 하나(삭제는 시트 안쪽)");
  assert.match(out, /aria-label="운중동 단독주택 관리"/);
  assert.doesNotMatch(out, />삭제</);
  assert.doesNotMatch(out, /판정|시트 수/, "조회 경로가 없는 열은 두지 않는다");
});

test("구조: 오늘 처리할 일 — 빈 상태 한 줄, 항목은 아이콘+글자, 충돌은 버튼, 열람은 라이선스 링크, h2 하나", () => {
  const empty = html(h(parts.TodayBlock, { items: [], cloudNote: TEXT.cloudSignedOut, onConflict: () => {} }));
  assert.match(empty, /오늘 처리할 일이 없습니다/);
  assert.match(empty, /로그인하면\(인터넷 연결 후\) 클라우드 작업이 보입니다/);
  assert.equal((empty.match(/<h2/g) ?? []).length, 1);
  const items = todayItems({ edit: { allowed: false, reason: "expired" }, cloudReview: undefined, openConflicts: 1 });
  const out = html(h(parts.TodayBlock, { items, cloudNote: null, onConflict: () => {} }));
  assert.match(out, /<button[^>]*>고르기<\/button>/);
  assert.match(out, /href="\/license"/);
  assert.equal((out.match(/<svg/g) ?? []).length, 2, "항목마다 아이콘");
});

test("구조: 필터 바 라벨 3개·검색 role, 충돌 대화상자 두 선택만, 삭제 대화상자 버전 표시, 새 프로젝트 필드 5개", () => {
  const filter = html(h(parts.FilterBar, { query: { sort: "name", dir: "desc", q: "운중", store: "cloud" }, onChange: () => {} }));
  assert.match(filter, /role="search"/);
  assert.equal((filter.match(/<label/g) ?? []).length, 3);
  assert.match(filter, /value="운중"/);
  const conflict = html(h(dialogs.ConflictDialog, { open: true, kind: "cloud", name: "운중동", busy: false, error: null, onClose: () => {}, onSaveCopy: () => {}, onOpenLatest: () => {} }));
  const buttons = [...conflict.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]).filter((t) => t !== "");
  assert.deepEqual(buttons, ["서버 최신 열기", "내 변경을 사본으로 저장"]);
  assert.doesNotMatch(conflict, /비교/);
  const local = html(h(dialogs.ConflictDialog, { open: true, kind: "local", name: "a", busy: false, error: null, onClose: () => {}, onSaveCopy: () => {}, onOpenLatest: () => {} }));
  assert.match(local, /저장된 최신 열기/);
  const del = html(h(dialogs.DeleteDialog, { open: true, name: "운중동", version: 7, busy: false, error: null, onClose: () => {}, onConfirm: () => {} }));
  assert.match(del, /지금 버전 v7/);
  const form = html(h(dialogs.NewProjectDialog, { open: true, busy: false, error: null, onClose: () => {}, onSubmit: () => {} }));
  assert.equal((form.match(/<label/g) ?? []).length, 5);
  assert.equal((form.match(/<option/g) ?? []).length, 22, "고르세요 + 용도지역 21종");
  const hist = html(
    h(sheet.HistorySheet, {
      open: true,
      name: "운중동",
      load: { status: "ready", current: 2, items: [{ version: 2, savedAt: "2026-10-28T00:00:00Z", sha256: "ab".repeat(32), note: null }, { version: 1, savedAt: "2026-10-27T00:00:00Z", sha256: "cd".repeat(32), note: "새 프로젝트" }] },
      writable: true,
      busyVersion: null,
      restoreError: null,
      onClose: () => {},
      onRestore: () => {},
      onRename: () => {},
      onDelete: () => {},
    }),
  );
  assert.equal((hist.match(/이 버전으로 복원/g) ?? []).length, 1, "지금 버전에는 복원 버튼 없음");
  assert.match(hist, /지금 버전/);
  const unavailable = html(
    h(sheet.HistorySheet, { open: true, name: "a", load: { status: "unavailable", current: 3 }, writable: false, busyVersion: null, restoreError: null, onClose: () => {}, onRestore: () => {}, onRename: () => {}, onDelete: () => {} }),
  );
  assert.equal((unavailable.match(/<button[^>]*disabled=""[^>]*>(이름 바꾸기|삭제)<\/button>/g) ?? []).length, 2, "열람 모드면 이름 바꾸기·삭제 비활성");
  assert.match(unavailable, /지금 버전 v3/);
  assert.match(unavailable, /이전 버전 목록을 아직 읽지 못합니다/);
});

/* ---------- 소스 규칙 ---------- */

const DIR = import.meta.dirname;
const SOURCES = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));

test("소스: hex 색·px 크기·임의값 크기 0(토큰만), 이모지 0", () => {
  assert.ok(SOURCES.length >= 9);
  for (const f of SOURCES) {
    const text = readFileSync(path.join(DIR, f), "utf8");
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b(?![-\w])/, `${f}: hex`);
    assert.doesNotMatch(text, /\b\d+px\b|\bh-px\b|\[\d+(px|rem)\]/, `${f}: px`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${f}: 이모지`);
  }
});

test("소스: 금지 문구 0(PRD 6.1절 보장·완전성·전문가 대체), 화면은 shell-bridge를 타입으로만", () => {
  const banned = /허가 100%|반려 걱정|허가 가능|모든 법규 자동|법규 완벽|건축사 없이|설계사무소가 필요 없|국토부 인증|세움터 공식|공식 파트너|실제 완공 모습/;
  for (const f of SOURCES) {
    const text = readFileSync(path.join(DIR, f), "utf8");
    assert.doesNotMatch(text, banned, f);
    for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"(@arch-studio\/shell-bridge[^"]*)"/gms)) assert.ok(m[1], `${f}: ${m[2]}`);
    assert.doesNotMatch(text, /from "\.\.\/demo\//, `${f}: 데모 모듈 import 금지(릴리스 번들)`);
    assert.doesNotMatch(text, /arch-demo-data-v1/, f);
  }
});
