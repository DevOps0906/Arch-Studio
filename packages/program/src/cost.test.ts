// 개략 공사비(AR-F-012): 금액 정수(원), 반올림 규칙, 합계·부가세 = 엔진 계산값, 단가 출처·기준일 포함.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { KR_VAT_RATE_BP, estimateCost, type EstimateCostInput } from "./index.ts";
import { FAKE_CATALOG } from "./test-fixtures.ts";

test("행 공급가·부가세 원 미만 반올림, 용도 단가 우선, 출처·기준일 포함", () => {
  const out = estimateCost({
    catalog: FAKE_CATALOG,
    structure: "fake_struct",
    finish_grade: "fake_grade",
    rows: [
      { name: "a", use: "fake_use_a", target_area_m2: 0.05 }, // 1001 x 5 / 100 = 50.05 -> 50
      { name: "b", use: "fake_use_c", target_area_m2: 0.25 }, // 2003 x 25 / 100 = 500.75 -> 501
      { name: "c", use: "fake_use_a", target_area_m2: 0.5 }, // 1001 x 50 / 100 = 500.5 -> 501
    ],
  });
  assert.deepEqual(
    out.lines.map((l) => [l.unit_price_won_per_m2, l.supply_won]),
    [
      [1001, 50],
      [2003, 501],
      [1001, 501],
    ],
  );
  assert.equal(out.supply_won, 1052);
  assert.equal(out.vat_rate_bp, KR_VAT_RATE_BP);
  assert.equal(out.vat_won, 105); // 105.2 -> 105
  assert.equal(out.total_won, 1157);
  assert.equal(out.catalog_version, "0000.00.0");
  assert.equal(out.basis_date, "2000-01-01");
  assert.equal(out.source_note, FAKE_CATALOG.source_note);
  assert.deepEqual(out.unpriced_rows, []);
});

test("부가세 0.5원은 올린다", () => {
  const out = estimateCost({
    catalog: { ...FAKE_CATALOG, items: [{ structure: "s", finish_grade: "g", unit_price_won_per_m2: 5 }] },
    structure: "s",
    finish_grade: "g",
    rows: [{ name: "a", use: "u", target_area_m2: 1 }],
  });
  assert.equal(out.supply_won, 5);
  assert.equal(out.vat_won, 1); // 0.5 -> 1
});

test("단가 없는 행은 unpriced_rows로 보고하고 공급가에서 뺀다", () => {
  const out = estimateCost({
    catalog: FAKE_CATALOG,
    structure: "none",
    finish_grade: "fake_grade",
    rows: [{ name: "a", use: "u", target_area_m2: 10 }],
  });
  assert.deepEqual(out.unpriced_rows, ["a"]);
  assert.equal(out.total_won, 0);
});

test("정수가 아닌 단가·세율은 거부", () => {
  const rows = [{ name: "a", use: "u", target_area_m2: 1 }];
  const badCatalog = { ...FAKE_CATALOG, items: [{ structure: "s", finish_grade: "g", unit_price_won_per_m2: 1.5 }] };
  assert.throws(() => estimateCost({ catalog: badCatalog, structure: "s", finish_grade: "g", rows }), RangeError);
  assert.throws(
    () => estimateCost({ catalog: FAKE_CATALOG, structure: "s", finish_grade: "g", rows, vat_rate_bp: 10.5 }),
    RangeError,
  );
});

const inputArb: fc.Arbitrary<EstimateCostInput> = fc.record({
  catalog: fc.constant(FAKE_CATALOG),
  structure: fc.constant("fake_struct"),
  finish_grade: fc.constantFrom("fake_grade", "other_grade", "missing"),
  rows: fc.array(
    fc.record({
      name: fc.string({ maxLength: 4 }),
      use: fc.constantFrom("fake_use_a", "fake_use_c"),
      target_area_m2: fc.integer({ min: 0, max: 1_000_000 }).map((h) => h / 100),
    }),
    { maxLength: 8 },
  ),
});

test("속성: 같은 입력 같은 출력, 금액 정수, 합계 = 공급가 + 부가세 = 엔진 계산값", () => {
  fc.assert(
    fc.property(inputArb, (input) => {
      const out = estimateCost(input);
      assert.equal(JSON.stringify(out), JSON.stringify(estimateCost(structuredClone(input))));
      for (const v of [out.supply_won, out.vat_won, out.total_won, ...out.lines.map((l) => l.supply_won)]) {
        assert.ok(Number.isSafeInteger(v) && v >= 0);
      }
      assert.equal(out.supply_won, out.lines.reduce((s, l) => s + l.supply_won, 0));
      assert.equal(out.vat_won, Math.floor((out.supply_won * out.vat_rate_bp + 5000) / 10000));
      assert.equal(out.total_won, out.supply_won + out.vat_won);
      assert.equal(out.lines.length + out.unpriced_rows.length, input.rows.length);
    }),
  );
});

const one = (price: number, areaM2: number, vatRateBp: number): EstimateCostInput => ({
  catalog: { ...FAKE_CATALOG, items: [{ structure: "s", finish_grade: "g", unit_price_won_per_m2: price }] },
  structure: "s",
  finish_grade: "g",
  rows: [{ name: "a", use: "u", target_area_m2: areaM2 }],
  vat_rate_bp: vatRateBp,
});

test("회귀: 2^53 근처 단가도 반올림 오차 없음(BigInt 중간값)", () => {
  const out = estimateCost(one(9007199254740949, 0.01, 0)); // 9007199254740949 / 100 = 90071992547409.49
  assert.equal(out.supply_won, 90071992547409);
  assert.equal(out.total_won, 90071992547409);
});

test("회귀: 행 공급가·합계가 안전 정수를 넘으면 명시적 오류", () => {
  assert.throws(() => estimateCost(one(Number.MAX_SAFE_INTEGER, 2, 0)), RangeError); // 행 공급가 초과
  assert.equal(estimateCost(one(Number.MAX_SAFE_INTEGER, 1, 0)).total_won, Number.MAX_SAFE_INTEGER);
  assert.throws(() => estimateCost(one(Number.MAX_SAFE_INTEGER, 1, KR_VAT_RATE_BP)), RangeError); // 공급가+부가세 초과
});

/** BigInt 기준값: round(a*b/d), 0.5 이상 올림. */
const refRound = (a: bigint, b: bigint, d: bigint): bigint => (a * b * 2n + d) / (2n * d);

test("속성: 안전 정수 경계에서 BigInt 기준값과 같거나 명시적 오류", () => {
  const MAX = BigInt(Number.MAX_SAFE_INTEGER);
  fc.assert(
    fc.property(
      fc.oneof(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), fc.maxSafeNat()),
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({ min: 0, max: 10_000 }),
      (price, areaH, bp) => {
        const supply = refRound(BigInt(price), BigInt(areaH), 100n);
        const vat = supply <= MAX ? refRound(supply, BigInt(bp), 10_000n) : 0n;
        const run = () => estimateCost(one(price, areaH / 100, bp));
        if (supply > MAX || supply + vat > MAX) {
          assert.throws(run, RangeError);
          return;
        }
        const out = run();
        assert.equal(BigInt(out.supply_won), supply);
        assert.equal(BigInt(out.vat_won), vat);
        assert.equal(BigInt(out.total_won), supply + vat);
      },
    ),
  );
});
