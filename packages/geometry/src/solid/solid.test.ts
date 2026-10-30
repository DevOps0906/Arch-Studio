// 솔리드 래퍼 테스트(AR-06-016): 정수 경계, 2D 차집합, 압출·볼록 껍질·불리언 부피, 정규화 결정성, 입력 거부, 초월함수 미사용.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 소스 검사용 파일 읽기(테스트 전용)
import { readdirSync, readFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { before, test } from "node:test";
import type { Polygon } from "@arch-studio/domain";
import {
  GeometryError,
  SolidError,
  area,
  canonicalMesh,
  closeMesh,
  closedMeshIssue,
  loadSolidKernel,
  meshVolume,
  meshVolume6,
  volumeToString,
  type Point3,
  type SolidKernel,
  type SolidNode,
} from "../index.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
});
const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): SolidNode => ({
  op: "extrude",
  region: { op: "polygons", polygons: [rect(x0, y0, x1, y1)] },
  z0,
  z1,
});

let k: SolidKernel;
before(async () => {
  k = await loadSolidKernel(); // WASM 비동기 초기화
});

test("2D 차집합: 구멍 있는 정수 다각형(외곽 반시계·구멍 시계)", () => {
  const out = k.region({ op: "subtract", base: { op: "polygons", polygons: [rect(0, 0, 100, 100)] }, minus: [{ op: "polygons", polygons: [rect(30, 30, 60, 60)] }] });
  assert.deepEqual(out, [
    {
      outer: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      holes: [
        [
          [30, 30],
          [30, 60],
          [60, 60],
          [60, 30],
        ],
      ],
    },
  ]);
  assert.deepEqual(k.region({ op: "union", children: [] }), []);
  const inter = k.region({ op: "intersect", children: [{ op: "polygons", polygons: [rect(0, 0, 10, 10)] }, { op: "polygons", polygons: [rect(5, 5, 20, 20)] }] });
  assert.equal(area(inter[0] as Polygon), 25);
});

test("2D 결과 좌표는 정수(반올림 경계)", () => {
  const tri: Polygon = { outer: [[0, 0], [7, 0], [0, 3]] };
  const out = k.region({ op: "subtract", base: { op: "polygons", polygons: [rect(0, 0, 10, 10)] }, minus: [{ op: "polygons", polygons: [tri, rect(4, 4, 9, 9)] }] });
  for (const p of out) for (const r of [p.outer, ...(p.holes ?? [])]) for (const [x, y] of r) assert.ok(Number.isInteger(x) && Number.isInteger(y));
});

test("압출·불리언·볼록 껍질 부피(정확한 정수)", () => {
  assert.equal(meshVolume(k.solid(box(0, 0, 100, 200, 10, 40))), BigInt(100 * 200 * 30));
  const u = k.solid({ op: "union", children: [box(0, 0, 10, 10, 0, 10), box(5, 0, 15, 10, 0, 10)] });
  assert.equal(meshVolume(u), 1500n);
  const d = k.solid({ op: "subtract", base: box(0, 0, 10, 10, 0, 10), minus: [box(0, 0, 5, 10, 0, 10)] });
  assert.equal(meshVolume(d), 500n);
  const h = k.solid({ op: "hull", points: [[0, 0, 0], [6, 0, 0], [0, 6, 0], [0, 0, 6]] });
  assert.equal(meshVolume(h), 36n);
  assert.deepEqual(k.solid({ op: "union", children: [] }), { vertices: [], triangles: [] });
});

test("같은 입력 같은 바이트(자식 순서가 바뀌면 꼭짓점·부피는 같고 삼각분할은 다를 수 있다)", () => {
  const a = k.solid({ op: "union", children: [box(0, 0, 10, 10, 0, 10), box(5, 3, 15, 13, 2, 12)] });
  const b = k.solid({ op: "union", children: [box(5, 3, 15, 13, 2, 12), box(0, 0, 10, 10, 0, 10)] });
  assert.deepEqual(a.vertices, b.vertices);
  assert.equal(meshVolume(a), meshVolume(b));
  assert.equal(JSON.stringify(a), JSON.stringify(k.solid({ op: "union", children: [box(0, 0, 10, 10, 0, 10), box(5, 3, 15, 13, 2, 12)] })));
});

test("extrude divisions(AR-06-036): 부피는 같고 층 경계 꼭짓점이 생긴다, 범위 밖 거부", () => {
  const plain = k.solid(box(0, 0, 1000, 2000, 0, 9000));
  const div: SolidNode = { op: "extrude", region: { op: "polygons", polygons: [rect(0, 0, 1000, 2000)] }, z0: 0, z1: 9000, divisions: 2 };
  const d = k.solid(div);
  assert.equal(meshVolume(d), meshVolume(plain));
  const zs = new Set(d.vertices.map((v) => v[2]));
  assert.deepEqual([...zs].sort((a, b) => a - b), [0, 3000, 6000, 9000]);
  assert.throws(() => k.solid({ ...div, divisions: -1 }), (e: unknown) => e instanceof GeometryError && e.code === "INVALID_ARGUMENT");
  assert.throws(() => k.solid({ ...div, divisions: 1.5 }), (e: unknown) => e instanceof GeometryError);
});

test("mesh 식(AR-06-036): 정수 메시를 다시 불리언에 쓴다, 열린 메시·번호 범위 밖 거부", () => {
  const env = k.solid(box(0, 0, 100, 100, 0, 100));
  const cut = k.solid({ op: "subtract", base: box(50, 0, 150, 100, 0, 50), minus: [{ op: "mesh", mesh: env }] });
  assert.equal(meshVolume(cut), BigInt(50 * 100 * 50));
  assert.deepEqual(k.solid({ op: "mesh", mesh: { vertices: [], triangles: [] } }), { vertices: [], triangles: [] });
  assert.throws(() => k.solid({ op: "mesh", mesh: { vertices: [[0, 0, 0]], triangles: [[0, 0, 5]] } }), (e: unknown) => e instanceof GeometryError);
  const open = { vertices: env.vertices, triangles: env.triangles.slice(1) };
  assert.throws(() => k.solid({ op: "mesh", mesh: open }), (e: unknown) => e instanceof GeometryError);
});

test("renderMeshes(AR-06-036): Float32 버퍼(정규화 없음), 공유 하위 식, 같은 입력 같은 버퍼", () => {
  const env: SolidNode = { op: "mesh", mesh: k.solid(box(0, 0, 100, 100, 0, 100)) };
  const nodes: SolidNode[] = [
    { op: "subtract", base: box(50, 0, 150, 100, 0, 50), minus: [env] },
    { op: "subtract", base: box(10, 10, 20, 20, 0, 10), minus: [env] },
    box(0, 0, 10, 10, 0, 10),
  ];
  const out = k.renderMeshes(nodes);
  assert.equal(out.length, 3);
  const [a, b, c] = out as [{ positions: Float32Array; index: Uint32Array }, { positions: Float32Array; index: Uint32Array }, { positions: Float32Array; index: Uint32Array }];
  assert.ok(a.positions instanceof Float32Array && a.index instanceof Uint32Array);
  assert.ok(a.index.length > 0 && a.index.length % 3 === 0);
  for (let i = 0; i < a.positions.length; i += 3) assert.ok((a.positions[i] as number) >= 100 - 1e-3, "엔벨로프 밖 부분만 남는다");
  assert.equal(b.index.length, 0, "완전히 안쪽인 매스는 초과분 없음");
  assert.equal(c.index.length, 12 * 3);
  const again = k.renderMeshes(nodes);
  assert.deepEqual([...again[0]!.positions], [...a.positions]);
  assert.deepEqual([...again[0]!.index], [...a.index]);
  // 전송용 자기 버퍼(WASM 힙 뷰가 아님)
  assert.equal(a.positions.byteOffset, 0);
  assert.equal(a.positions.buffer.byteLength, a.positions.byteLength);
});

test("부피는 bigint: safe int를 넘는 1km×1km×30m도 정확, 문자열 직렬화", () => {
  const v = meshVolume(k.solid(box(0, 0, 1_000_000, 1_000_000, 0, 30_000)));
  assert.equal(v, 30_000_000_000_000_000n);
  assert.equal(volumeToString(v), "30000000000000000");
});

test("closeMesh: 일직선(면적 0) 삼각형 제거 + 맞은편 삼각형 분할로 닫힘 유지", () => {
  // 사면체 ABCD의 변 AB 가운데 M을 옆면에만 넣고, 틈을 면적 0 삼각형 (A,B,M)으로 메운 메시
  const A: Point3 = [0, 0, 0];
  const B: Point3 = [2, 0, 0];
  const C: Point3 = [0, 2, 0];
  const D: Point3 = [0, 0, 2];
  const M: Point3 = [1, 0, 0];
  const raw = canonicalMesh([A, B, C, D, M], [
    [0, 2, 1],
    [0, 4, 3],
    [4, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
    [0, 1, 4],
  ]);
  assert.equal(closedMeshIssue(raw), null); // 닫혀 있지만 퇴화 면이 있다
  const fixed = closeMesh(raw);
  assert.equal(closedMeshIssue(fixed), null);
  assert.equal(fixed.triangles.length, 6);
  assert.equal(meshVolume6(fixed), 8n); // 부피 ×6 = 8 그대로
});

test("closeMesh: 닫히지 않은 메시(면 빠진 사면체)는 SOLID_DEGENERATE", () => {
  const open = canonicalMesh([[0, 0, 0], [2, 0, 0], [0, 2, 0], [0, 0, 2]], [[0, 2, 1], [0, 1, 3], [0, 3, 2]]);
  assert.throws(() => closeMesh(open), (e: unknown) => e instanceof SolidError && e.code === "SOLID_DEGENERATE");
  // 면적 0 삼각형을 지운 뒤 맞은편 면이 없으면 닫힘이 깨진다 → 오류
  const sliverOnly = canonicalMesh([[0, 0, 0], [2, 0, 0], [1, 0, 0], [0, 2, 0]], [[0, 1, 2], [0, 3, 1]]);
  assert.throws(() => closeMesh(sliverOnly), (e: unknown) => e instanceof SolidError && e.code === "SOLID_DEGENERATE");
});

test("정수화 퇴화 회귀: 정수 사면체 × 얇은 상자 — 정리 후 항상 닫힘·면적 0 삼각형 없음", () => {
  const thin = (z0: number): SolidNode => box(-30, -30, 30, 30, z0, z0 + 1);
  // 재현 사례(정수화 뒤 같은 정수점으로 합쳐지는 꼭짓점이 생김) → 닫힌 메시
  const pinch = k.solid({ op: "intersect", children: [{ op: "hull", points: [[-11, -10, -9], [5, 2, 12], [-12, -13, 6], [-14, -13, -9]] }, thin(-2)] });
  assert.equal(closedMeshIssue(pinch), null);
  // 무작위 600건: 돌려준 메시는 항상 닫혀 있고 면적 0 삼각형이 없다
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  for (let i = 0; i < 600; i++) {
    const pts = Array.from({ length: 4 }, () => [rnd(41) - 20, rnd(41) - 20, rnd(41) - 20] as [number, number, number]);
    const m = k.solid({ op: "intersect", children: [{ op: "hull", points: pts }, thin(rnd(21) - 10)] });
    assert.equal(closedMeshIssue(m), null, JSON.stringify(pts));
    for (const [a, b, c] of m.triangles) {
      const [p, q, r] = [m.vertices[a], m.vertices[b], m.vertices[c]] as [Point3, Point3, Point3];
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      assert.ok(n.some((x) => x !== 0), "면적 0 삼각형");
    }
  }
});

test("canonicalMesh: 중복 꼭짓점 합침·퇴화 삼각형 제거·정렬", () => {
  const m = canonicalMesh(
    [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
    [
      [0, 2, 1],
      [1, 3, 2],
    ],
  );
  assert.deepEqual(m, {
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ],
    triangles: [[0, 2, 1]],
  });
});

test("입력 거부: 소수 좌표·범위 밖·높이 0", () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof GeometryError) return e.code;
      throw e;
    }
    return "none";
  };
  assert.equal(code(() => k.region({ op: "polygons", polygons: [rect(0, 0, 10.5, 10)] })), "INVALID_COORDINATE");
  assert.equal(code(() => k.solid({ op: "hull", points: [[0, 0, 0.5], [1, 0, 0], [0, 1, 0], [0, 0, 1]] })), "INVALID_COORDINATE");
  assert.equal(code(() => k.solid(box(0, 0, 10, 10, 0, 20_000_000))), "OUT_OF_RANGE");
  assert.equal(code(() => k.solid(box(0, 0, 10, 10, 5, 5))), "INVALID_ARGUMENT");
});

test("초월함수 미사용: solid 소스의 Math는 허용 목록만, ** 없음", () => {
  const dir = new URL(".", import.meta.url);
  const allowed = new Set(["sqrt", "abs", "trunc", "sign", "min", "max", "floor"]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  assert.ok(files.length >= 3);
  for (const f of files) {
    readFileSync(new URL(f, dir), "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const codePart = line.replace(/\/\/.*$/, "").replace(/^\s*\/?\*.*$/, "");
        const where = `${f}:${i + 1}: ${line.trim()}`;
        assert.equal(/\*\*/.test(codePart), false, where);
        for (const m of codePart.matchAll(/\bMath\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g)) assert.ok(m[2] !== undefined && allowed.has(m[2]), where);
      });
  }
});
