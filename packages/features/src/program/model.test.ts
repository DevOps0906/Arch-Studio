import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { draftRows, parseModel, validateRows, withRows } from "./model.ts";

test("수동 면적표 저장은 다른 설계 데이터와 체크리스트를 보존한다", () => {
  const model = structuredClone(DEMO_PROJECTS[0]!.model);
  const before = JSON.stringify(model);
  const rows = [{ name: " 서재 ", use: " 업무 ", area: "12.34", locked: true }];
  const next = withRows(model, rows);
  assert.deepEqual(next.program.targets, [{ name: "서재", use: "업무", target_area_m2: 12.34 }]);
  assert.deepEqual(next.program.user_locked_rows, ["서재"]);
  assert.deepEqual(next.program.checklist_answers, model.program.checklist_answers);
  assert.deepEqual(next.site, model.site);
  assert.deepEqual(next.masses, model.masses);
  assert.equal(JSON.stringify(model), before);
  assert.deepEqual(draftRows(next), [{ name: "서재", use: "업무", area: "12.34", locked: true }]);
});

test("빈 값·음수·비유한 면적과 공백 정규화 후 중복 실 이름은 저장하지 않는다", () => {
  const row = { name: "서재", use: "업무", area: "12", locked: false };
  for (const area of ["", "-1", "NaN", "Infinity", "1e999", "0x10"]) {
    assert.notEqual(validateRows([{ ...row, area }]), null);
  }
  assert.notEqual(validateRows([row, { ...row, name: " 서재 " }]), null);
  assert.notEqual(validateRows([{ ...row, use: " " }]), null);
  assert.equal(validateRows([{ ...row, area: "0" }]), null);
  assert.equal(validateRows([]), null);
});

test("손상된 모델은 빈 데이터로 대체하지 않고 읽기 실패를 반환한다", () => {
  assert.equal(parseModel("{"), null);
  assert.equal(parseModel("{}"), null);
});
