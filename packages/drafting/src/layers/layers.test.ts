// 레이어 표준(PRD 9.6절)·layer_map 해석(개발서 12.7절).
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { STD_LAYERS } from "@arch-studio/domain";
import { LAYER_TABLE, layerDef, layerOrder, resolveLayerMap } from "../index.ts";
import { outputLayerTable } from "./index.ts";

test("17개 표준 레이어(PRD 9.6절 16개 + 사람 주석 A-ANNO-USER), 순서·ACI·선 종류", () => {
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
      "A-ANNO-USER:6:CONTINUOUS",
    ],
  );
  assert.equal(layerOrder("A-TTLB"), 14);
  assert.equal(layerDef("A-ENVL").aci, 4);
  assert.ok(Object.isFrozen(LAYER_TABLE) && Object.isFrozen(LAYER_TABLE[0]));
});

test("layer_map 없음 → 표준 이름 17개", () => {
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
  assert.equal(r.table.length, 16); // 표준 17개 - 합치기 1
  assert.deepEqual(
    r.warnings.map((w) => `${w.kind}:${w.key}`),
    ["unknown_key:X-FOO", "invalid_name:A-SITE-BNDY", "invalid_name:A-ENVL"],
  );
  for (const ch of '<>/\\":;?*|=,') assert.equal(resolveLayerMap({ "A-PARK": `P${ch}` }).names["A-PARK"], "A-PARK");
});

test("제어 문자 이름은 invalid_name 후 표준 이름(DXF 줄 구조 보호)", () => {
  for (const bad of ["벽\n체", "A\rB", "탭\t", "널\u0000", "DEL\u007f", "\u001f"]) {
    const r = resolveLayerMap({ "A-WALL": bad });
    assert.equal(r.names["A-WALL"], "A-WALL");
    assert.deepEqual(r.warnings, [{ kind: "invalid_name", key: "A-WALL", name: bad }]);
  }
});

test("이름 충돌은 대소문자 무시(ASCII): 앞 레이어 유지, 뒤는 표준 이름 + name_conflict, 예약 \"0\" 포함", () => {
  const r = resolveLayerMap({ "A-MASS": "Bldg", "A-WALL": "BLDG", "A-DOOR": "0", "A-GLAZ": "glaz", "A-AREA": "a-site-bndy" });
  assert.equal(r.names["A-MASS"], "Bldg");
  assert.equal(r.names["A-WALL"], "A-WALL");
  assert.equal(r.names["A-DOOR"], "A-DOOR");
  assert.equal(r.names["A-GLAZ"], "glaz");
  assert.equal(r.names["A-AREA"], "A-AREA"); // 앞의 표준 이름 A-SITE-BNDY와 대소문자만 다름
  assert.deepEqual(
    r.warnings.map((w) => `${w.kind}:${w.key}:${w.name}`),
    ["name_conflict:A-WALL:BLDG", "name_conflict:A-DOOR:0", "name_conflict:A-AREA:a-site-bndy"],
  );
  const keys = ["0", ...r.table.map((l) => l.name)].map((n) => n.toUpperCase());
  assert.equal(new Set(keys).size, keys.length);
  // 정확히 같은 철자는 합치기(경고 없음). "0"은 철자가 같아도 충돌.
  assert.deepEqual(resolveLayerMap({ "A-MASS": "X", "A-WALL": "X" }).warnings, []);
  assert.equal(resolveLayerMap({ "A-MASS": "0" }).names["A-MASS"], "A-MASS");
  // 되돌린 표준 이름이 앞 이름과 대소문자만 다르면 앞 이름에 합친다.
  const m = resolveLayerMap({ "A-MASS": "a-wall", "A-WALL": "0" });
  assert.equal(m.names["A-WALL"], "a-wall");
  assert.deepEqual(m.warnings.map((w) => w.kind), ["name_conflict"]);
});

test("쓸 때만 레이어(A-ANNO-USER): 쓰지 않으면 출력 표에서 빠지고, 다른 레이어와 합친 이름은 남는다", () => {
  const none = resolveLayerMap(undefined);
  assert.deepEqual(outputLayerTable(none, new Set()).map((l) => l.name), STD_LAYERS.filter((l) => l !== "A-ANNO-USER"));
  assert.deepEqual(outputLayerTable(none, new Set(["A-ANNO-USER"])).map((l) => l.name), [...STD_LAYERS]);
  const merged = resolveLayerMap({ "A-ANNO-TEXT": "NOTE", "A-ANNO-USER": "NOTE" });
  assert.ok(outputLayerTable(merged, new Set()).some((l) => l.name === "NOTE"));
  const renamed = resolveLayerMap({ "A-ANNO-USER": "MY-NOTE" });
  assert.ok(!outputLayerTable(renamed, new Set()).some((l) => l.name === "MY-NOTE"));
});
