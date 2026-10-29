// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson } from "./canonical.ts";
import { prng, shuffled } from "./test-helpers.ts";

test("키 정렬·공백 없음·undefined 제외·-0은 0", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, undefined, "x"], c: null }, z: undefined, m: -0 }), '{"a":{"c":null,"d":[1,null,"x"]},"b":1,"m":0}');
  assert.equal(canonicalJson({ "가": 1, B: 2, a: 3 }), '{"B":2,"a":3,"가":1}');
});

test("비유한 수·bigint·Date·Map·함수는 거부", () => {
  assert.throws(() => canonicalJson({ a: Number.NaN }), RangeError);
  assert.throws(() => canonicalJson({ a: Infinity }), RangeError);
  assert.throws(() => canonicalJson({ a: 1n }), TypeError);
  assert.throws(() => canonicalJson({ a: new Date(0) }), TypeError);
  assert.throws(() => canonicalJson({ a: new Map() }), TypeError);
  assert.throws(() => canonicalJson({ a: () => 1 }), TypeError);
  assert.equal(canonicalJson(Object.assign(Object.create(null), { b: 1, a: 2 })), '{"a":2,"b":1}');
});

function randomValue(rnd: () => number, depth: number): unknown {
  const r = rnd();
  if (depth > 3 || r < 0.3) {
    const k = Math.floor(rnd() * 5);
    if (k === 0) return null;
    if (k === 1) return rnd() < 0.5;
    if (k === 2) return Math.floor(rnd() * 2_000_000) - 1_000_000;
    if (k === 3) return String.fromCharCode(...Array.from({ length: Math.floor(rnd() * 6) }, () => 0x20 + Math.floor(rnd() * 0xac00)));
    return "x\"\\\n";
  }
  if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => randomValue(rnd, depth + 1));
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < Math.floor(rnd() * 6); i++) obj[`k${Math.floor(rnd() * 50)}${i % 2 ? "가" : "A"}`] = randomValue(rnd, depth + 1);
  return obj;
}

function reorder(value: unknown, rnd: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => reorder(v, rnd));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of shuffled(Object.keys(value), rnd)) out[k] = reorder((value as Record<string, unknown>)[k], rnd);
    return out;
  }
  return value;
}

test("속성(300회): 키 삽입 순서와 무관하게 같은 바이트, JSON.parse 왕복이 같은 값", () => {
  const rnd = prng(0x40);
  for (let i = 0; i < 300; i++) {
    const v = randomValue(rnd, 0);
    const a = canonicalJson(v);
    assert.equal(canonicalJson(reorder(v, rnd)), a);
    assert.equal(canonicalJson(JSON.parse(a)), a);
    assert.ok(!/\n/.test(a.replace(/\\n/g, "")), "출력에 줄바꿈 없음");
  }
});
