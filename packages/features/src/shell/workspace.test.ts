// 통합 작업공간 순수 로직(AR-06-081): GNB 작업공간 메뉴 대상 6상황(03장 9.5절 표), 단계 전환 시 판정 요약 유지·URL 변경, 6단계 막대.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ENGINE_OUTPUTS, exampleConfirmed, toData } from "../judgment/fixtures.ts";
import { buildRows, countStatuses } from "../judgment/model.ts";
import {
  INITIAL_WORKSPACE,
  NEXT_STEP,
  LIST_FAILED_TEXT,
  NO_P1_TEXT,
  NO_PROJECT_TEXT,
  WORKSPACE_MENU,
  WORKSPACE_STAGES,
  parseRecent,
  recentProjects,
  segmentOf,
  stageHref,
  stageOf,
  verdictAction,
  verdictOf,
  workspaceMenuTarget,
  workspaceReducer,
  type ProjectBrief,
  type WorkspaceMenuInput,
} from "./workspace.ts";

const item = (segment: "model" | "plans" | "sheets") => WORKSPACE_MENU.find((i) => i.segment === segment)!;
const P = (id: string, updatedAt: string, name = id): ProjectBrief => ({ id, name, siteLabel: null, updatedAt });
const SIX = [P("a", "2026-10-01T00:00:00Z"), P("b", "2026-10-06T00:00:00Z"), P("c", "2026-10-03T00:00:00Z"), P("d", "2026-10-05T00:00:00Z"), P("e", "2026-10-02T00:00:00Z"), P("f", "2026-10-04T00:00:00Z")];
const base: WorkspaceMenuInput = { item: item("model"), currentProjectId: null, currentSegment: null, lastProjectId: null, projects: SIX, listFailed: false, p1Available: true, readOnly: false };

test("메뉴: 9.5절 순서(모델링·평면·도면)와 경로", () => {
  assert.deepEqual(WORKSPACE_MENU.map((i) => [i.label, i.segment]), [["모델링", "model"], ["평면", "plans"], ["도면", "sheets"]]);
});

test("메뉴 대상 ① 프로젝트 안: 그 프로젝트의 해당 단계, 현재 단계면 현재 위치", () => {
  const t = workspaceMenuTarget({ ...base, item: item("sheets"), currentProjectId: "p 1", currentSegment: "sheets" });
  assert.deepEqual(t, { kind: "go", to: "/projects/p%201/sheets", current: true, hint: null });
  const other = workspaceMenuTarget({ ...base, item: item("model"), currentProjectId: "p1", currentSegment: "sheets", projects: null });
  assert.deepEqual(other, { kind: "go", to: "/projects/p1/model", current: false, hint: null }, "프로젝트 안에서는 목록을 기다리지 않는다");
});

test("메뉴 대상 ② 프로젝트 밖 + 최근 프로젝트 있음: 그 프로젝트의 해당 단계, 툴팁 '<이름>에서 열기'", () => {
  const t = workspaceMenuTarget({ ...base, item: item("plans"), lastProjectId: "c", projects: [...SIX.slice(0, 2), P("c", "2026-10-03T00:00:00Z", "단독주택 A"), ...SIX.slice(3)] });
  assert.deepEqual(t, { kind: "go", to: "/projects/c/plans", current: false, hint: "단독주택 A에서 열기" });
});

test("메뉴 대상 ③ 최근 프로젝트를 정할 수 없음(삭제됨·없음) + 1개 이상: 최근 수정 5개 고르기", () => {
  for (const lastProjectId of ["deleted", null]) {
    const t = workspaceMenuTarget({ ...base, lastProjectId });
    assert.equal(t.kind, "pick");
    if (t.kind === "pick") assert.deepEqual(t.candidates.map((p) => p.id), ["b", "d", "f", "c", "e"]);
  }
  // 같은 시각이면 이름순(입력 순서 무관)
  const tie = [P("2", "2026-10-01T00:00:00Z", "나"), P("1", "2026-10-01T00:00:00Z", "가")];
  assert.deepEqual(recentProjects(tie).map((p) => p.name), ["가", "나"]);
  assert.deepEqual(recentProjects([...tie].reverse()).map((p) => p.name), ["가", "나"]);
});

test("메뉴 대상 ④ 프로젝트 0개: 이동 없음, 비활성 + 이유 + 새 프로젝트 링크", () => {
  assert.deepEqual(workspaceMenuTarget({ ...base, projects: [] }), { kind: "disabled", reason: NO_PROJECT_TEXT, action: { label: "새 프로젝트", to: "/projects" } });
  assert.deepEqual(workspaceMenuTarget({ ...base, projects: null }), { kind: "pending" }, "목록을 읽기 전에는 0개로 단정하지 않는다");
});

test("메뉴 대상: 목록 읽기 실패는 빈 목록·읽는 중과 따로(프로젝트 목록으로 가기 안내), 프로젝트 안에서는 영향 없음", () => {
  const failed = { ...base, projects: null, listFailed: true };
  assert.deepEqual(workspaceMenuTarget(failed), { kind: "failed", reason: LIST_FAILED_TEXT, action: { label: "프로젝트 목록으로 가기", to: "/projects" } });
  assert.equal(workspaceMenuTarget({ ...failed, currentProjectId: "p1" }).kind, "go");
});

test("메뉴 대상 ⑤ 평면(P1)이 없는 빌드: 평면만 비활성 + 이유(프로젝트 안이어도)", () => {
  const off = { ...base, p1Available: false, currentProjectId: "p1" };
  assert.deepEqual(workspaceMenuTarget({ ...off, item: item("plans") }), { kind: "disabled", reason: NO_P1_TEXT, action: null });
  assert.equal(workspaceMenuTarget({ ...off, item: item("model") }).kind, "go");
  assert.equal(workspaceMenuTarget({ ...off, item: item("sheets") }).kind, "go");
});

test("메뉴 대상 ⑥ 체험만료·구독만료: 숨기지 않고 열린다(열람 모드 안내만 붙음)", () => {
  const inside = workspaceMenuTarget({ ...base, currentProjectId: "p1", readOnly: true });
  assert.deepEqual(inside, { kind: "go", to: "/projects/p1/model", current: false, hint: "열람 모드로 열립니다" });
  const recent = workspaceMenuTarget({ ...base, lastProjectId: "a", readOnly: true });
  assert.equal(recent.kind, "go");
  if (recent.kind === "go") assert.equal(recent.hint, "a에서 열기 · 열람 모드로 열립니다");
  assert.equal(workspaceMenuTarget({ ...base, readOnly: true }).kind, "pick");
});

test("최근 프로젝트 기억: 깨진·모르는 값은 null", () => {
  assert.equal(parseRecent(null), null);
  assert.equal(parseRecent("{"), null);
  assert.equal(parseRecent('{"id":3}'), null);
  assert.equal(parseRecent(JSON.stringify({ id: "x".repeat(65) })), null);
  assert.equal(parseRecent('{"id":"0192f0a0"}'), "0192f0a0");
});

test("6단계 막대: 순서·이름, 검토는 6단계 하위, 경로 → 단계", () => {
  assert.deepEqual(WORKSPACE_STAGES.map((s) => `${s.n} ${s.label}`), ["1 대지", "2 모델·판정", "3 프로그램", "4 평면", "5 도면", "6 렌더·제안서"]);
  assert.equal(stageOf(segmentOf("/projects/abc/review"))?.id, "output");
  assert.equal(stageOf(segmentOf("/projects/abc/proposal"))?.n, 6);
  assert.equal(stageOf(segmentOf("/projects/abc/model"))?.n, 2);
  assert.equal(segmentOf("/projects/abc"), null);
  assert.equal(stageOf(null), null);
  // 다음 단계(9.2절 표)
  assert.equal(NEXT_STEP.model?.label, "다음: 평면");
  assert.equal(NEXT_STEP.plans?.label, "다음: 도면 만들기");
  assert.equal(NEXT_STEP.sheets?.label, "다음: 렌더·제안서");
  assert.equal(NEXT_STEP.review, null);
  for (const s of WORKSPACE_STAGES) for (const seg of s.segments) assert.ok(seg in NEXT_STEP, seg);
});

test("단계 전환: URL은 단계별로 바뀌고 판정 요약은 같은 값(다음 화면이 판정 중이면 이전 값 유지)", () => {
  const data = exampleConfirmed(ENGINE_OUTPUTS[0]!, "fail");
  const v = verdictOf(data)!;
  // 판정 패널 머리 요약과 같은 함수로 센다
  assert.deepEqual({ pass: v.pass, warn: v.warn, fail: v.fail, unverified: v.unverified }, countStatuses(buildRows(data).quant));
  assert.ok(v.fail > 0);
  const urls = ["model", "plans", "sheets", "render"].map((seg) => stageHref("p1", seg));
  assert.equal(new Set(urls).size, 4);
  // 모델에서 판정 완료 → 평면으로 이동: 요청 직전(idle)·판정 중(loading)은 올리지 않는다 → 같은 모델 판정 결과
  let s = workspaceReducer(INITIAL_WORKSPACE, verdictAction("ready", data, true)!);
  const atModel = s.verdict;
  assert.equal(verdictAction("idle", null, true), null);
  assert.equal(verdictAction("loading", data, true), null);
  const again = workspaceReducer(s, verdictAction("ready", exampleConfirmed(ENGINE_OUTPUTS[0]!, "fail"), true)!);
  assert.equal(again, s, "같은 값이면 상태가 바뀌지 않는다(다시 그리지 않음)");
  s = again;
  assert.deepEqual(s.verdict, atModel);
  // 패널 접힘도 단계와 무관하게 유지
  const folded = workspaceReducer(s, { type: "toggleDock" });
  assert.equal(folded.dockCollapsed, true);
  assert.deepEqual(folded.verdict, atModel);
  assert.equal(verdictOf(null), null);
  assert.equal(verdictOf(toData(ENGINE_OUTPUTS[0]!, { elapsedMs: 37.6 }))?.judgeMs, "38ms");
});

test("판정 없음: 마지막 매스 삭제(판정 안 함)·판정 오류·도면 판정 꺼짐이면 요약을 지운다", () => {
  const judged = workspaceReducer(INITIAL_WORKSPACE, verdictAction("ready", exampleConfirmed(ENGINE_OUTPUTS[0]!, "fail"), true)!);
  assert.notEqual(judged.verdict, null);
  // 매스를 모두 지우면 useJudgment는 reset(idle) + active=false
  assert.equal(workspaceReducer(judged, verdictAction("idle", null, false)!).verdict, null);
  assert.equal(workspaceReducer(judged, verdictAction("error", null, true)!).verdict, null);
  assert.equal(workspaceReducer(judged, verdictAction("ready", exampleConfirmed(ENGINE_OUTPUTS[0]!, "fail"), false)!).verdict, null, "판정이 꺼지면 남은 결과도 쓰지 않는다");
});

test("프로젝트 전환: A→B로 가면 작업공간 상태를 새로 만든다(ProjectFrame key=id), 초기 상태엔 판정 요약 없음", () => {
  const src = readFileSync(path.join(import.meta.dirname, "ProjectShell.tsx"), "utf8");
  assert.match(src, /<ProjectFrame key=\{id\} \/>/);
  assert.equal(INITIAL_WORKSPACE.verdict, null);
  assert.equal(INITIAL_WORKSPACE.dockCollapsed, false);
});

test("패널 펼치기(reveal): 접힌 패널을 펴고 그 절을 연다(압출 → 속성 절)", () => {
  let s = workspaceReducer(INITIAL_WORKSPACE, { type: "toggleDock" });
  s = workspaceReducer(s, { type: "section", id: "inspector", open: false });
  s = workspaceReducer(s, { type: "reveal", id: "inspector" });
  assert.equal(s.dockCollapsed, false);
  assert.equal(s.sections.inspector, true);
  assert.equal(workspaceReducer(s, { type: "reveal", id: "inspector" }), s);
});

test("소스: 셸 작업공간 파일에 hex 색·px 크기 없음", () => {
  const dir = import.meta.dirname;
  const own = ["workspace.ts", "Workspace.tsx", "ProjectShell.tsx", "AppShell.tsx"];
  for (const n of readdirSync(dir).filter((f) => own.includes(f))) {
    const code = readFileSync(path.join(dir, n), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${n}: hex`);
    assert.doesNotMatch(code, /\d+px\b/, `${n}: px`);
  }
});
