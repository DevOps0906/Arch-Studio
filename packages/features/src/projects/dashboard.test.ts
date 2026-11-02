// AR-06-082 대시보드: 진척 단계·다음 할 일·오늘 할 일 생성·"초과 많은 순" 정렬·요약·크레딧 캐시(순수 함수) + 카드·크레딧 카드 구조.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { creditView, parseCreditCache, serializeCredit, usagePercent, ZERO_CREDIT_TEXT, type CreditSnapshot } from "./credit.ts";
import { buildCard, nextTodo, placeLine, projectTodos, siteOutline, sortCards, stageProgress, summarize, type CardInput, type VerdictFacts } from "./dashboard.ts";
import { applyListQuery, parseListQuery, writeListQuery, DEFAULT_QUERY } from "./list-query.ts";
import { loadProjectMemo, parseProjectMemo, projectMemoKey, saveProjectStage, saveProjectVerdict, segmentOf, verdictAction } from "../shell/workspace.ts";
import { ENGINE_OUTPUTS, toData } from "../judgment/fixtures.ts";
import { demoCredit, demoVerdicts } from "./demo-fixture.ts";

register("./tsx-hooks.mjs", import.meta.url);
const cards = await import("./cards.tsx");
const html = (node: ReactNode) => renderToStaticMarkup(h(MemoryRouter, null, node));

const house = DEMO_PROJECTS[0]!.model;
const bare: DesignModelV1 = { ...house, masses: [], floor_layouts: [], program: { checklist_answers: {}, targets: [], user_locked_rows: [] } };
const v = (pass: number, warn: number, fail: number): VerdictFacts => ({ pass, warn, fail, example: false });

function input(id: string, updatedAt: string, model: DesignModelV1 | null, verdict: VerdictFacts | null, sheets = 0): CardInput {
  return {
    id,
    name: `프로젝트 ${id}`,
    siteLabel: null,
    updatedAt,
    version: 1,
    cloudVersion: undefined,
    model,
    sheets: Array.from({ length: sheets }, (_, i) => ({ id: `site_plan-${i + 1}`, kind: "site_plan", paper: "A3", orientation: "landscape", scale: "auto", annotations: [], include_in_proposal: true }) as const),
    verdict,
  };
}

test("진척: 대지 → 모델 → 프로그램 → 평면 → 도면 순 첫 미완료 단계, 렌더·제안서는 근거 없어 미완료, 모델 없음은 1단계", () => {
  const o = siteOutline(bare);
  assert.ok(o, "직사각형 대지는 경계가 있다");
  assert.equal(stageProgress(bare, 0, o).current.id, "model");
  assert.deepEqual(stageProgress(bare, 0, o).done, [true, false, false, false, false, false]);
  const withMass = { ...bare, masses: house.masses };
  assert.equal(stageProgress(withMass, 0, o).current.id, "program");
  const p = stageProgress(house, 0, siteOutline(house));
  assert.ok(["program", "plans", "sheets"].includes(p.current.id));
  const all: DesignModelV1 = {
    ...house,
    program: { ...house.program, targets: [{ name: "a", use: "주거", target_area_m2: 10 }] },
    floor_layouts: [{ floor_id: "f1", rooms: [{ id: "r", name: "거실", use: "주거", polygon: { outer: [[0, 0], [1000, 0], [1000, 1000]] } }], openings: [] }],
  };
  assert.equal(stageProgress(all, 0, siteOutline(all)).current.id, "sheets");
  const done = stageProgress(all, 2, siteOutline(all));
  assert.equal(done.current.id, "output");
  assert.equal(done.current.n, 6);
  assert.equal(done.done[5], false);
  assert.equal(stageProgress(null, 0, null).current.id, "site");
  // 자기교차 경계 → 썸네일 없음(지어내지 않는다).
  const bad: DesignModelV1 = { ...bare, site: { ...bare.site, boundary: { outer: [[0, 0], [1000, 1000], [1000, 0], [0, 1000]] } } };
  assert.equal(siteOutline(bad), null);
});

test("다음 할 일: 기준 초과가 있으면 초과 해소, 아니면 현재 단계 할 일. 열기는 초과면 모델·판정, 아니면 현재 단계", () => {
  const p = stageProgress(bare, 0, siteOutline(bare));
  assert.equal(nextTodo(p, v(3, 1, 2)), "기준 초과 2건 해소");
  assert.equal(nextTodo(p, v(3, 1, 0)), "매스를 그려 판정하세요");
  assert.equal(nextTodo(p, null), "매스를 그려 판정하세요");
  const c = buildCard({ ...input("a", "2026-10-01T00:00:00Z", { ...bare, masses: house.masses }, null, 1) });
  assert.equal(c.openHref, "/projects/a/program");
  assert.equal(c.recentSheet, "배치도");
  assert.equal(c.sheetCount, 1);
  assert.equal(buildCard(input("b", "2026-10-01T00:00:00Z", bare, v(1, 0, 1))).openHref, "/projects/b/model");
  assert.equal(buildCard(input("c", "2026-10-01T00:00:00Z", bare, null)).recentSheet, null);
});

test("정렬: 초과 많은 순 = 초과 → 확인 → 최근 수정, 판정 기록 없는 카드는 맨 뒤, 같으면 id 고정. 최근 수정은 수정 시각 내림차순", () => {
  const rows = [
    { id: "a", updatedAt: "2026-10-05", verdict: null },
    { id: "b", updatedAt: "2026-10-01", verdict: v(5, 0, 2) },
    { id: "c", updatedAt: "2026-10-03", verdict: v(5, 3, 1) },
    { id: "d", updatedAt: "2026-10-04", verdict: v(5, 1, 1) },
    { id: "e", updatedAt: "2026-10-02", verdict: v(5, 0, 0) },
    { id: "f", updatedAt: "2026-10-02", verdict: v(5, 0, 0) },
  ];
  assert.deepEqual(sortCards(rows, "violations").map((r) => r.id), ["b", "c", "d", "e", "f", "a"]);
  assert.deepEqual(sortCards(rows, "updated").map((r) => r.id), ["a", "d", "c", "e", "f", "b"]);
  assert.equal(rows[0]!.id, "a", "원본 배열은 그대로");
  const q = parseListQuery(new URLSearchParams("sort=violations&q=b"));
  assert.equal(q.sort, "violations");
  assert.equal(q.dir, "desc");
  assert.equal(writeListQuery(new URLSearchParams("state=empty"), { ...DEFAULT_QUERY, sort: "violations", dir: "desc" }).toString(), "state=empty&sort=violations");
  assert.equal(parseListQuery(new URLSearchParams("sort=zzz")).sort, "updated");
  const named = rows.map((r) => ({ ...r, name: r.id, siteLabel: null }));
  assert.deepEqual(sortCards(applyListQuery(named, { ...DEFAULT_QUERY, sort: "violations", dir: "desc", q: "" }), "violations").map((r) => r.id), ["b", "c", "d", "e", "f", "a"]);
});

test("오늘 할 일: 초과(전 프로젝트) → 확인 → 남은 단계 순으로 자동 생성, 판정 없으면 단계 할 일만", () => {
  const list = [buildCard(input("a", "2026-10-02", bare, v(4, 1, 1))), buildCard(input("b", "2026-10-01", bare, v(4, 0, 2))), buildCard(input("c", "2026-10-01", bare, null))];
  const todos = projectTodos(list);
  assert.deepEqual(
    todos.map((t) => t.key),
    ["a:fail", "b:fail", "a:warn", "a:stage", "b:stage", "c:stage"],
  );
  assert.equal(todos[0]!.title, "프로젝트 a — 기준 초과 1건 해소");
  assert.equal(todos[0]!.badge, "초과");
  assert.equal(todos[2]!.badge, "확인");
  assert.equal(todos[5]!.detail, "2/6 모델·판정");
  assert.equal(todos[5]!.to, "/projects/c/model");
  assert.deepEqual(projectTodos([]), []);
});

test("요약: 판정 기록이 없으면 초과 항목 null(빈 상태), 있으면 합계·프로젝트 수, [예시] 섞임 표시", () => {
  assert.deepEqual(summarize([{ verdict: null }, { verdict: null }]), { active: 2, failItems: null, failProjects: 0, example: false });
  assert.deepEqual(summarize([{ verdict: v(1, 0, 2) }, { verdict: v(1, 0, 0) }, { verdict: null }]), { active: 3, failItems: 2, failProjects: 1, example: false });
  const demo = demoVerdicts(["z", "y", "x", "w"]);
  assert.equal(demo.size, 3);
  assert.equal(demo.get("z"), undefined, "id 순 앞 3개만");
  assert.ok([...demo.values()].every((d) => d.example));
});

test("크레딧: 캐시는 정수만 믿는다, 오프라인이면 마지막 값 + 기준 시각(stale), 값이 없으면 이유 문구, 사용 비율", () => {
  const snap: CreditSnapshot = { ...demoCredit(), example: false };
  const back = parseCreditCache(serializeCredit(snap));
  assert.deepEqual(back, snap);
  assert.equal(parseCreditCache(JSON.stringify({ ...JSON.parse(serializeCredit(snap)), balance: 1.5 })), null);
  assert.equal(parseCreditCache("{"), null);
  assert.equal(parseCreditCache(null), null);
  assert.deepEqual(creditView({ signedIn: true, online: false, fetched: null, cached: snap }), { status: "ready", snapshot: snap, stale: true });
  assert.deepEqual(creditView({ signedIn: true, online: true, fetched: demoCredit(), cached: snap }), { status: "ready", snapshot: demoCredit(), stale: false });
  assert.equal(creditView({ signedIn: false, online: true, fetched: null, cached: null }).status, "unavailable");
  assert.equal(creditView({ signedIn: true, online: true, fetched: undefined, cached: null }).status, "loading");
  assert.equal(usagePercent(snap), 38);
  assert.equal(usagePercent({ ...snap, balance: 0, monthUsed: 0 }), 0);
  const d = demoCredit();
  assert.equal(d.usage.reduce((s, u) => s + u.credits, 0), d.monthUsed, "데모 사용 합계 = 항목 합");
});

test("구조: 크레딧 카드 고정 문구, 오프라인은 기준 시각, 값 없음은 이유 문구(0 표시 없음)", () => {
  const ready = html(h(cards.CreditCard, { view: { status: "ready", snapshot: demoCredit(), stale: false } }));
  assert.ok(ready.includes(ZERO_CREDIT_TEXT));
  assert.equal(ZERO_CREDIT_TEXT, "도면 작도·판정·내보내기는 0 크레딧입니다.");
  assert.match(ready, /\[예시\]/);
  assert.match(ready, /role="progressbar"/);
  assert.match(ready, /href="\/credits"/);
  const stale = html(h(cards.CreditCard, { view: { status: "ready", snapshot: { ...demoCredit(), example: false }, stale: true } }));
  assert.match(stale, /기준 시각/);
  const none = html(h(cards.CreditCard, { view: { status: "unavailable", reason: "로그인하면(인터넷 연결 후) 잔액이 보입니다." } }));
  assert.match(none, /로그인하면/);
  assert.doesNotMatch(none, /role="progressbar"/);
});

test("구조: 프로젝트 카드 — 대지 썸네일(SitePreview SVG)·시트 없음·판정 배지 글자·6칸 진척·열기 링크, 판정 없음은 빈 상태 문구", () => {
  const c = buildCard(input("a", "2026-10-02T00:00:00Z", bare, v(4, 1, 1)));
  const out = html(h(cards.ProjectCard, { card: c, onManage: () => {} }));
  assert.match(out, /<svg[^>]*aria-label="대지 경계 그림/);
  assert.match(out, /시트 아직 없음/);
  assert.match(out, /통과 4/);
  assert.match(out, /확인 1/);
  assert.match(out, /초과 1/);
  assert.match(out, /aria-label="진척 2\/6 모델·판정"/);
  assert.equal((out.match(/<i /g) ?? []).length, 6);
  assert.match(out, /href="\/projects\/a\/model"[^>]*>열기/);
  const none = html(h(cards.ProjectCard, { card: buildCard(input("b", "2026-10-02T00:00:00Z", null, null)), onManage: () => {} }));
  assert.match(none, /판정 기록 없음/);
  assert.match(none, /대지 경계를 읽지 못했습니다/);
  assert.doesNotMatch(none, /통과 0/);
});

test("구조: 요약 4칸 — 판정·주간 시트 값이 없으면 '-'와 이유, 초과 수는 정렬 버튼(빨간 글자)", () => {
  const empty = html(h(cards.SummaryStrip, { summary: { active: 2, failItems: null, failProjects: 0, example: false }, credit: { status: "unavailable", reason: "x" }, onViolations: () => {} }));
  assert.match(empty, /판정 기록 없음/);
  assert.match(empty, /시트 생성 시각을 아직 기록하지 않습니다/);
  assert.match(empty, /grid-cols-2/, "모바일 2×2");
  const some = html(h(cards.SummaryStrip, { summary: { active: 3, failItems: 2, failProjects: 1, example: false }, credit: { status: "ready", snapshot: demoCredit(), stale: false }, onViolations: () => {} }));
  assert.match(some, /<button[^>]*text-danger[^>]*>2<\/button>/);
  assert.match(some, /1개 프로젝트/);
  assert.match(some, />30</);
});

test("소스: 대시보드 썸네일은 새 그리기 코드 없이 SitePreview(기존 SVG)만 쓴다", () => {
  const dir = import.meta.dirname;
  const src = readFileSync(path.join(dir, "cards.tsx"), "utf8");
  assert.match(src, /<SitePreview /);
  assert.doesNotMatch(src, /<(polygon|polyline|path|line|circle)\b/, "cards.tsx에 도형 그리기 없음");
  for (const f of readdirSync(dir).filter((x) => /^(dashboard|credit|useCreditBalance)\.ts$/.test(x))) {
    assert.doesNotMatch(readFileSync(path.join(dir, f), "utf8"), /from "\.\.\/demo\//, `${f}: 데모 모듈 import 금지`);
  }
});

test("카드: 용도지역은 한 번만, 마지막으로 연 단계가 있으면 열기는 거기로", () => {
  assert.equal(placeLine("제1종일반주거 · 396㎡", "제1종일반주거지역"), "제1종일반주거 · 396㎡");
  assert.equal(placeLine("[예시] 대지 A", "준주거지역"), "[예시] 대지 A · 준주거지역");
  assert.equal(placeLine(null, "준주거지역"), "준주거지역");
  assert.equal(placeLine(null, null), "대지 정보 없음");
  assert.equal(buildCard({ ...input("a", "2026-10-01", bare, v(1, 0, 3)), lastStage: "sheets" }).openHref, "/projects/a/sheets");
  assert.equal(buildCard({ ...input("a", "2026-10-01", bare, v(1, 0, 3)), lastStage: null }).openHref, "/projects/a/model");
});

test("셸 기록(프로젝트별 마지막 단계·판정 요약): 모르는 단계·정수 아닌 수·형식 오류는 버린다", () => {
  assert.equal(projectMemoKey("x"), "arch.workspace.project.v1.x");
  const ok = parseProjectMemo(JSON.stringify({ stage: "plans", verdict: { pass: 3, warn: 1, fail: 0, at: "2026-11-02T01:00:00.000Z", rulePack: "2026.10.0" } }));
  assert.deepEqual(ok, { stage: "plans", verdict: { pass: 3, warn: 1, fail: 0, at: "2026-11-02T01:00:00.000Z", rulePack: "2026.10.0" } });
  assert.deepEqual(parseProjectMemo(JSON.stringify({ stage: "evil", verdict: { pass: 1.5, warn: 0, fail: 0, at: "x", rulePack: null } })), { stage: null, verdict: null });
  assert.deepEqual(parseProjectMemo("{"), { stage: null, verdict: null });
  assert.deepEqual(parseProjectMemo(null), { stage: null, verdict: null });
});

test("셸 기록: segmentOf·verdictAction은 저장소를 건드리지 않고(순수), 저장은 save* 함수와 ProjectShell effect만", () => {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const g = globalThis as { localStorage?: unknown };
  const prev = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => (calls.push(`get:${k}`), store.get(k) ?? null),
    setItem: (k: string, v: string) => (calls.push(`set:${k}`), store.set(k, v)),
  };
  try {
    assert.equal(segmentOf("/projects/p1/plans"), "plans");
    const a = verdictAction("ready", toData(ENGINE_OUTPUTS[0]!), true);
    assert.equal(a?.type, "verdict");
    assert.deepEqual(calls, [], "렌더·리듀서 경로 함수는 localStorage 0회");
    saveProjectStage("p1", "plans");
    saveProjectStage("p1", "evil");
    if (a?.type === "verdict" && a.verdict) saveProjectVerdict("p1", a.verdict, "2026-11-02T01:00:00.000Z");
    const memo = loadProjectMemo("p1");
    assert.equal(memo.stage, "plans");
    assert.equal(memo.verdict?.at, "2026-11-02T01:00:00.000Z");
  } finally {
    g.localStorage = prev;
  }
  const shell = readFileSync(path.join(import.meta.dirname, "../shell/ProjectShell.tsx"), "utf8");
  assert.match(shell, /useEffect\(\(\) => \{\s*if \(projectId && segment\) saveProjectStage\(projectId, segment\);\s*\}, \[projectId, segment\]\)/);
  assert.match(shell, /if \(projectId && verdict\) saveProjectVerdict\(projectId, verdict, new Date\(\)\.toISOString\(\)\);\s*\}, \[projectId, verdict\]\)/);
});
