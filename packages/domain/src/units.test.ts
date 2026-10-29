// mm 정수·면적 표시 유틸(04_API.md 4.7.1: 면적 표시는 m2 소수 둘째 자리).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { formatAreaM2, isMm, mToMm, mm2ToM2, mm2ToM2Hundredths, mmSchema } from "./index.ts";

test("mmSchema는 정수만 받는다", () => {
  assert.equal(mmSchema.safeParse(1200).success, true);
  for (const bad of [1200.5, Number.NaN, Number.POSITIVE_INFINITY, "1200"]) {
    assert.equal(mmSchema.safeParse(bad).success, false);
  }
});

test("isMm", () => {
  assert.equal(isMm(0), true);
  assert.equal(isMm(-3000), true);
  assert.equal(isMm(0.1), false);
  assert.equal(isMm("1"), false);
});

test("mToMm은 0에서 먼 쪽으로 반올림한다", () => {
  assert.equal(mToMm(1.2), 1200);
  assert.equal(mToMm(0.0005), 1);
  assert.equal(mToMm(-0.0005), -1);
  assert.equal(Object.is(mToMm(-0.0001), 0), true);
  assert.throws(() => mToMm(Number.NaN), RangeError);
});

test("면적 m2 소수 둘째 자리 반올림", () => {
  assert.equal(mm2ToM2Hundredths(1_234_500), 123); // 1.2345 m2 → 1.23
  assert.equal(mm2ToM2Hundredths(1_235_000), 124); // 1.235 → 1.24 (반올림)
  assert.equal(mm2ToM2(300_000_000), 300);
  assert.throws(() => mm2ToM2Hundredths(1.5), RangeError);
});

test("formatAreaM2는 소수 둘째 자리를 고정해 표시한다", () => {
  assert.equal(formatAreaM2(0), "0.00");
  assert.equal(formatAreaM2(300_000_000), "300.00");
  assert.equal(formatAreaM2(1_050_000), "1.05");
  assert.equal(formatAreaM2(123_456_789), "123.46");
  assert.equal(formatAreaM2(-1_050_000), "-1.05");
  assert.equal(formatAreaM2(4_000), "0.00");
});
