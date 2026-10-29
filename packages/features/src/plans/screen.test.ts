// 평면 화면 소스 규칙(hex·px 0, innerHTML 0), 키 번역, 편집 상태기계, 도면 미리보기 요청·응답, 서버 렌더 구조.
// .tsx는 tsx-hooks.mjs 로더로 불러온다(JSX 대신 createElement).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { applyOp, arrowStep, currentLayout, doRedo, doUndo, drawAdd, drawBack, initEditor, select, setFloor, setTool, stepEdge } from "./editor.ts";
import { isTypingTarget, keyAction } from "./keys.ts";
import { analyze, outlineOf } from "./model.ts";
import { addOpening, moveRoomEdge, splitRoom } from "./ops.ts";
import { buildSheetRequest, localDate, planSheetInput, readPreviewResponse } from "./preview.ts";

register("./tsx-hooks.mjs", import.meta.url);
const canvas = await import("./canvas.tsx");
const panels = await import("./panels.tsx");

const DIR = import.meta.dirname;
const sources = readdirSync(DIR)
  .filter((n) => /\.(ts|tsx)$/.test(n) && !n.endsWith(".test.ts"))
  .map((n) => ({ name: n, text: readFileSync(path.join(DIR, n), "utf8") }));
const house = (DEMO_PROJECTS[0] as (typeof DEMO_PROJECTS)[number]).model;

test("소스: hex 색·px 크기·HTML 주입 없음", () => {
  assert.ok(sources.length >= 10);
  for (const { name, text } of sources) {
    const code = text.replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${name}: hex`);
    assert.doesNotMatch(code, /\d+px\b/, `${name}: px`);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/, `${name}: HTML 주입`);
  }
});

test("키 번역: 03장 6.1절 평면 편집기 단축키", () => {
  const k = (key: string, o: Partial<{ shift: boolean; ctrl: boolean; alt: boolean }> = {}) => keyAction({ key, shift: false, ctrl: false, alt: false, ...o });
  assert.deepEqual(k("r"), { t: "tool", tool: "room" });
  assert.deepEqual(k("X"), { t: "tool", tool: "split" });
  assert.deepEqual(k("j"), { t: "tool", tool: "merge" });
  assert.deepEqual(k("d"), { t: "tool", tool: "door" });
  assert.deepEqual(k("w"), { t: "tool", tool: "window" });
  assert.deepEqual(k("g"), { t: "grid" });
  assert.deepEqual(k("Enter"), { t: "enter" });
  assert.deepEqual(k("Backspace"), { t: "backspace" });
  assert.deepEqual(k("z", { ctrl: true }), { t: "undo" });
  assert.deepEqual(k("Z", { ctrl: true, shift: true }), { t: "redo" });
  assert.deepEqual(k("s", { ctrl: true }), { t: "save" });
  assert.deepEqual(k("ArrowUp", { shift: true }), { t: "arrow", ux: 0, uy: 1, shift: true, alt: false });
  assert.equal(k("q"), null);
  assert.equal(k("r", { ctrl: true }), null, "Ctrl+R은 새로고침이라 가로채지 않음");
  assert.equal(k("d", { alt: true }), null);
  assert.equal(arrowStep(false, false, true), 100);
  assert.equal(arrowStep(true, false, true), 1_000);
  assert.equal(arrowStep(false, true, false), 10);
  assert.equal(arrowStep(false, true, true), 100, "그리드 켜면 Alt 10mm 없음");
  assert.equal(isTypingTarget({ tagName: "input" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", closest: (s: string) => (s === "dialog" ? {} : null) }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON", closest: () => null }), false);
});

test("편집 상태기계: 연산·합치기·취소/다시·선택 정리·실패 알림", () => {
  let s = initEditor(house.floor_layouts, "f1");
  const l0 = currentLayout(s);
  s = select(s, { kind: "room", id: "r-living", edge: null });
  s = stepEdge(s, 1);
  assert.equal(s.sel.kind === "room" && s.sel.edge, 0);
  s = stepEdge(s, -1);
  assert.equal(s.sel.kind === "room" && s.sel.edge, 3, "처음에서 이전 변은 마지막 변으로 돈다");
  // 화살표 연타 = 한 단계
  const before = s.history.past.length;
  for (let i = 0; i < 3; i++) s = applyOp(s, (l) => moveRoomEdge(l, "r-living", 0, 0, -100), "k");
  assert.equal(s.history.past.length, before + 1);
  assert.equal(s.rev, 3);
  s = doUndo(s);
  assert.equal(currentLayout(s), l0, "한 번 취소로 연타 전체가 돌아옴");
  s = doRedo(s);
  assert.notEqual(currentLayout(s), l0);
  // 실패는 모델을 바꾸지 않고 이유를 알린다
  const rev = s.rev;
  const bad = applyOp(s, (l) => splitRoom(l, "r-living", 0, 0));
  assert.equal(bad.rev, rev);
  assert.equal(bad.notice?.tone, "warn");
  assert.equal(bad.history, s.history);
  // 문을 만든 뒤 취소하면 선택이 정리된다
  let t = select(initEditor(house.floor_layouts, "f1"), { kind: "room", id: "r-bed1", edge: 0 });
  t = applyOp(t, (l) => addOpening(l, "r-bed1", 0, "door"));
  assert.equal(t.sel.kind, "opening");
  t = doUndo(t);
  assert.equal(t.sel.kind, "none");
  // 층 바꾸기는 도구·선택·그리는 점을 비운다
  let u = setTool(initEditor(house.floor_layouts, "f1"), "room");
  u = drawAdd(drawAdd(u, [0, 0]), [1_000, 0]);
  assert.equal(u.draw.length, 2);
  assert.equal(drawBack(u).draw.length, 1);
  u = setFloor(u, "f2");
  assert.deepEqual([u.tool, u.draw.length, u.floor], ["select", 0, "f2"]);
  assert.equal(setFloor(u, "f2"), u);
});

test("도면 미리보기 요청·응답(엔진 sheet 레인, floor_plan)", () => {
  const judgment = {
    engine_version: "0.0.0",
    rule_pack_version: "2026.10.0",
    application_date: "2026-12-01",
    items: [{ key: "coverage", verdict: "NA", unit: "pct", basis: [] }],
    pending_changes: 0,
  } as unknown as Parameters<typeof planSheetInput>[1];
  const input = planSheetInput(house, judgment, "f1", "시험", "2026-10-29");
  assert.equal(input.sheet.kind, "floor_plan");
  assert.equal(input.sheet.floor_id, "f1");
  assert.deepEqual(planSheetInput(house, judgment, "f1", "시험", "2026-10-29"), input, "결정적");
  const req = buildSheetRequest("r1", 3, input);
  assert.deepEqual([req.op, req.lane, req.seq], ["build_sheet", "sheet", 3]);
  assert.equal(readPreviewResponse({ req_id: "r1", ok: true, result: { svg_preview: "<svg/>" } }, "r1").kind, "ok");
  assert.equal(readPreviewResponse({ req_id: "r1", ok: true, result: { svg_preview: "<script>" } }, "r1").kind, "error");
  assert.equal(readPreviewResponse({ req_id: "other", ok: true, result: {} }, "r1").kind, "ignore");
  assert.equal(readPreviewResponse({ req_id: "r1", status: "superseded" }, "r1").kind, "superseded");
  const e = readPreviewResponse({ req_id: "r1", ok: false, code: "AR051", detail: "x" }, "r1");
  assert.deepEqual(e, { kind: "error", code: "AR051" });
  assert.equal(localDate(new Date(2026, 9, 5)), "2026-10-05");
});

test("서버 렌더: 캔버스·실 목록·검사 줄·속성(문구·접근성·이스케이프)", () => {
  const layout = currentLayout(initEditor(house.floor_layouts, "f1"));
  const outline = outlineOf(house, "f1");
  const a = analyze(house, "f1", outline, layout);
  const noop = () => undefined;
  const svg = renderToStaticMarkup(
    h(canvas.PlanCanvas, {
      outline,
      layout,
      analysis: a,
      sel: { kind: "room", id: "r-living", edge: 0 },
      tool: "select",
      draw: [],
      cursor: [0, 0],
      grid: 100,
      edit: true,
      label: "1층 평면 2D 보기",
      onPick: noop,
      onDrawPoint: noop,
      onPlace: noop,
      onSplitAt: noop,
      onMergeWith: noop,
      onDragStart: noop,
      onDragEdge: noop,
    }),
  );
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="1층 평면 2D 보기"/);
  assert.match(svg, /거실/);
  assert.match(svg, /data-edge="0"/, "선택한 실의 변 끌기 손잡이");
  assert.doesNotMatch(svg, /<script/);
  const actions = new Proxy({}, { get: () => noop }) as unknown as import("./panels.tsx").PlanActions;
  const list = renderToStaticMarkup(h(panels.RoomList, { layout, analysis: a, sel: { kind: "none" }, edit: true, actions, mergeMode: false }));
  assert.match(list, /실 목록/);
  assert.match(list, /차이 [+-]?\d/, "목표 차이는 부호와 글자로");
  assert.match(list, /aria-label="침실 3 놓기"/, "면적표에만 있는 실은 놓기 버튼");
  const readOnly = renderToStaticMarkup(h(panels.RoomList, { layout, analysis: a, sel: { kind: "none" }, edit: false, actions, mergeMode: false }));
  assert.match(readOnly, /disabled/);
  // 오류 있는 배치는 문구·저장 불가 이유
  const broken = { ...layout, rooms: layout.rooms.map((r, i) => (i === 0 ? { ...r, name: "<b>x</b>", polygon: { outer: [[0, 0], [90_000, 0], [90_000, 9_000], [0, 9_000]] as [number, number][] } } : r)) };
  const ab = analyze(house, "f1", outline, broken);
  assert.ok(ab.issues.length > 0);
  const bar = renderToStaticMarkup(h(panels.CheckBar, { layout: broken, analysis: ab, blocker: "저장 불가(AR051): 오류 1건을 고친 뒤 저장하세요.", onPick: noop }));
  assert.match(bar, /AR051/);
  assert.match(bar, /&lt;b&gt;x&lt;\/b&gt;/, "실 이름은 이스케이프");
  assert.doesNotMatch(bar, /<b>x<\/b>/);
  const ins = renderToStaticMarkup(h(panels.Inspector, { layout, analysis: a, sel: { kind: "room", id: "r-living", edge: 0 }, tool: "select", draw: [], cursor: [0, 0], edit: true, actions }));
  assert.match(ins, /외벽 200 · 내벽 100/);
  assert.match(ins, /문 놓기 \(D\)/);
  assert.match(ins, /id="plan-name-r-living"/);
  const drawing = renderToStaticMarkup(h(panels.Inspector, { layout, analysis: a, sel: { kind: "none" }, tool: "room", draw: [], cursor: [100, 200], edit: true, actions }));
  assert.match(drawing, /Backspace/);
});
