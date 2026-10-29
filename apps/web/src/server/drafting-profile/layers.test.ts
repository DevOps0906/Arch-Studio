// 레이어 매핑 사본이 정본(packages/drafting resolveLayerMap, packages/domain STD_LAYERS·draftingProfileSchema)과 같은지 + 저장 정규화.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STD_LAYERS as DOMAIN_STD, draftingProfileSchema } from "../../../../../packages/domain/src/sheet.ts";
import { resolveLayerMap as canonical } from "../../../../../packages/drafting/src/layers/index.ts";
import { normalizeLayerMap, resolveLayerMap, STD_LAYERS } from "./layers.ts";
import { profileInputSchema } from "./schema.ts";

/** 결정적 사례 생성기(난수 없음: 선형 합동 수열). 금지 문자·대소문자·예약 "0"·공백·한글·중복 이름을 섞는다. */
export function layerCases(n: number): Record<string, string>[] {
  const pool = ["A", "b", "0", "-", "_", "$", " ", "/", ":", "=", ",", "<", "\\", "\"", "가", "x", "SITE", "site", "A-WALL", "a-wall", "\t", "\u0001", ".", "*"];
  const out: Record<string, string>[] = [];
  let s = 12345;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < n; i++) {
    const m: Record<string, string> = {};
    for (const std of STD_LAYERS) {
      if (next() % 3 === 0) continue;
      const len = next() % 4;
      let v = "";
      for (let j = 0; j < len; j++) v += pool[next() % pool.length];
      m[std] = v;
    }
    if (next() % 5 === 0) m["X-UNKNOWN"] = "Z";
    out.push(m);
  }
  return out;
}

const FIXED: Array<Record<string, string>> = [
  {},
  { "A-SITE-BNDY": "대지경계", "A-ENVL": "법규선" },
  { "A-WALL": "WALL", "A-DOOR": "wall" },
  { "A-WALL": "0" },
  { "A-WALL": "a-door" },
  { "A-WALL": "SAME", "A-DOOR": "SAME" },
  { "A-WALL": "bad/name", "A-DOOR": " ", "A-GLAZ": "" },
  { "a-wall": "x", "A-TTLB": "TB" },
];

test("STD_LAYERS 사본 = domain 정본(순서 포함)", () => {
  assert.deepEqual([...STD_LAYERS], [...DOMAIN_STD]);
});

test("resolveLayerMap 사본 = 정본(names·warnings·table 이름) — 고정 8건 + 생성 400건", () => {
  for (const m of [...FIXED, ...layerCases(400)]) {
    const a = resolveLayerMap(m);
    const b = canonical(m);
    assert.deepEqual(a.names, b.names, JSON.stringify(m));
    assert.deepEqual(a.warnings, b.warnings, JSON.stringify(m));
    assert.deepEqual(a.table, b.table.map((t) => t.name), JSON.stringify(m));
  }
});

test("프로필 본문 키 = domain draftingProfileSchema 키", () => {
  assert.deepEqual(Object.keys(profileInputSchema.shape).sort(), Object.keys(draftingProfileSchema.shape).sort());
});

test("normalizeLayerMap 거부: 표준 밖 키(__proto__·constructor·소문자·제어문자 키), 비문자열, 제어문자·bidi, 64자 초과, 배열", () => {
  const bad: unknown[] = [
    JSON.parse('{"__proto__": "X"}'),
    { constructor: "X" },
    { "a-wall": "X" },
    { "A-WALL\u0000": "X" },
    { "A-WALL": 1 },
    { "A-WALL": "a\nb" },
    { "A-WALL": "a\r\n0\r\nSECTION" },
    { "A-WALL": "x\u202ey" },
    { "A-WALL": "\u0085" },
    { "A-WALL": "A".repeat(65) },
    [],
    null,
    "A-WALL",
  ];
  for (const b of bad) assert.equal(normalizeLayerMap(b).ok, false, JSON.stringify(b));
  assert.equal(normalizeLayerMap({ "A-WALL": "A".repeat(64) }).ok, true);
});

test("normalizeLayerMap: 금지 문자·빈 값은 정본과 같이 invalid_name(저장 안 함), DB 정규식 밖은 unsupported_name, 충돌은 경고만", () => {
  const r = normalizeLayerMap({ "A-WALL": "bad/name", "A-DOOR": "", "A-SITE-BNDY": "대지경계", "A-GLAZ": "GL", "A-AREA": "gl", "A-PARK": "P$1" });
  assert.ok(r.ok);
  assert.deepEqual({ ...r.map }, { "A-GLAZ": "GL", "A-AREA": "gl", "A-PARK": "P$1" });
  assert.deepEqual(r.warnings, [
    { kind: "unsupported_name", key: "A-SITE-BNDY", name: "대지경계" },
    { kind: "invalid_name", key: "A-WALL", name: "bad/name" },
    { kind: "invalid_name", key: "A-DOOR", name: "" },
    { kind: "name_conflict", key: "A-AREA", name: "gl" },
  ]);
  assert.equal(Object.getPrototypeOf(r.map), null);
  // 정본 invalid_name 판정과 일치: 정본이 invalid_name이라 한 키는 저장 map에 없다.
  for (const m of layerCases(200)) {
    const known = Object.fromEntries(Object.entries(m).filter(([k, v]) => k !== "X-UNKNOWN" && !/[\u0000-\u001f]/.test(v)));
    const n = normalizeLayerMap(known);
    assert.ok(n.ok);
    const invalid = canonical(known).warnings.filter((w) => w.kind === "invalid_name").map((w) => w.key);
    for (const k of invalid) assert.equal(k in n.map, false);
    for (const v of Object.values(n.map)) assert.match(v as string, /^[A-Za-z0-9_$-]{1,64}$/);
  }
});
