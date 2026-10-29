// 평면 편집 연산·이력·접근·표시 문구 테스트(순수 로직). 검사 결과는 @arch-studio/layout이 정한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesignModelV1 } from "@arch-studio/domain";
import { designModelV1Schema } from "@arch-studio/domain";
import { validateLayout, type FloorLayout } from "@arch-studio/layout";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { plansAccess } from "./access.ts";
import { diffText, m2Text, percentText, signedM2Text } from "./format.ts";
import { HISTORY_LIMIT, canRedo, canUndo, commit, createHistory, redo, undo } from "./history.ts";
import { analyze, findSlot, floorsOf, issueText, layoutOfFloor, outlineOf, parseDesignModel, parseMm, saveBlocker, withFloorLayout } from "./model.ts";
import { addOpening, drawRoom, mergeRooms, moveRoomEdge, rectPolygon, removeOpening, removeRoom, renameRoom, slideOpening, snapMm, splitRoom, updateOpening, type OpResult } from "./ops.ts";

const house = (DEMO_PROJECTS[0] as (typeof DEMO_PROJECTS)[number]).model;
const FLOOR = "f1";

function expectOk(r: OpResult): FloorLayout {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r.layout;
}

/** 외곽 10m × 6m 한 층(매스 f1)과 빈 배치. */
function box(): { model: DesignModelV1; layout: FloorLayout } {
  const model: DesignModelV1 = {
    ...house,
    masses: [{ id: "m1", footprint: rectPolygon(0, 0, 10_000, 6_000), base_level_mm: 0, floors: [{ id: FLOOR, level: 1, height_mm: 3_000, use: "단독주택" }], roof: { type: "flat" } }],
    floor_layouts: [{ floor_id: FLOOR, rooms: [{ id: "a", name: "거실", use: "거실", polygon: rectPolygon(0, 0, 10_000, 6_000) }], openings: [] }],
    program: { checklist_answers: {}, targets: [{ name: "거실", use: "거실", target_area_m2: 62 }, { name: "안방", use: "침실", target_area_m2: 12 }], user_locked_rows: [] },
  };
  return { model, layout: model.floor_layouts[0] as FloorLayout };
}

const issues = (model: DesignModelV1, l: FloorLayout) => validateLayout({ ...model, floor_layouts: [l] }, FLOOR).errors;

test("데모 모델: 층 목록과 기존 배치는 AR051이 없다", () => {
  const fs = floorsOf(house);
  assert.deepEqual(fs.map((f) => f.id), ["f1", "f2"]);
  assert.equal(fs[0]?.label, "1층");
  for (const f of fs) {
    const a = analyze(house, f.id, outlineOf(house, f.id), layoutOfFloor(house.floor_layouts, f.id));
    assert.equal(a.issues.length, 0, `${f.id}: ${a.issues.map((i) => i.detail).join(";")}`);
  }
});

test("그리기: 사각형 닫기·꼭짓점 3개 미만 거부·id 유일", () => {
  const { layout } = box();
  const empty: FloorLayout = { ...layout, rooms: [] };
  const l1 = expectOk(drawRoom(empty, [[0, 0], [4_000, 0], [4_000, 3_000], [0, 3_000]], "안방", "침실"));
  assert.equal(l1.rooms.length, 1);
  const l2 = expectOk(drawRoom(l1, [[4_000, 0], [8_000, 0], [8_000, 3_000]], "", ""));
  assert.notEqual(l2.rooms[0]?.id, l2.rooms[1]?.id);
  assert.equal(l2.rooms[1]?.name, "새 실");
  const bad = drawRoom(l1, [[0, 0], [1_000, 0]], "x", "y");
  assert.equal(bad.ok, false);
  const cross = drawRoom(l1, [[0, 0], [2_000, 2_000], [2_000, 0], [0, 2_000]], "x", "y");
  assert.equal(cross.ok, false);
  assert.equal(l1, l1); // 불변: 입력은 바뀌지 않음
  assert.equal(empty.rooms.length, 0);
});

test("분할: 면적 합 유지·문 따라감·분할선에 걸린 문 삭제", () => {
  const { model, layout } = box();
  const withDoor = expectOk(addOpening(layout, "a", 0, "door"));
  const door = withDoor.openings[0];
  assert.equal(door?.offset_mm, 4_600); // 중앙 (10000-900)/2 = 4550 → 그리드 half-away 4600
  const r = splitRoom(withDoor, "a", 0, 6_000);
  const l = expectOk(r);
  assert.equal(l.rooms.length, 2);
  assert.equal(issues(model, l).length, 0);
  const a = analyze(model, FLOOR, outlineOf(model, FLOOR), l);
  assert.equal(a.totalH100, 6_000, "면적 합 60.00㎡ 유지");
  assert.equal(l.openings.length, 1);
  assert.equal(l.openings[0]?.host.room_id, "a", "문은 6000 왼쪽(앞 조각)에 남는다");
  // 문 구간(4600~5500)을 가로지르는 5000에서 자르면 문이 지워진다
  const cut = splitRoom(withDoor, "a", 0, 5_000);
  assert.ok(cut.ok);
  if (cut.ok) {
    assert.equal(cut.layout.openings.length, 0);
    assert.match(cut.notice ?? "", /문·창 1개/);
  }
  assert.equal(splitRoom(layout, "a", 0, 0).ok, false, "가장자리 위 분할은 둘로 나뉘지 않음");
  assert.equal(splitRoom(layout, "a", 1, 20_000).ok, false);
});

test("병합: 맞닿은 두 실 → 한 실, 맞닿지 않으면 거부, 면적 보존", () => {
  const { model, layout } = box();
  const split = expectOk(splitRoom(layout, "a", 1, 3_000));
  const [p, q] = split.rooms;
  assert.ok(p && q);
  const merged = expectOk(mergeRooms(split, p.id, q.id));
  assert.equal(merged.rooms.length, 1);
  assert.equal(merged.rooms[0]?.polygon.outer.length, 4, "일직선 꼭짓점은 정리됨");
  assert.equal(analyze(model, FLOOR, outlineOf(model, FLOOR), merged).totalH100, 6_000);
  const apart: FloorLayout = {
    ...layout,
    rooms: [
      { id: "a", name: "A", use: "x", polygon: rectPolygon(0, 0, 2_000, 2_000) },
      { id: "b", name: "B", use: "x", polygon: rectPolygon(5_000, 0, 2_000, 2_000) },
    ],
  };
  assert.equal(mergeRooms(apart, "a", "b").ok, false);
  assert.equal(mergeRooms(apart, "a", "a").ok, false);
});

test("경계 이동: 수직 방향만, 공유 벽은 함께, 겹치면 AR051", () => {
  const { model, layout } = box();
  const split = expectOk(splitRoom(layout, "a", 0, 5_000));
  // a: 왼쪽 조각. 오른쪽 변(edge 1)이 공유 벽.
  const a = split.rooms.find((r) => r.id === "a");
  assert.ok(a);
  const shared = a.polygon.outer.findIndex((p, i) => p[0] === 5_000 && (a.polygon.outer[(i + 1) % a.polygon.outer.length] as number[])[0] === 5_000);
  assert.ok(shared >= 0);
  const moved = expectOk(moveRoomEdge(split, "a", shared, 1_000, 700));
  assert.equal(issues(model, moved).length, 0, "공유 벽을 같이 옮기면 겹치지 않는다");
  const aa = analyze(model, FLOOR, outlineOf(model, FLOOR), moved);
  assert.equal(aa.totalH100, 6_000, "면적 합 유지");
  assert.equal(aa.rows.get("a")?.area_h100, 3_600);
  const tangent = moveRoomEdge(split, "a", shared, 0, 500);
  assert.equal(tangent.ok, false, "수직 변은 가로 방향만");
  // 한쪽만 옮기면 겹침
  const onlyOne = expectOk(moveRoomEdge({ ...split, rooms: split.rooms.map((r) => (r.id === "a" ? r : { ...r, polygon: rectPolygon(5_000, 0, 5_000, 5_000) })) }, "a", shared, 1_000, 0));
  const found = issues(model, onlyOne);
  assert.ok(found.some((i) => i.kind === "overlap"));
  assert.equal(snapMm(1_049), 1_000);
  assert.equal(snapMm(1_050), 1_100);
});

test("외곽 밖·겹침 문구와 저장 차단", () => {
  const { model, layout } = box();
  const out: FloorLayout = { ...layout, rooms: [{ id: "a", name: "거실", use: "거실", polygon: rectPolygon(0, 0, 12_000, 6_000) }] };
  const a = analyze(model, FLOOR, outlineOf(model, FLOOR), out);
  assert.equal(a.issues[0]?.kind, "outside");
  assert.match(issueText(a.issues[0] as NonNullable<(typeof a.issues)[number]>, out), /층 외곽 밖/);
  assert.match(saveBlocker(a) ?? "", /AR051/);
  assert.equal(saveBlocker(analyze(model, FLOOR, outlineOf(model, FLOOR), layout)), null);
});

test("문·창: 중앙 배치·겹침 회피·이동 범위·삭제·방향", () => {
  const { model, layout } = box();
  const l1 = expectOk(addOpening(layout, "a", 0, "door"));
  const l2 = expectOk(addOpening(l1, "a", 0, "window", 2_000));
  const [d, w] = l2.openings;
  assert.ok(d && w);
  assert.ok(d.offset_mm + d.width_mm <= w.offset_mm || w.offset_mm + w.width_mm <= d.offset_mm, "겹치지 않게 비껴 놓음");
  assert.equal(issues(model, l2).length, 0);
  const slid = expectOk(slideOpening(l2, d.id, 100_000));
  assert.equal(slid.openings.find((o) => o.id === d.id)?.offset_mm, 10_000 - 900 - 0 > 0 ? 10_000 - 900 : 0, "끝에서 멈춤(창이 비켜 있으면 겹침 검사는 AR051이 한다)");
  assert.equal(slideOpening(slid, d.id, 100).ok, false, "이미 끝");
  const swung = expectOk(updateOpening(l2, d.id, { swing: "right" }));
  assert.equal(swung.openings.find((o) => o.id === d.id)?.swing, "right");
  assert.equal(updateOpening(l2, d.id, { width_mm: 0 }).ok, false);
  assert.equal(addOpening(layout, "zz", 0, "door").ok, false);
  assert.equal(addOpening(layout, "a", 9, "door").ok, false);
  const gone = expectOk(removeOpening(l2, d.id));
  assert.equal(gone.openings.length, 1);
  const noRoom = expectOk(removeRoom(l2, "a"));
  assert.equal(noRoom.openings.length, 0);
  // 범위 밖으로 직접 지정하면 layout이 AR051(opening)로 알린다
  const far = expectOk(updateOpening(l2, d.id, { offset_mm: 9_800 }));
  assert.ok(issues(model, far).some((i) => i.kind === "opening"));
});

test("이름·용도 변경과 목표 차이(부호 글자)", () => {
  const { model, layout } = box();
  assert.equal(renameRoom(layout, "a", " ", "x").ok, false);
  assert.equal(renameRoom(layout, "a", "가".repeat(61), "x").ok, false);
  const same = renameRoom(layout, "a", "거실", "거실");
  assert.ok(same.ok && same.layout === layout, "바뀐 것이 없으면 같은 객체");
  const l = expectOk(renameRoom(layout, "a", "안방", "침실"));
  const a = analyze(model, FLOOR, outlineOf(model, FLOOR), l);
  assert.equal(a.rows.get("a")?.diff_h100, 4_800, "목표 12㎡ 대비 60㎡");
  assert.deepEqual(a.unplaced.map((t) => t.name), ["거실"]);
  assert.equal(diffText(-180, 3_800), "-1.80㎡(-4.7%)");
  assert.equal(diffText(40, 1_800), "+0.40㎡(+2.2%)");
  assert.equal(diffText(0, 1_800), "0.00㎡(0.0%)");
  assert.equal(m2Text(123_456), "1,234.56");
  assert.equal(signedM2Text(-5), "-0.05");
  assert.equal(percentText(10, 0), null);
});

test("미배치 실 놓기: 결정적·겹침 없음·자리가 없으면 null", () => {
  const { model, layout } = box();
  const half = expectOk(splitRoom(layout, "a", 0, 5_000));
  const trimmed: FloorLayout = { ...half, rooms: half.rooms.filter((r) => r.id === "a") };
  const out = outlineOf(model, FLOOR);
  const slot = findSlot(FLOOR, out, trimmed, 12, "new");
  assert.ok(slot);
  assert.deepEqual(findSlot(FLOOR, out, trimmed, 12, "new"), slot, "같은 입력 → 같은 자리");
  const placed = expectOk(drawRoom(trimmed, slot.outer, "안방", "침실"));
  assert.equal(issues(model, placed).length, 0);
  assert.equal(findSlot(FLOOR, out, layout, 12, "new"), null, "꽉 찬 층");
  assert.equal(findSlot(FLOOR, out, trimmed, 0, "new"), null);
});

test("층 배치 교체: 없던 층은 실이 생길 때만 덧붙임", () => {
  const { model, layout } = box();
  assert.equal(withFloorLayout(model.floor_layouts, { floor_id: "zz", rooms: [], openings: [] }), model.floor_layouts);
  const added = withFloorLayout(model.floor_layouts, { ...layout, floor_id: "zz" });
  assert.equal(added.length, 2);
  const replaced = withFloorLayout(model.floor_layouts, { ...layout, rooms: [] });
  assert.equal(replaced[0]?.rooms.length, 0);
});

test("저장용 모델은 스키마를 통과하고 직렬화가 결정적이다", () => {
  const { model, layout } = box();
  const l = expectOk(splitRoom(layout, "a", 0, 5_000));
  const next = { ...model, floor_layouts: [l] };
  assert.ok(designModelV1Schema.safeParse(next).success);
  assert.equal(JSON.stringify(next), JSON.stringify(parseDesignModel(JSON.stringify(next)).ok ? next : null));
  assert.equal(parseDesignModel("{").ok, false);
});

test("이력: 100단계 상한·취소/다시·합치기·새 편집이 다시 실행을 지움", () => {
  let h = createHistory(0);
  for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = commit(h, i);
  assert.equal(h.past.length, HISTORY_LIMIT);
  assert.equal(h.present, HISTORY_LIMIT + 20);
  h = undo(h);
  assert.ok(canRedo(h));
  assert.equal(h.present, HISTORY_LIMIT + 19);
  h = redo(h);
  assert.equal(h.present, HISTORY_LIMIT + 20);
  h = undo(undo(h));
  h = commit(h, -1);
  assert.equal(canRedo(h), false);
  let c = commit(createHistory(0), 1, "k");
  c = commit(c, 2, "k");
  c = commit(c, 3, "k");
  assert.equal(c.past.length, 1, "같은 키는 한 단계");
  assert.equal(undo(c).present, 0);
  c = commit(c, 4, "other");
  assert.equal(c.past.length, 2);
  assert.equal(commit(c, 4), c, "같은 값은 단계를 늘리지 않음");
  assert.equal(canUndo(createHistory(1)), false);
  assert.equal(undo(createHistory(1)).present, 1);
});

test("권한: 판정 전은 로딩, 거부는 이유, 폭이 좁으면 열람만", () => {
  assert.deepEqual(plansAccess(undefined, true), { edit: false, pending: true, lockReason: null, narrow: false });
  const ok = plansAccess({ allowed: true } as Parameters<typeof plansAccess>[0], true);
  assert.equal(ok.edit, true);
  assert.equal(plansAccess({ allowed: true } as Parameters<typeof plansAccess>[0], false).edit, false);
  assert.equal(plansAccess({ allowed: true } as Parameters<typeof plansAccess>[0], false).narrow, true);
  const locked = plansAccess({ allowed: false, reason: "expired" } as Parameters<typeof plansAccess>[0], true);
  assert.equal(locked.edit, false);
  assert.match(locked.lockReason ?? "", /체험이 끝나/);
});

test("mm 입력 해석", () => {
  assert.equal(parseMm("1,200"), 1_200);
  assert.equal(parseMm("1200.5"), 1_201);
  assert.equal(parseMm("abc"), null);
  assert.equal(parseMm(""), null);
});
