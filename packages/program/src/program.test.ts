// 체크리스트 → 면적표(AR-F-011): 같은 입력 같은 출력(속성), 잠금 행 덮어쓰기 0.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { buildProgram, m2ToHundredths, type BuildProgramInput } from "./index.ts";
import { FAKE_RULE_SET } from "./test-fixtures.ts";

// fast-check v4 레코드는 기본이 null 프로토타입이라 deepEqual 비교를 위해 끈다.
const NO_NULL_PROTO = { noNullPrototype: true } as const;
const NAMES = ["공용실A", "개별실 1", "개별실 2", "개별실 3", "부속실X", "사용자실"];

const answersArb = fc.record(
  {
    q_base: fc.boolean(),
    q_count: fc.integer({ min: 0, max: 4 }),
    q_tags: fc.subarray(["tag_x", "tag_y"]),
    q_mode: fc.constantFrom("m0", "m1"),
  },
  { requiredKeys: [], noNullPrototype: true },
);
const targetArb = fc.record({
  name: fc.constantFrom(...NAMES),
  use: fc.constantFrom("fake_use_a", "user_use"),
  target_area_m2: fc.integer({ min: 0, max: 100_000 }).map((h) => h / 100),
}, NO_NULL_PROTO);
const inputArb: fc.Arbitrary<BuildProgramInput> = fc.record({
  checklist_answers: answersArb,
  rule_set: fc.constant(FAKE_RULE_SET),
  previous: fc.record({
    targets: fc.uniqueArray(targetArb, { maxLength: 6, selector: (r) => r.name }),
    user_locked_rows: fc.subarray(NAMES),
  }, NO_NULL_PROTO),
}, NO_NULL_PROTO);

test("같은 입력이면 같은 출력(바이트 단위), 입력은 바꾸지 않는다", () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const copy = structuredClone(input);
      const a = JSON.stringify(buildProgram(input));
      const b = JSON.stringify(buildProgram(copy));
      assert.equal(a, b);
      assert.deepEqual(input, copy);
    }),
  );
});

test("잠금 행 덮어쓰기 0: 잠긴 이름의 첫 직전 행이 값 그대로 정확히 한 번 남는다", () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const out = buildProgram(input);
      for (const name of input.previous.user_locked_rows) {
        const prev = input.previous.targets.find((r) => r.name === name);
        if (prev) assert.deepEqual(out.targets.filter((r) => r.name === name), [prev]);
      }
      assert.deepEqual(out.user_locked_rows, input.previous.user_locked_rows);
    }),
  );
});

test("합계는 0.01 m2 정수 합", () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const out = buildProgram(input);
      const sum = out.targets.reduce((s, r) => s + m2ToHundredths(r.target_area_m2), 0);
      assert.equal(out.total_area_m2_hundredths, sum);
      assert.equal(out.total_area_m2, sum / 100);
    }),
  );
});

test("규칙 적용: 반복·포함·우선순위, 잠금 행 자리 유지, 잠금 안 된 직전 행 대체", () => {
  const out = buildProgram({
    checklist_answers: { q_base: true, q_count: 2, q_tags: ["tag_x"], q_mode: "m1" },
    rule_set: FAKE_RULE_SET,
    previous: {
      targets: [
        { name: "개별실 1", use: "user_use", target_area_m2: 15.5 },
        { name: "공용실A", use: "fake_use_a", target_area_m2: 1 },
        { name: "사용자실", use: "user_use", target_area_m2: 7.25 },
      ],
      user_locked_rows: ["개별실 1", "사용자실"],
    },
  });
  assert.deepEqual(out.targets, [
    { name: "공용실A", use: "fake_use_a", target_area_m2: 38 },
    { name: "개별실 1", use: "user_use", target_area_m2: 15.5 },
    { name: "개별실 2", use: "fake_use_b", target_area_m2: 12 },
    { name: "부속실X", use: "fake_use_c", target_area_m2: 9.05 },
    { name: "사용자실", use: "user_use", target_area_m2: 7.25 },
  ]);
  assert.equal(out.total_area_m2_hundredths, 3800 + 1550 + 1200 + 905 + 725);
  assert.equal(out.rule_set_version, "fake-0.0.1");
});

test("m2ToHundredths: 부동소수 오차 보정, 음수·NaN 거부", () => {
  assert.equal(m2ToHundredths(12.345), 1235);
  assert.equal(m2ToHundredths(9.05), 905);
  assert.throws(() => m2ToHundredths(-1), RangeError);
  assert.throws(() => m2ToHundredths(Number.NaN), RangeError);
});

test("직전 면적표의 같은 이름 행은 잠금 여부와 관계없이 거부한다", () => {
  const dup = [
    { name: "사용자실", use: "user_use", target_area_m2: 7 },
    { name: "사용자실", use: "user_use", target_area_m2: 9 },
  ];
  for (const locked of [["사용자실"], []]) {
    assert.throws(
      () =>
        buildProgram({
          checklist_answers: {},
          rule_set: FAKE_RULE_SET,
          previous: { targets: dup, user_locked_rows: locked },
        }),
      RangeError,
    );
  }
});
