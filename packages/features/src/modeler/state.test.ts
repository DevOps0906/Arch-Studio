// 모델러 상태 테스트(AR-06-036): 명령(순수·구조 공유·검사), 이력 100단계, 리듀서(드래그·그리기·잠금 이중 차단), 권한, 단축키.
import assert from "node:assert/strict";
import { test } from "node:test";
import { designModelV1Schema, type DesignModelV1 } from "@arch-studio/domain";
import { DEMO_PROJECTS } from "../demo/index.ts";
import { EXPIRED_TEXT, NARROW_TEXT, modelerAccess } from "./state/access.ts";
import {
  LIMITS,
  addMass,
  deleteMass,
  footprintIssue,
  moveMass,
  nextMassId,
  rectOuter,
  setBaseLevel,
  setFloorCount,
  setFloorHeight,
  setFloorUse,
  setRoof,
  snapMm,
  uniformFloorHeight,
  type Model,
} from "./state/commands.ts";
import { HISTORY_LIMIT, canRedo, canUndo, createHistory, pushHistory, redo, undo } from "./state/history.ts";
import { createModelerState, isDirty, modelerReducer, previewModel, type Action, type ModelerState } from "./state/store.ts";
import { isTypingTarget, keyAction, nudgeStep, type KeyContext } from "./tools/keymap.ts";

const house = DEMO_PROJECTS[0]?.model as DesignModelV1;
const multi = DEMO_PROJECTS[2]?.model as DesignModelV1;
const valid = (m: Model) => assert.equal(designModelV1Schema.safeParse(m).success, true, JSON.stringify(designModelV1Schema.safeParse(m).error?.issues?.[0]));
const must = (r: ReturnType<typeof addMass>) => {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.ok ? r.model : (undefined as never);
};

test("addMass: 새 id m-<n>(결정적), 층 id 겹침 없음, 외곽 반시계 정리, 기본 용도 = 첫 매스 용도, 스키마 통과", () => {
  const cw = [...rectOuter(1000, 1000, 4000, 3000)].reverse();
  const r = addMass(house, { outer: cw, floors: 3, floorHeight: 2800 });
  const m = must(r);
  valid(m);
  assert.equal(r.ok && r.select, "m-1");
  const added = m.masses[1];
  assert.equal(added?.id, "m-1");
  assert.deepEqual(added?.floors.map((f) => [f.id, f.level, f.height_mm, f.use]), [
    ["m-1-f1", 1, 2800, "단독주택"],
    ["m-1-f2", 2, 2800, "단독주택"],
    ["m-1-f3", 3, 2800, "단독주택"],
  ]);
  // 외곽 반시계(면적 부호 양수)
  const o = added?.footprint.outer ?? [];
  let a2 = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i] as [number, number];
    const q = o[(i + 1) % o.length] as [number, number];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  assert.ok(a2 > 0);
  // 구조 공유: 기존 매스·대지는 같은 참조
  assert.equal(m.masses[0], house.masses[0]);
  assert.equal(m.site, house.site);
  assert.equal(nextMassId(m), "m-2");
  // 같은 입력 → 같은 결과(결정성)
  assert.deepEqual(must(addMass(house, { outer: cw, floors: 3, floorHeight: 2800 })), m);
});

test("addMass·footprintIssue: 잘못된 입력은 throw 없이 이유 문구", () => {
  assert.match(footprintIssue([[0, 0], [10, 0]]) ?? "", /3개/);
  assert.match(footprintIssue([[0, 0], [10, 0], [20, 0]]) ?? "", /면적이 0/);
  assert.match(footprintIssue([[0, 0], [20, 10], [20, 0], [0, 30]]) ?? "", /교차/);
  assert.match(footprintIssue([[0, 0], [10.5, 0], [0, 10]]) ?? "", /정수/);
  assert.match(footprintIssue([[0, 0], [20_000_000, 0], [0, 10]]) ?? "", /10km/);
  const r1 = addMass(house, { outer: rectOuter(0, 0, 1000, 1000), floors: 0, floorHeight: 3000 });
  assert.equal(r1.ok, false);
  const r2 = addMass(house, { outer: rectOuter(0, 0, 1000, 1000), floors: 2, floorHeight: 900 });
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.reason, /층고/);
});

test("moveMass: 정수 이동, 0이면 같은 참조, 범위 밖 거부, 다른 매스·평면 참조 유지", () => {
  const r = moveMass(house, "m-house", 500, -200);
  assert.ok(r.ok);
  const m = r.ok ? r.model : house;
  valid(m);
  assert.deepEqual(m.masses[0]?.footprint.outer[0], [4500, 4800]);
  assert.equal(m.floor_layouts, house.floor_layouts);
  const same = moveMass(house, "m-house", 0, 0);
  assert.equal(same.ok && same.model, house);
  assert.equal(moveMass(house, "m-house", 1.5, 0).ok, false);
  assert.equal(moveMass(house, "m-house", 20_000_000, 0).ok, false);
  assert.equal(moveMass(house, "nope", 1, 0).ok, false);
});

test("setFloorCount: 늘리면 맨 위 층 복사, 줄이면 위층과 그 평면을 지운다", () => {
  const up = setFloorCount(house, "m-house", 4);
  assert.ok(up.ok);
  const m4 = up.ok ? up.model : house;
  valid(m4);
  assert.deepEqual(m4.masses[0]?.floors.map((f) => [f.level, f.height_mm]), [
    [1, 3300],
    [2, 3000],
    [3, 3000],
    [4, 3000],
  ]);
  const down = setFloorCount(house, "m-house", 1);
  assert.ok(down.ok);
  const m1 = down.ok ? down.model : house;
  valid(m1);
  assert.deepEqual(m1.masses[0]?.floors.map((f) => f.id), ["f1"]);
  assert.deepEqual(m1.floor_layouts.map((l) => l.floor_id), ["f1"]);
  assert.equal(setFloorCount(house, "m-house", 2).ok && (setFloorCount(house, "m-house", 2) as { model: Model }).model, house);
  assert.equal(setFloorCount(house, "m-house", LIMITS.floors + 1).ok, false);
});

test("층고·용도·바닥 높이·지붕: 바뀐 것만 새 객체, 같으면 같은 참조", () => {
  const h = setFloorHeight(house, "m-house", null, 3100);
  assert.ok(h.ok);
  assert.equal(uniformFloorHeight((h as { model: Model }).model.masses[0]!), 3100);
  assert.equal(uniformFloorHeight(house.masses[0]!), null);
  const one = setFloorHeight(house, "m-house", "f2", 3300);
  assert.equal(uniformFloorHeight((one as { model: Model }).model.masses[0]!), 3300);
  assert.equal(setFloorHeight(house, "m-house", "zz", 3300).ok, false);
  const u = setFloorUse(house, "m-house", null, "  다가구주택 ");
  assert.deepEqual((u as { model: Model }).model.masses[0]?.floors.map((f) => f.use), ["다가구주택", "다가구주택"]);
  assert.equal(setFloorUse(house, "m-house", null, "   ").ok, false);
  assert.equal(setFloorUse(house, "m-house", null, "가".repeat(41)).ok, false);
  const b = setBaseLevel(house, "m-house", 600);
  assert.equal((b as { model: Model }).model.masses[0]?.base_level_mm, 600);
  assert.equal(setBaseLevel(house, "m-house", 99_999).ok, false);
  const flat = setRoof(house, "m-house", "flat");
  assert.deepEqual((flat as { model: Model }).model.masses[0]?.roof, { type: "flat" });
  const keepPitch = setRoof(house, "m-house", "hip");
  assert.deepEqual((keepPitch as { model: Model }).model.masses[0]?.roof, { type: "hip", pitch: 0.4 });
  assert.equal(setRoof(house, "m-house", "gable", 3).ok, false);
  const same = setRoof(house, "m-house", "gable", 0.4);
  assert.equal(same.ok && same.model, house);
  for (const r of [h, one, u, b, flat, keepPitch]) valid((r as { model: Model }).model);
});

test("deleteMass: 매스와 그 층 평면을 지우고 선택 해제", () => {
  const r = deleteMass(house, "m-house");
  assert.ok(r.ok);
  assert.equal(r.ok && r.select, null);
  const m = r.ok ? r.model : house;
  assert.equal(m.masses.length, 0);
  assert.equal(m.floor_layouts.length, 0);
  valid(m);
});

test("snapMm: 0에서 먼 쪽 반올림 격자", () => {
  assert.equal(snapMm(149, 100), 100);
  assert.equal(snapMm(150, 100), 200);
  assert.equal(snapMm(-150, 100), -200);
  assert.equal(snapMm(12.5, 1), 13);
  assert.equal(snapMm(-12.5, 1), -13);
});

test("이력: 100단계 상한(앞에서 버림), 실행 취소·다시 실행 라벨, 새 명령은 다시 실행 목록을 비운다", () => {
  let h = createHistory(house);
  let model = house;
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
    const r = moveMass(model, "m-house", 10, 0);
    model = r.ok ? r.model : model;
    h = pushHistory(h, model, "매스 이동");
  }
  assert.equal(h.past.length, HISTORY_LIMIT);
  let undone = 0;
  while (canUndo(h)) {
    const u = undo(h);
    assert.equal(u.label, "매스 이동");
    h = u.history;
    undone++;
  }
  assert.equal(undone, HISTORY_LIMIT);
  assert.deepEqual(h.present.masses[0]?.footprint.outer[0], [4000 + 20 * 10, 5000], "가장 오래된 20단계는 버려졌다");
  const r = redo(h);
  assert.equal(r.label, "매스 이동");
  assert.ok(canRedo(r.history));
  const pushed = pushHistory(r.history, house, "새 명령");
  assert.equal(canRedo(pushed), false);
  assert.equal(pushHistory(pushed, pushed.present, "같음"), pushed, "같은 참조는 쌓지 않는다");
  assert.equal(undo(createHistory(house)).label, null);
});

test("이력 구조 공유: 매스 50개 모델에서 매스 1개 100단계 이동 — 움직이지 않은 매스는 모든 단계에서 같은 참조", () => {
  let model: Model = { ...multi, masses: [] };
  for (let i = 0; i < 50; i++) model = must(addMass(model, { outer: rectOuter((i % 10) * 2000, Math.floor(i / 10) * 2000, 1500, 1500), floors: 3, floorHeight: 3000 }));
  let h = createHistory(model);
  for (let i = 0; i < 100; i++) {
    const r = moveMass(h.present, "m-1", 10, 0);
    h = pushHistory(h, r.ok ? r.model : h.present, "매스 이동");
  }
  for (const e of h.past) for (let i = 1; i < 50; i++) assert.equal(e.model.masses[i], model.masses[i]);
});

const editable = () => createModelerState(house);
const run = (s: ModelerState, ...as: Action[]) => as.reduce(modelerReducer, s);

test("리듀서: 명령 → 이력 + 알림, 실행 취소로 저장 상태 복귀(dirty 해제), 실패 명령은 경고만", () => {
  let s = editable();
  assert.equal(s.selection, "m-house");
  s = run(s, { type: "command", command: { type: "floors", id: "m-house", count: 3 } });
  assert.equal(isDirty(s), true);
  assert.equal(s.notice?.text, "층 수 변경했습니다.");
  s = run(s, { type: "undo" });
  assert.equal(isDirty(s), false);
  assert.equal(s.notice?.text, "실행 취소: 층 수 변경");
  s = run(s, { type: "redo" });
  assert.equal(s.notice?.text, "다시 실행: 층 수 변경");
  const before = s.history;
  s = run(s, { type: "command", command: { type: "floors", id: "m-house", count: 0 } });
  assert.equal(s.history, before);
  assert.equal(s.notice?.tone, "warn");
  s = run(s, { type: "saved", model: s.history.present });
  assert.equal(isDirty(s), false);
});

test("리듀서: 드래그는 모델을 바꾸지 않고 오프셋만, 놓으면 이동 명령 1개, 0 이동·취소는 기록 없음", () => {
  let s = run(editable(), { type: "dragStart", id: "m-house" }, { type: "dragMove", dx: 300, dy: 0 }, { type: "dragMove", dx: 600, dy: 100 });
  assert.equal(s.history.present, house);
  assert.deepEqual(s.drag, { id: "m-house", dx: 600, dy: 100 });
  assert.deepEqual(previewModel(s).masses[0]?.footprint.outer[0], [4600, 5100]);
  s = run(s, { type: "dragEnd" });
  assert.equal(s.drag, null);
  assert.equal(s.history.past.length, 1);
  assert.deepEqual(s.history.present.masses[0]?.footprint.outer[0], [4600, 5100]);
  const z = run(editable(), { type: "dragStart", id: "m-house" }, { type: "dragEnd" });
  assert.equal(z.history.past.length, 0);
  const c = run(editable(), { type: "dragStart", id: "m-house" }, { type: "dragMove", dx: 5, dy: 5 }, { type: "dragCancel" });
  assert.equal(c.history.past.length, 0);
  assert.equal(previewModel(c), house);
});

test("리듀서: 그리기 도구 — 점 찍기·중복 무시·되돌리기·3점 미만 거부·닫으면 매스 추가 후 선택 도구", () => {
  let s = run(editable(), { type: "tool", tool: "draw" }, { type: "draftDefaults", floors: 4, floorHeight: 2900 });
  s = run(s, { type: "draftPoint", point: [0, 0] }, { type: "draftPoint", point: [0, 0] }, { type: "draftPoint", point: [3000, 0] });
  assert.equal(s.draft.length, 2);
  s = run(s, { type: "draftClose" });
  assert.equal(s.notice?.tone, "warn");
  s = run(s, { type: "draftPoint", point: [3000, 3000] }, { type: "draftPoint", point: [9, 9] }, { type: "draftPop" }, { type: "draftPoint", point: [0, 3000] }, { type: "draftClose" });
  assert.equal(s.tool, "select");
  assert.equal(s.draft.length, 0);
  assert.equal(s.selection, "m-1");
  assert.equal(s.history.present.masses[1]?.floors.length, 4);
  assert.equal(s.history.present.masses[1]?.floors[0]?.height_mm, 2900);
  // 자기교차 바닥은 거부하고 점은 남긴다
  let t = run(editable(), { type: "tool", tool: "draw" });
  t = run(t, ...([[0, 0], [20, 10], [20, 0], [0, 30]] as [number, number][]).map((p): Action => ({ type: "draftPoint", point: p })), { type: "draftClose" });
  assert.equal(t.draft.length, 4);
  assert.match(t.notice?.text ?? "", /교차/);
});

test("잠금 이중 차단: 열람이면 명령·실행 취소·그리기·드래그를 리듀서가 거부하고 이유를 알린다(보기 동작은 된다)", () => {
  let s = createModelerState(house, { editable: false, reason: EXPIRED_TEXT });
  const actions: Action[] = [
    { type: "command", command: { type: "delete", id: "m-house" } },
    { type: "undo" },
    { type: "redo" },
    { type: "tool", tool: "draw" },
    { type: "draftPoint", point: [0, 0] },
    { type: "draftClose" },
    { type: "dragStart", id: "m-house" },
  ];
  for (const a of actions) {
    const next = modelerReducer(s, a);
    assert.equal(next.history, s.history, a.type);
    assert.equal(next.tool, "select");
    assert.equal(next.drag, null);
    assert.equal(next.notice?.text, EXPIRED_TEXT);
    s = next;
  }
  s = run(s, { type: "select", id: null }, { type: "camera", mode: "plan" }, { type: "toggleLayer", layer: "envelope" });
  assert.equal(s.selection, null);
  assert.equal(s.camera, "plan");
  assert.deepEqual(s.hidden, ["envelope"]);
  // 편집 중 잠기면 그리기·드래그를 끊는다
  const drawing = run(editable(), { type: "tool", tool: "draw" }, { type: "draftPoint", point: [0, 0] }, { type: "access", editable: false, reason: null });
  assert.equal(drawing.tool, "select");
  assert.equal(drawing.draft.length, 0);
  assert.match(drawing.lockReason ?? "", /열람 모드/);
});

test("리듀서: 선택은 있는 매스만, 실행 취소로 매스가 사라지면 선택 해제, reset은 이력·선택을 새로", () => {
  let s = run(editable(), { type: "select", id: "zz" });
  assert.equal(s.selection, null);
  s = run(s, { type: "tool", tool: "draw" }, ...rectOuter(0, 0, 2000, 2000).map((p): Action => ({ type: "draftPoint", point: p })), { type: "draftClose" });
  assert.equal(s.selection, "m-1");
  s = run(s, { type: "undo" });
  assert.equal(s.selection, null);
  const r = run(s, { type: "toggleLayer", layer: "site" }, { type: "reset", model: multi });
  assert.equal(r.history.past.length, 0);
  assert.equal(r.saved, multi);
  assert.deepEqual(r.hidden, ["site"]);
});

test("권한: 판정 전·거부(만료 문구)·좁은 화면은 편집 불가, 허용 + 넓은 화면만 편집", () => {
  assert.deepEqual(modelerAccess(undefined, true).kind, "pending");
  assert.equal(modelerAccess(undefined, true).editable, false);
  const exp = modelerAccess({ allowed: false, reason: "expired" }, true);
  assert.equal(exp.editable, false);
  assert.equal(exp.reason, EXPIRED_TEXT);
  assert.equal(modelerAccess({ allowed: false, reason: "fallback" }, true).kind, "entitlement");
  assert.equal(modelerAccess({ allowed: true }, false).reason, NARROW_TEXT);
  assert.equal(modelerAccess({ allowed: true }, true).editable, true);
});

const ctx = (p: Partial<KeyContext> = {}): KeyContext => ({ tool: "select", drawing: false, hasSelection: true, typing: false, ...p });
const k = (key: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ key, ctrl: !!m.ctrl, shift: !!m.shift, alt: !!m.alt });

test("단축키(6.1절): 도구·뷰·실행 취소·이동량·입력칸 무시·그리기 중 Enter/Backspace", () => {
  assert.deepEqual(keyAction(k("z", { ctrl: true }), ctx()), { type: "undo" });
  assert.deepEqual(keyAction(k("Z", { ctrl: true, shift: true }), ctx()), { type: "redo" });
  assert.deepEqual(keyAction(k("y", { ctrl: true }), ctx({ typing: true })), { type: "redo" });
  assert.deepEqual(keyAction(k("s", { ctrl: true }), ctx()), { type: "save" });
  assert.deepEqual(keyAction(k("V"), ctx()), { type: "tool", tool: "select" });
  assert.deepEqual(keyAction(k("m"), ctx()), { type: "tool", tool: "draw" });
  assert.deepEqual(keyAction(k("e"), ctx()), { type: "extrude" });
  assert.equal(keyAction(k("e"), ctx({ hasSelection: false })), null);
  assert.deepEqual(keyAction(k("d"), ctx()), { type: "tool", tool: "measure" });
  assert.deepEqual(keyAction(k("S"), ctx()), { type: "tool", tool: "section" });
  assert.deepEqual(keyAction(k("Delete"), ctx({ tool: "measure" })), { type: "measurePop" }, "측정 중 Delete는 매스가 아니라 마지막 측정");
  assert.deepEqual(keyAction(k("Backspace"), ctx({ tool: "measure" })), { type: "measurePop" });
  assert.deepEqual(keyAction(k("Escape"), ctx({ tool: "section" })), { type: "escape" });
  assert.deepEqual(keyAction(k("h"), ctx()), { type: "toggleEnvelope" });
  assert.deepEqual(keyAction(k("3"), ctx()), { type: "camera", mode: "section" });
  assert.deepEqual(keyAction(k("Delete"), ctx()), { type: "delete" });
  assert.deepEqual(keyAction(k("ArrowUp", { shift: true }), ctx()), { type: "nudge", dx: 0, dy: 1000 });
  assert.deepEqual(keyAction(k("ArrowLeft", { alt: true }), ctx()), { type: "nudge", dx: -10, dy: 0 });
  assert.equal(keyAction(k("ArrowLeft"), ctx({ hasSelection: false })), null);
  assert.equal(keyAction(k("ArrowLeft", { ctrl: true }), ctx())?.type, "orbit");
  assert.equal(keyAction(k("m"), ctx({ typing: true })), null);
  assert.deepEqual(keyAction(k("Enter"), ctx({ tool: "draw", drawing: true })), { type: "draftClose" });
  assert.deepEqual(keyAction(k("Backspace"), ctx({ tool: "draw", drawing: true })), { type: "draftPop" });
  assert.deepEqual(keyAction(k("Escape"), ctx()), { type: "escape" });
  assert.equal(nudgeStep({ shift: false, alt: false }), 100);
  assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
  assert.equal(isTypingTarget({ tagName: "DIV", getAttribute: () => "spinbutton" }), true);
  assert.equal(isTypingTarget({ tagName: "BUTTON", getAttribute: () => null }), false);
});
