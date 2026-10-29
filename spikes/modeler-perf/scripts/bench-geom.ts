// 스파이크(버리는 코드): Node 지오메트리 벤치. (a) WASM 초기화 (b) 엔벨로프 (c) 불린·삼각형 수 (d) 드래그 증분 + 정수 정규화 비용.
// 실행: pnpm bench:geom  → 결과 JSON을 out/geom-node.json에 쓴다(out/은 gitignore).
import { cpus, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "manifold-3d";
import { loadSolidKernel } from "../../../packages/geometry/src/solid/kernel.ts";
import { canonicalMesh, closeMesh } from "../../../packages/geometry/src/solid/mesh.ts";
import { envelopeManifold, massManifold, rawMesh, runGeomBench } from "../src/geom/core.ts";
import { exampleEnvelope } from "../src/geom/envelope-input.ts";
import { makeMasses, PRESETS, stats } from "../src/geom/scene.ts";

const N = 30;
const now = () => performance.now();
const result: Record<string, unknown> = {
  env: { cpu: cpus()[0]?.model, cores: cpus().length, ram_gb: Math.round(totalmem() / 2 ** 30), node: process.version, runtime: "node" },
};

// (a) WASM 초기화: 첫 회(컴파일 포함)와 이후(같은 프로세스, 인스턴스 새로 생성)
{
  let t0 = now();
  const first = await Module();
  first.setup();
  const cold = now() - t0;
  const warm: number[] = [];
  for (let i = 0; i < N; i++) {
    t0 = now();
    const w = await Module();
    w.setup();
    warm.push(now() - t0);
  }
  result.init = { cold_ms: Math.round(cold * 10) / 10, warm_ms: stats(warm) };
  console.log("init", result.init);
}

const wasm = await Module();
wasm.setup();
const kernel = await loadSolidKernel();

// (b) 엔벨로프 솔리드 생성(packages/rules buildEnvelope, 가짜 팩). rect = 100m×60m 직사각형, blob = 요철 200각형(불린 입력으로 씀)
{
  const env: Record<string, unknown> = {};
  for (const site of ["rect", "blob"] as const) {
    const ts: number[] = [];
    exampleEnvelope(kernel, 0, site);
    for (let i = 0; i < N; i++) {
      const t0 = now();
      exampleEnvelope(kernel, i + 1, site); // 정북 각도를 바꿔 캐시 효과 제거
      ts.push(now() - t0);
    }
    const out = exampleEnvelope(kernel, 0, site);
    env[site] = { ms: stats(ts), verts: out.solid.vertices.length, tris: out.solid.triangles.length, top_mm: out.top_mm };
    if (site === "blob") (globalThis as { __env?: unknown }).__env = out.solid;
  }
  result.envelope = env;
  console.log("envelope", env);
}
const envInt = (globalThis as { __env?: { vertices: [number, number, number][]; triangles: [number, number, number][] } }).__env!;
const env = envelopeManifold(wasm, envInt);

// (c)(d) 불린·드래그
const geo = runGeomBench(wasm, env, { now, n: N, log: (s) => console.log(s) });
result.booleans = geo.presets;
result.drag = geo.drag;

// 정수 정규화 비용(canonicalMesh + closeMesh): 판정·도면용 결정적 메시가 드래그 중에 필요한가 판단용
{
  const rows: unknown[] = [];
  for (const name of ["S50", "S200k"]) {
    const p = PRESETS.find((x) => x.name === name)!;
    const own: { delete(): void }[] = [];
    const ms = makeMasses(p).map((s) => massManifold(wasm, s, own));
    const u = wasm.Manifold.union(ms);
    const ex = u.subtract(env);
    const ts: number[] = [];
    const reps = name === "S200k" ? 10 : N;
    let triCount = 0;
    for (let i = 0; i < reps; i++) {
      const t0 = now();
      const r = rawMesh(u);
      const verts: [number, number, number][] = [];
      for (let j = 0; j < r.positions.length; j += 3) verts.push([Math.round(r.positions[j]!), Math.round(r.positions[j + 1]!), Math.round(r.positions[j + 2]!)]);
      const tris: [number, number, number][] = [];
      for (let j = 0; j < r.index.length; j += 3) tris.push([r.index[j]!, r.index[j + 1]!, r.index[j + 2]!]);
      const c = closeMesh(canonicalMesh(verts, tris));
      triCount = c.triangles.length;
      ts.push(now() - t0);
    }
    rows.push({ preset: name, tris: triCount, normalize_ms: stats(ts), excess_tris: ex.numTri() });
    ex.delete();
    u.delete();
    for (const o of own) o.delete();
  }
  result.normalize = rows;
  console.log("normalize", rows);
}

if (typeof globalThis.gc === "function") globalThis.gc();
result.mem = process.memoryUsage();
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/geom-node.json", import.meta.url), JSON.stringify(result, null, 2));
console.log("→ out/geom-node.json");
