// 레이어 표준(PRD 9.6절)·layer_map 해석(개발서 12.7절).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { STD_LAYERS } from "@arch-studio/domain";
import { LAYER_TABLE, layerDef, layerOrder, resolveLayerMap } from "../index.ts";

test("16개 표준 레이어, 순서·ACI·선 종류가 PRD 9.6절과 같다", () => {
  assert.deepEqual(LAYER_TABLE.map((l) => l.name), [...STD_LAYERS]);
  assert.deepEqual(
    LAYER_TABLE.map((l) => `${l.name}:${l.aci}:${l.linetype}`),
    [
      "A-SITE-BNDY:1:DASHDOT",
      "A-SITE-ROAD:8:CONTINUOUS",
      "A-SITE-SETB:3:DASHED",
      "A-ENVL:4:DASHED",
      "A-MASS:7:CONTINUOUS",
      "A-WALL:7:CONTINUOUS",
      "A-DOOR:2:CONTINUOUS",
      "A-GLAZ:5:CONTINUOUS",
      "A-AREA:6:CONTINUOUS",
      "A-AREA-IDEN:7:CONTINUOUS",
      "A-PARK:3:CONTINUOUS",
      "A-ANNO-DIMS:1:CONTINUOUS",
      "A-ANNO-TEXT:7:CONTINUOUS",
      "A-ANNO-NRTH:7:CONTINUOUS",
      "A-TTLB:7:CONTINUOUS",
      "A-REFR:9:CONTINUOUS",
    ],
  );
  assert.equal(layerOrder("A-TTLB"), 14);
  assert.equal(layerDef("A-ENVL").aci, 4);
  assert.ok(Object.isFrozen(LAYER_TABLE) && Object.isFrozen(LAYER_TABLE[0]));
});

test("layer_map 없음 → 표준 이름 16개", () => {
  const r = resolveLayerMap(undefined);
  assert.deepEqual(r.table.map((l) => l.name), [...STD_LAYERS]);
  assert.deepEqual(r.warnings, []);
});

test("매핑·금지 문자·합치기·표준 밖 키", () => {
  const r = resolveLayerMap({
    "A-MASS": "건물외곽",
    "A-WALL": "건물외곽", // 합치기: 색·선 종류는 앞(A-MASS)
    "A-SITE-BNDY": "대지|경계", // 금지 문자 → 표준 유지
    "A-ENVL": "  ",
    "X-FOO": "기타",
  });
  assert.equal(r.names["A-MASS"], "건물외곽");
  assert.equal(r.names["A-WALL"], "건물외곽");
  assert.equal(r.names["A-SITE-BNDY"], "A-SITE-BNDY");
  assert.equal(r.names["A-ENVL"], "A-ENVL");
  assert.equal(r.table.filter((l) => l.name === "건물외곽").length, 1);
  assert.equal(r.table.length, 15);
  assert.deepEqual(
    r.warnings.map((w) => `${w.kind}:${w.key}`),
    ["unknown_key:X-FOO", "invalid_name:A-SITE-BNDY", "invalid_name:A-ENVL"],
  );
  for (const ch of '<>/\\":;?*|=,') assert.equal(resolveLayerMap({ "A-PARK": `P${ch}` }).names["A-PARK"], "A-PARK");
});
