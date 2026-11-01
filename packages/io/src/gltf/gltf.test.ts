// glTF 내보내기(AR-06-039): 결정성(바이트 동일·골든), 좌표 변환(mm→m, Z-up→Y-up), accessor min/max, 면별 정점 분리.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽고 쓴다
import { readFileSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import { boxMesh } from "./fixtures.ts";
import { GLTF_GENERATOR, exportGltf } from "./index.ts";

// 골든 갱신: GLTF_GOLDEN_UPDATE=1 pnpm --filter ./packages/io test
const UPDATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GLTF_GOLDEN_UPDATE === "1";
const GOLDEN = new URL("./golden/box.gltf", import.meta.url);
const input = () => ({ masses: [{ key: "mass-a", name: "매스 A", mesh: boxMesh(0, 0, 0, 10000, 8000, 3000) }] });

interface Doc {
  asset: { version: string; generator: string };
  accessors: { count: number; min?: number[]; max?: number[]; bufferView: number }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
  buffers: { byteLength: number; uri: string }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
}

function floats(doc: Doc, accessor: number): number[] {
  const uri = doc.buffers[0]!.uri;
  const bytes = Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");
  assert.equal(bytes.length, doc.buffers[0]!.byteLength);
  const bv = doc.bufferViews[doc.accessors[accessor]!.bufferView]!;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + bv.byteOffset, bv.byteLength);
  return Array.from({ length: bv.byteLength / 4 }, (_, i) => dv.getFloat32(i * 4, true));
}

test("두 번 내보내면 바이트가 같고 골든과 같다", () => {
  const a = exportGltf(input());
  assert.equal(a, exportGltf(input()));
  if (UPDATE) writeFileSync(GOLDEN, a);
  assert.equal(a, readFileSync(GOLDEN, "utf8"), "골든 불일치(의도한 변경이면 GLTF_GOLDEN_UPDATE=1로 갱신, 이유는 커밋 본문에)");
});

test("asset·면별 정점 분리·mm→m·Z-up→Y-up·min/max", () => {
  const doc = JSON.parse(exportGltf(input())) as Doc;
  assert.deepEqual(doc.asset, { version: "2.0", generator: GLTF_GENERATOR });
  const attrs = doc.meshes[0]!.primitives[0]!.attributes;
  const pos = doc.accessors[attrs.POSITION!]!;
  assert.equal(pos.count, 12 * 3);
  assert.deepEqual(pos.min, [0, 0, -8]);
  assert.deepEqual(pos.max, [10, 3, 0]);
  const p = floats(doc, attrs.POSITION!);
  for (let i = 0; i < p.length; i += 3) {
    assert.ok([0, 10].includes(p[i]!) && [0, 3].includes(p[i + 1]!) && [0, -8].includes(p[i + 2]!));
  }
  const n = floats(doc, attrs.NORMAL!);
  assert.equal(n.length, p.length);
  for (let i = 0; i < n.length; i += 3) assert.equal(Math.abs(n[i]!) + Math.abs(n[i + 1]!) + Math.abs(n[i + 2]!), 1);
  // 면 법선이 바깥(상자 중심 반대)을 향한다: 중심 (5, 1.5, -4).
  for (let t = 0; t < p.length; t += 9) {
    const cx = (p[t]! + p[t + 3]! + p[t + 6]!) / 3 - 5;
    const cy = (p[t + 1]! + p[t + 4]! + p[t + 7]!) / 3 - 1.5;
    const cz = (p[t + 2]! + p[t + 5]! + p[t + 8]!) / 3 + 4;
    assert.ok(cx * n[t]! + cy * n[t + 1]! + cz * n[t + 2]! > 0);
  }
});

test("매스 둘 → 노드 둘, 빈 입력은 거부", () => {
  const doc = JSON.parse(
    exportGltf({ masses: [...input().masses, { key: "mass-b", mesh: boxMesh(0, 0, 3000, 5000, 5000, 6000) }] }),
  ) as Doc & { nodes: unknown[] };
  assert.equal(doc.nodes.length, 2);
  assert.throws(() => exportGltf({ masses: [] }), RangeError);
});

test("정수 mm가 아닌 꼭짓점은 거부", () => {
  const bad = { vertices: [[0, 0, 0], [1.5, 0, 0], [0, 1, 0]] as [number, number, number][], triangles: [[0, 1, 2]] as [number, number, number][] };
  assert.throws(() => exportGltf({ masses: [{ key: "a", mesh: bad }] }), RangeError);
  assert.throws(() => exportGltf({ masses: [{ key: "a", mesh: { ...bad, vertices: [[0, 0, 0], [NaN, 0, 0], [0, 1, 0]] } }] }), RangeError);
});
