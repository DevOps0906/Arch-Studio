import assert from "node:assert/strict";
import { test } from "node:test";
import { DEV_PROGRAM_CHECKLIST } from "../demo/program-rules.ts";
import { DEMO_PROJECTS } from "../demo/samples.ts";
import { draftRows, withRows } from "./model.ts";
import { commitCount, countText, parseCount, programChecklist, provideProgramChecklist, recalcRows } from "./rules.ts";

const ruleSet = DEV_PROGRAM_CHECKLIST.ruleSet;

test("규칙 세트 공급이 없으면(운영) 체크리스트 기준은 null이고 데모 런타임만 개발용을 공급한다", async () => {
  assert.equal(programChecklist(), null);
  const { createDemoRuntime } = await import("../demo/index.ts");
  createDemoRuntime({ search: "", engine: null });
  assert.equal(programChecklist(), DEV_PROGRAM_CHECKLIST);
  provideProgramChecklist(null);
  assert.equal(programChecklist(), null);
});

test("답을 고치면 잠기지 않은 행은 규칙 결과로 다시 계산된다", () => {
  const rows = [{ name: "옛 실", use: "기타", area: "5", locked: false }];
  const result = recalcRows({ households: 1, family_size: 2 }, rows, ruleSet);
  assert.equal(result.kind, "ok");
  assert.deepEqual(result.kind === "ok" && result.rows.map((r) => [r.name, r.area, r.locked]), [
    ["거실", "30", false], ["주방·식당", "20", false], ["침실 1", "12", false], ["침실 2", "12", false],
  ]);
});

test("잠긴 행은 값·위치를 유지하고 규칙에 없는 잠긴 행도 남는다", () => {
  const model = structuredClone(DEMO_PROJECTS[0]!.model);
  const rows = [...draftRows(model), { name: "다락", use: "수납", area: "7.5", locked: true }];
  const result = recalcRows({ ...model.program.checklist_answers, garage: false }, rows, ruleSet);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") return;
  assert.deepEqual(result.rows[0], { name: "거실", use: "거실", area: "33", locked: true });
  assert.deepEqual(result.rows.at(-1), { name: "다락", use: "수납", area: "7.5", locked: true });
  assert.equal(result.rows.some((r) => r.name === "차고"), false);
  const saved = withRows(model, result.rows, { ...model.program.checklist_answers, garage: false });
  assert.equal(saved.program.checklist_answers.garage, false);
  assert.deepEqual(saved.program.user_locked_rows, ["거실", "다락"]);
});

test("잠긴 행 입력이 잘못되었거나 답이 계산 불가하면 재계산하지 않는다", () => {
  const bad = recalcRows({ households: 1 }, [{ name: "거실", use: "거실", area: "-1", locked: true }], ruleSet);
  assert.equal(bad.kind, "error");
  const badAnswer = recalcRows({ family_size: 1.5 }, [], ruleSet);
  assert.equal(badAnswer.kind, "error");
  assert.equal(parseCount("3"), 3);
  for (const t of ["", "-1", "1.5", "100", "1e2"]) assert.equal(parseCount(t), null);
});

test("수량 칸은 반영 실패 때 저장된 답으로 되돌리고, 고치는 중인 잘못된 글자는 blur 때 되돌린다", () => {
  assert.equal(commitCount("3", 2, () => false), "2");
  assert.equal(commitCount("3", undefined, () => false), "");
  let applied: number | null = null;
  assert.equal(commitCount("3", 2, (n) => { applied = n; return true; }), "3");
  assert.equal(applied, 3);
  for (const t of ["", "abc", "100"]) assert.equal(commitCount(t, 2, () => assert.fail("반영하면 안 된다")), t);
  assert.equal(countText(2), "2");
  assert.equal(countText(undefined), "");
});
