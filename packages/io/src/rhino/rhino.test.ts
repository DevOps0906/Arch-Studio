// .3dm 입출력(AR-06-039 2단계): 내보내기 의미 골든(객체 수·이름·키·정점 해시), 왕복, 가져오기 단위 환산·상한·오류.
// 바이트 골든이 아닌 이유: rhino3dm이 객체 id(읽기 전용)를 무작위로, 저장 시각을 파일에 넣는다 — [DECISION] tasks/logs/AR-06-039.md.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 골든 파일을 읽고 쓴다
import { readFileSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import { boxMesh } from "../gltf/fixtures.ts";
import { ifcGuid } from "../ifc/index.ts";
import { makeFile, quadBox } from "./fixtures.ts";
import { loadKernel, loadRaw, wasmBinary } from "./node-harness.test.ts";
import { MAX_3DM_FILE_BYTES, rhinoObjectId, type Rhino3dmImportResult, type Rhino3dmKernel } from "./index.ts";
import type { RhinoModule } from "./module.ts";

// 골든 갱신: RHINO_GOLDEN_UPDATE=1 pnpm --filter ./packages/io test
const UPDATE = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RHINO_GOLDEN_UPDATE === "1";
const GOLDEN = new URL("./golden/box.semantic.json", import.meta.url);

let k: Rhino3dmKernel;
let raw: RhinoModule;
before(async () => {
  k = await loadKernel();
  raw = await loadRaw();
});

const input = () => ({
  projectId: "p-1",
  masses: [
    { key: "mass-a", name: "매스 A", mesh: boxMesh(0, 0, 0, 10000, 8000, 3000) },
    { key: "mass-b", mesh: boxMesh(12000, 0, 0, 15000, 4000, 9000) },
  ],
});

/** FNV-1a 64 → 16진 16자(의미 골든의 정점·삼각형 해시). */
function hash64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) h = ((h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}

function ok(r: Rhino3dmImportResult) {
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.status, "needs_confirmation", JSON.stringify(r));
  return r;
}

/** .3dm 바이트 → 의미 요약(바이트가 달라도 같아야 하는 것). */
function semantic(bytes: Uint8Array) {
  const r = ok(k.import3dm(bytes));
  return {
    unit: r.unit,
    objects: r.stats.objects,
    candidates: r.candidates.map((c) => ({
      name: c.name,
      key: c.source_key,
      id: c.source_id,
      closed: c.closed,
      vertices: c.mesh.vertices.length,
      triangles: c.mesh.triangles.length,
      mesh_hash: hash64(JSON.stringify(c.mesh)),
    })),
  };
}

test("결정성 스파이크 기록: 두 번 내보낸 바이트는 다를 수 있지만 의미는 같고 의미 골든과 같다", () => {
  const a = k.export3dm(input());
  const b = k.export3dm(input());
  const sa = semantic(a);
  assert.deepEqual(sa, semantic(b));
  const text = `${JSON.stringify(sa, null, 2)}\n`;
  if (UPDATE) writeFileSync(GOLDEN, text);
  assert.equal(text, readFileSync(GOLDEN, "utf8"), "의미 골든 불일치(의도한 변경이면 RHINO_GOLDEN_UPDATE=1로 갱신, 이유는 커밋 본문에)");
});

test("왕복: 정수 mm 메시가 그대로 돌아오고 사용자 문자열 키·id가 남는다", () => {
  const r = ok(k.import3dm(k.export3dm(input())));
  assert.deepEqual(r.unit, { unit: "Millimeters", source: "file", declared: "Millimeters" });
  assert.equal(r.candidates.length, 2);
  const [a, b] = r.candidates;
  assert.deepEqual(a?.mesh, input().masses[0]?.mesh);
  assert.deepEqual(b?.mesh, input().masses[1]?.mesh);
  assert.equal(a?.name, "매스 A");
  assert.equal(b?.name, "mass-b");
  assert.equal(a?.source_key, "mass-a");
  assert.equal(a?.source_id, rhinoObjectId("p-1", "mass-a"));
  assert.ok(a?.closed);
  assert.deepEqual(r.warnings, []);
});

test("rhinoObjectId는 ifcGuid와 같은 128비트 해시의 UUID 표기다", () => {
  const id = rhinoObjectId("p-1", "mass-a");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(id, rhinoObjectId("p-1", "mass-a"));
  assert.notEqual(id, rhinoObjectId("p-2", "mass-a"));
  const IFC64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let h = BigInt(`0x${id.replace(/-/g, "")}`);
  let g = "";
  for (let i = 0; i < 21; i++, h >>= 6n) g = IFC64[Number(h & 63n)] + g;
  assert.equal(IFC64[Number(h)] + g, ifcGuid("p-1", "mass-a"));
});

test("내보내기 입력 검사: 빈 목록·겹친 키·정수 아님", () => {
  assert.throws(() => k.export3dm({ projectId: "p", masses: [] }), RangeError);
  const m = boxMesh(0, 0, 0, 1000, 1000, 1000);
  assert.throws(() => k.export3dm({ projectId: "p", masses: [{ key: "a", mesh: m }, { key: "a", mesh: m }] }), RangeError);
  assert.throws(() => k.export3dm({ projectId: "p", masses: [{ key: "a", mesh: { vertices: [[0.5, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] } }] }), RangeError);
});

test("가져오기 단위 환산: m 파일 → mm 정수(반올림), 사각형 면 → 삼각형 2개", () => {
  const bytes = makeFile(raw, "Meters", [{ name: "B", ...quadBox(0, 0, 0, 10.0004, 8.0006, 3) }]);
  const r = ok(k.import3dm(bytes));
  assert.deepEqual(r.unit, { unit: "Meters", source: "file", declared: "Meters" });
  const c = r.candidates[0]!;
  assert.deepEqual(c.mesh, boxMesh(0, 0, 0, 10000, 8001, 3000));
  assert.equal(c.mesh.triangles.length, 12);
  assert.ok(c.closed);
  assert.equal(c.source_key, null);
});

test("가져오기 단위: 인치·호출자 지정 단위 우선", () => {
  const bytes = makeFile(raw, "Inches", [quadBox(0, 0, 0, 100, 10, 1)]);
  assert.deepEqual(ok(k.import3dm(bytes)).candidates[0]!.mesh, boxMesh(0, 0, 0, 2540, 254, 25));
  const r = ok(k.import3dm(bytes, { unit: "Millimeters" }));
  assert.deepEqual(r.unit, { unit: "Millimeters", source: "caller", declared: "Inches" });
  assert.deepEqual(r.candidates[0]!.mesh, boxMesh(0, 0, 0, 100, 10, 1));
});

test("단위 없음(None) → needs_unit(AR053), 단위를 주면 후보", () => {
  const bytes = makeFile(raw, "None", [quadBox(0, 0, 0, 10, 10, 10)]);
  const r = k.import3dm(bytes);
  assert.ok(r.ok && r.status === "needs_unit", JSON.stringify(r));
  assert.equal(r.code, "AR053");
  assert.equal(r.declared, "None");
  assert.deepEqual(ok(k.import3dm(bytes, { unit: "Meters" })).candidates[0]!.mesh, boxMesh(0, 0, 0, 10000, 10000, 10000));
});

test("메시가 아닌 객체는 AR054 경고로 세고, 메시가 없으면 R3DM_EMPTY", () => {
  const mixed = makeFile(raw, "Millimeters", [quadBox(0, 0, 0, 10, 10, 10)], (f) => {
    f.objects().addPointXYZ(1, 2, 3);
    f.objects().addPointXYZ(4, 5, 6);
  });
  const r = ok(k.import3dm(mixed));
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0]!.index, 0);
  assert.equal(r.warnings[0]?.code, "AR054");
  assert.deepEqual(r.warnings[0]?.skipped_objects, { Point: 2 });
  const none = makeFile(raw, "Millimeters", [], (f) => f.objects().addPointXYZ(1, 2, 3));
  const e = k.import3dm(none);
  assert.ok(!e.ok && e.error.code === "R3DM_EMPTY", JSON.stringify(e));
});

test("좌표 범위: mm 환산 뒤 ±10km 초과면 R3DM_COORD_OUT_OF_RANGE", () => {
  const bytes = makeFile(raw, "Kilometers", [quadBox(0, 0, 0, 10.5, 1, 1)]);
  const r = k.import3dm(bytes);
  assert.ok(!r.ok && r.error.code === "R3DM_COORD_OUT_OF_RANGE", JSON.stringify(r));
});

test("퇴화: 반올림 뒤 삼각형이 없는 메시는 후보에서 빠진다", () => {
  const bytes = makeFile(raw, "Meters", [{ vertices: [[0, 0, 0], [0.0001, 0, 0], [0, 0.0001, 0]], faces: [[0, 1, 2]] }, quadBox(0, 0, 0, 1, 1, 1)]);
  const r = ok(k.import3dm(bytes));
  assert.equal(r.stats.degenerate_meshes, 1);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0]!.index, 1);
});

test("상한: 크기(AR055)·객체 수·꼭짓점 수, 올릴 수는 없음", () => {
  const bytes = k.export3dm(input());
  let r = k.import3dm(bytes, { limits: { max_file_bytes: bytes.length - 1 } });
  assert.ok(!r.ok && r.error.code === "AR055" && r.error.limit === bytes.length - 1, JSON.stringify(r));
  r = k.import3dm(new Uint8Array(MAX_3DM_FILE_BYTES + 1), { limits: { max_file_bytes: MAX_3DM_FILE_BYTES * 4 } });
  assert.ok(!r.ok && r.error.code === "AR055" && r.error.limit === MAX_3DM_FILE_BYTES, JSON.stringify(r));
  r = k.import3dm(bytes, { limits: { max_objects: 1 } });
  assert.ok(!r.ok && r.error.code === "R3DM_TOO_MANY_OBJECTS", JSON.stringify(r));
  r = k.import3dm(bytes, { limits: { max_total_vertices: 15 } });
  assert.ok(!r.ok && r.error.code === "R3DM_TOO_MANY_VERTICES", JSON.stringify(r));
  r = k.import3dm(bytes, { limits: { max_total_faces: 23 } });
  assert.ok(!r.ok && r.error.code === "R3DM_TOO_MANY_FACES" && r.error.limit === 23, JSON.stringify(r));
});

test("wasm 메모리 상한: 넘으면 discard_kernel, 메모리 증가량은 통계에 남는다", () => {
  const bytes = k.export3dm(input());
  const r = k.import3dm(bytes, { limits: { max_wasm_memory_bytes: 1 } });
  assert.ok(!r.ok && r.error.code === "R3DM_MEMORY_LIMIT" && r.error.discard_kernel === true, JSON.stringify(r));
  const s = ok(k.import3dm(bytes));
  assert.ok(Number.isSafeInteger(s.stats.wasm_memory_growth) && s.stats.wasm_memory_growth >= 0);
  assert.ok(k.memoryBytes() > 0);
});

test("호출 인자 오류는 구조화 결과(예외 아님)", () => {
  let r = k.import3dm("abc" as unknown as Uint8Array);
  assert.ok(!r.ok && r.error.code === "R3DM_INVALID_OPTION");
  r = k.import3dm(new Uint8Array(10), { unit: "Furlongs" as "Meters" });
  assert.ok(!r.ok && r.error.code === "R3DM_INVALID_OPTION");
  r = k.import3dm(new Uint8Array(0));
  assert.ok(!r.ok && r.error.code === "R3DM_MALFORMED", JSON.stringify(r));
});

test("wasm 실측 크기(로그 기록용)", () => {
  const n = wasmBinary().length;
  assert.ok(n > 1_000_000 && n < 10_000_000, String(n));
  console.log(JSON.stringify({ rhino3dm_wasm_bytes: n, kernel_memory_bytes: k.memoryBytes() }));
});
