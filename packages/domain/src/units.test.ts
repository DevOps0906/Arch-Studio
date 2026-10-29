// mm 정수·면적 표시 유틸(04_API.md 4.7.1: 면적 표시는 m2 소수 둘째 자리).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { MM_COORD_LIMIT, formatAreaM2, isMm, mToMm, mm2ToM2, mm2ToM2Hundredths, mmSchema, polygonSchema } from "./index.ts";

test("mmSchema는 정수만 받는다", () => {
  assert.equal(mmSchema.safeParse(1200).success, true);
  for (const bad of [1200.5, Number.NaN, Number.POSITIVE_INFINITY, "1200"]) {
    assert.equal(mmSchema.safeParse(bad).success, false);
  }
});

test("mmSchema는 ±10km(10,000,000mm)까지만 받는다", () => {
  assert.equal(mmSchema.safeParse(MM_COORD_LIMIT).success, true);
  assert.equal(mmSchema.safeParse(-MM_COORD_LIMIT).success, true);
  assert.equal(mmSchema.safeParse(MM_COORD_LIMIT + 1).success, false);
  assert.equal(mmSchema.safeParse(-MM_COORD_LIMIT - 1).success, false);
  assert.equal(mmSchema.safeParse(Number.MAX_SAFE_INTEGER + 2).success, false);
});

test("polygonSchema는 외곽·구멍 모두 3점 이상", () => {
  const tri: [number, number][] = [[0, 0], [1000, 0], [0, 1000]];
  assert.equal(polygonSchema.safeParse({ outer: tri }).success, true);
  assert.equal(polygonSchema.safeParse({ outer: tri.slice(0, 2) }).success, false);
  assert.equal(polygonSchema.safeParse({ outer: tri, holes: [tri.slice(0, 2)] }).success, false);
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

test("mToMm은 10진 자리에서 반올림한다(부동소수 곱셈 오차 없음)", () => {
  assert.equal(0.5005 * 1000 < 500.5, true); // 곱셈 후 반올림하면 500이 되는 경우
  assert.equal(mToMm(0.5005), 501);
  assert.equal(mToMm(-0.5005), -501);
  assert.equal(mToMm(1.0005), 1001);
  assert.equal(mToMm(2.0004999), 2000);
  assert.equal(mToMm(1e-7), 0);
  assert.equal(mToMm(5e-4), 1);
  assert.equal(mToMm(12345.6785), 12345679);
  assert.throws(() => mToMm(1e21), RangeError); // safe int 초과
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
