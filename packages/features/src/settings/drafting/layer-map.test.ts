// 레이어 매핑 경고 로직: 화면 사본 = 도면 엔진 정본(resolveLayerMap·LAYER_TABLE) = 서버 사본(normalizeLayerMap).
import assert from "node:assert/strict";
import { test } from "node:test";
import { LAYER_TABLE, resolveLayerMap as canonical } from "../../../../drafting/src/layers/index.ts";
import { normalizeLayerMap as serverNormalize, resolveLayerMap as serverResolve } from "../../../../../apps/web/src/server/drafting-profile/layers.ts";
import { LAYER_ROWS, layerTable, normalizeLayerMap, resolveLayerMap } from "./layer-map.ts";

/** 결정적 사례(서버 layers.test.ts와 같은 생성기·씨앗). */
function layerCases(n: number): Record<string, string>[] {
  const pool = ["A", "b", "0", "-", "_", "$", " ", "/", ":", "=", ",", "<", "\\", "\"", "가", "x", "SITE", "site", "A-WALL", "a-wall", "\t", "\u0001", ".", "*"];
  const out: Record<string, string>[] = [];
  let s = 12345;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648);
  const std = LAYER_ROWS.map((r) => r.name);
  for (let i = 0; i < n; i++) {
    const m: Record<string, string> = {};
    for (const k of std) {
      if (next() % 3 === 0) continue;
      const len = next() % 4;
      let v = "";
      for (let j = 0; j < len; j++) v += pool[next() % pool.length];
      m[k] = v;
    }
    if (next() % 5 === 0) m["X-UNKNOWN"] = "Z";
    out.push(m);
  }
  return out;
}

test("LAYER_ROWS = 정본 LAYER_TABLE(이름·색·선 종류·설명, 순서)", () => {
  assert.deepEqual(
    LAYER_ROWS.map((r) => ({ ...r })),
    LAYER_TABLE.map((r) => ({ ...r })),
  );
});

test("resolveLayerMap 화면 사본 = 정본 = 서버 사본(400건)", () => {
  for (const m of layerCases(400)) {
    const a = resolveLayerMap(m);
    const b = canonical(m);
    assert.deepEqual(a.names, b.names);
    assert.deepEqual(a.warnings, b.warnings);
    assert.deepEqual(a.table, b.table.map((t) => t.name));
    assert.deepEqual(a, serverResolve(m));
  }
});

test("normalizeLayerMap 화면 = 서버(거부 사례 포함)", () => {
  const extra: unknown[] = [JSON.parse('{"__proto__":"X"}'), { "A-WALL": "a\nb" }, { "A-WALL": "x\u202ey" }, { "A-WALL": "A".repeat(65) }, [], null, { "A-WALL": 3 }];
  for (const m of [...layerCases(300), ...extra]) {
    const a = normalizeLayerMap(m);
    const b = serverNormalize(m);
    assert.deepEqual(a.ok ? { ...a, map: { ...a.map } } : a, b.ok ? { ...b, map: { ...b.map } } : b, JSON.stringify(m));
  }
});

test("layerTable: 빈 칸은 표준 이름(경고 없음), 금지 문자·한글은 표준 유지 + 경고, 충돌은 경고, 제어 문자는 저장 차단", () => {
  const { rows, saveMap } = layerTable({ "A-WALL": "W/1", "A-DOOR": "문", "A-GLAZ": "GLAZ", "A-AREA": "glaz", "A-SITE-BNDY": "SITE_BND" });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by["A-MASS"]?.output, "A-MASS");
  assert.equal(by["A-MASS"]?.warning, null);
  assert.equal(by["A-SITE-BNDY"]?.output, "SITE_BND");
  assert.equal(by["A-WALL"]?.warning, "invalid_name");
  assert.equal(by["A-WALL"]?.output, "A-WALL");
  assert.equal(by["A-DOOR"]?.warning, "unsupported_name");
  assert.equal(by["A-AREA"]?.warning, "name_conflict");
  assert.equal(by["A-AREA"]?.output, "A-AREA");
  assert.deepEqual({ ...saveMap }, { "A-SITE-BNDY": "SITE_BND", "A-GLAZ": "GLAZ", "A-AREA": "glaz" });
  // 표 출력 이름 = 저장할 map을 정본에 넣은 결과(내보낼 때 이름)
  const exported = canonical(saveMap as Record<string, string>).names;
  for (const r of rows) assert.equal(r.output, exported[r.name]);
  const blocked = layerTable({ "A-WALL": "a\nb" });
  assert.equal(blocked.saveMap, null);
  assert.equal(blocked.rows.find((r) => r.name === "A-WALL")?.blocked, true);
});
