// IFC4 내보내기(AR-06-039): 결정성(바이트 동일·골든), GlobalId 안정성, web-ifc로 다시 열어 엔티티 수·정점 수 확인.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽고 쓴다
import { readFileSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import * as WebIFC from "web-ifc";
import { boxMesh } from "../gltf/fixtures.ts";
import { exportIfc, ifcGuid, type IfcExportInput } from "./index.ts";

// 골든 갱신: IFC_GOLDEN_UPDATE=1 pnpm --filter ./packages/io test
const UPDATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.IFC_GOLDEN_UPDATE === "1";
const GOLDEN = new URL("./golden/box.ifc", import.meta.url);
const input = (over: Partial<IfcExportInput> = {}): IfcExportInput => ({
  projectId: "p-0001",
  projectName: "테스트 '프로젝트'",
  masses: [
    { key: "mass-a", name: "매스 A", mesh: boxMesh(0, 0, 0, 10000, 8000, 3000) },
    { key: "mass-b", mesh: boxMesh(0, 0, 3000, 5000, 5000, 6000) },
  ],
  ...over,
});

test("두 번 내보내면 바이트가 같고 골든과 같다", () => {
  const a = exportIfc(input());
  assert.equal(a, exportIfc(input()));
  if (UPDATE) writeFileSync(GOLDEN, a);
  assert.equal(a, readFileSync(GOLDEN, "utf8"), "골든 불일치(의도한 변경이면 IFC_GOLDEN_UPDATE=1로 갱신, 이유는 커밋 본문에)");
  assert.match(a, /^[\x20-\x7e\n]*$/);
  assert.match(a, /FILE_NAME\('p-0001\.ifc','1970-01-01T00:00:00'/);
});

test("시각은 입력값만 쓴다", () => {
  const a = exportIfc(input({ timestamp: 1793491200 }));
  assert.match(a, /'2026-11-01T00:00:00'/);
  assert.match(a, /IFCOWNERHISTORY\([^)]*,1793491200\)/);
  assert.throws(() => exportIfc(input({ timestamp: -1 })), RangeError);
});

test("GlobalId: 22자 IFC base64, 입력이 바뀌면 바뀐다", () => {
  const g = ifcGuid("p-0001", "mass:mass-a");
  assert.match(g, /^[0-3][0-9A-Za-z_$]{21}$/);
  assert.equal(g, ifcGuid("p-0001", "mass:mass-a"));
  assert.notEqual(g, ifcGuid("p-0002", "mass:mass-a"));
  assert.notEqual(g, ifcGuid("p-0001", "mass:mass-b"));
  const a = exportIfc(input());
  const b = exportIfc(input({ projectId: "p-0002" }));
  const guids = (s: string) => [...s.matchAll(/\('([0-9A-Za-z_$]{22})'/g)].map((m) => m[1]);
  assert.equal(new Set(guids(a)).size, guids(a).length);
  assert.equal(guids(a).length, 10);
  for (const x of guids(b)) assert.ok(!guids(a).includes(x));
});

test("겹치는 매스 키·빈 매스는 거부", () => {
  const m = boxMesh(0, 0, 0, 1, 1, 1);
  assert.throws(() => exportIfc(input({ masses: [{ key: "a", mesh: m }, { key: "a", mesh: m }] })), RangeError);
  assert.throws(() => exportIfc(input({ masses: [] })), RangeError);
});

test("web-ifc로 다시 열면 엔티티 수·GlobalId·정점 수가 맞다", async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(exportIfc(input())));
  try {
    assert.equal(api.GetModelSchema(model), "IFC4");
    const count = (type: number) => api.GetLineIDsWithType(model, type).size();
    assert.equal(count(WebIFC.IFCPROJECT), 1);
    assert.equal(count(WebIFC.IFCSITE), 1);
    assert.equal(count(WebIFC.IFCBUILDING), 1);
    assert.equal(count(WebIFC.IFCBUILDINGSTOREY), 1);
    assert.equal(count(WebIFC.IFCRELAGGREGATES), 3);
    assert.equal(count(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE), 1);
    assert.equal(count(WebIFC.IFCUNITASSIGNMENT), 1);
    assert.equal(count(WebIFC.IFCBUILDINGELEMENTPROXY), 2);
    assert.equal(count(WebIFC.IFCTRIANGULATEDFACESET), 2);

    const proxies = api.GetLineIDsWithType(model, WebIFC.IFCBUILDINGELEMENTPROXY);
    const first = proxies.get(0);
    assert.equal(api.GetGuidFromExpressId(model, first), ifcGuid("p-0001", "mass:mass-a"));
    const proxy = api.GetLine(model, first);
    assert.equal(proxy.Name.value, "매스 A");
    const project = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCPROJECT).get(0));
    assert.equal(project.Name.value, "테스트 '프로젝트'");

    const lists = api.GetLineIDsWithType(model, WebIFC.IFCCARTESIANPOINTLIST3D);
    assert.equal(api.GetLine(model, lists.get(0)).CoordList.length, 8);

    // 삼각형화된 형상: 상자 12삼각형 → 인덱스 36개. web-ifc는 형상을 중심 기준으로 옮기고 변환 행렬에
    // 단위(mm → m, 0.001)·Z-up → Y-up·이동을 담는다 → 크기 10000×8000×3000mm, 중심 (5, 1.5, -4)m(Y-up).
    const flat = api.GetFlatMesh(model, first);
    assert.equal(flat.geometries.size(), 1);
    const placed = flat.geometries.get(0);
    const geom = api.GetGeometry(model, placed.geometryExpressID);
    const index = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
    const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
    assert.equal(index.length, 36);
    assert.equal(verts.length / 6, 36);
    const axis = (k: number) => {
      const xs: number[] = [];
      for (let i = k; i < verts.length; i += 6) xs.push(verts[i]!);
      return Math.max(...xs) - Math.min(...xs);
    };
    assert.deepEqual([axis(0), axis(1), axis(2)], [10000, 8000, 3000]);
    const t = placed.flatTransformation;
    assert.equal(t[0], 0.001);
    assert.deepEqual([t[12], t[13], t[14]], [5, 1.5, -4]);
  } finally {
    api.CloseModel(model);
  }
});

const EMOJI_GOLDEN = new URL("./golden/emoji-name.ifc", import.meta.url);

test("문자열: BMP는 X2, BMP 밖은 X4, 짝 없는 서로게이트는 U+FFFD (골든)", async () => {
  const name = "매스🏠A\uD800'\\";
  const a = exportIfc(input({ masses: [{ key: "mass-e", name, mesh: boxMesh(0, 0, 0, 1000, 1000, 1000) }] }));
  if (UPDATE) writeFileSync(EMOJI_GOLDEN, a);
  assert.equal(a, readFileSync(EMOJI_GOLDEN, "utf8"), "골든 불일치(의도한 변경이면 IFC_GOLDEN_UPDATE=1로 갱신, 이유는 커밋 본문에)");
  assert.ok(a.includes(String.raw`'\X2\B9E4C2A4\X0\\X4\0001F3E0\X0\A\X2\FFFD\X0\''\\'`));
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(a));
  try {
    const proxy = api.GetLine(model, api.GetLineIDsWithType(model, WebIFC.IFCBUILDINGELEMENTPROXY).get(0));
    assert.equal(proxy.Name.value, "매스🏠A�'\\");
  } finally {
    api.CloseModel(model);
  }
});

test("정수 mm가 아닌 꼭짓점은 거부", () => {
  const bad = { vertices: [[0, 0, 0], [1.5, 0, 0], [0, 1, 0]] as [number, number, number][], triangles: [[0, 1, 2]] as [number, number, number][] };
  assert.throws(() => exportIfc(input({ masses: [{ key: "a", mesh: bad }] })), RangeError);
  const huge = { ...bad, vertices: [[0, 0, 0], [2 ** 53, 0, 0], [0, 1, 0]] as [number, number, number][] };
  assert.throws(() => exportIfc(input({ masses: [{ key: "a", mesh: huge }] })), RangeError);
});
