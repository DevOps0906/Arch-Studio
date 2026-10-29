// 스파이크(버리는 코드): 지오메트리 워커(모듈 워커, 별도 파일 — blob: URL 없음). engine.worker의 judge 레인 흉내.
// 메시지: init → scene(장면 메시 생성, Transferable) / bench(지오메트리 벤치) / echo(전송 비용) / drag(최신만 유효 증분 재계산)
import Module, { type Manifold, type ManifoldToplevel } from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { envelopeManifold, fallbackEnvelope, massManifold, rawMesh, runGeomBench, sceneMeshes } from "./core.ts";
import { makeMasses, PRESETS, stats } from "./scene.ts";

type Req =
  | { op: "init" }
  | { op: "scene"; preset: string }
  | { op: "envelope_mesh" }
  | { op: "bench"; n: number }
  | { op: "echo"; positions: Float32Array; index: Uint32Array; t_send: number; transfer: boolean }
  | { op: "drag"; seq: number; preset: string; mass: number; dx: number; dy: number };

let wasm: ManifoldToplevel | null = null;
let env: Manifold | null = null;
let envSource = "fallback";
const info: Record<string, unknown> = {};
let dragCache: { preset: string; mass: number; m: Manifold; own: { delete(): void }[] } | null = null;

async function init() {
  if (wasm) return info;
  let t0 = performance.now();
  wasm = await Module({ locateFile: () => wasmUrl });
  wasm.setup();
  info.init_ms = performance.now() - t0;
  t0 = performance.now();
  try {
    // packages/rules buildEnvelope(가짜 팩)을 워커에서 그대로 돌린다(엔진 워커와 같은 위치)
    const [{ loadSolidKernel }, { exampleEnvelope }] = await Promise.all([
      import("../../../../packages/geometry/src/solid/kernel.ts"),
      import("./envelope-input.ts"),
    ]);
    const kernel = await loadSolidKernel({ locateFile: () => wasmUrl });
    info.kernel_init_ms = performance.now() - t0;
    const ts: number[] = [];
    let out = exampleEnvelope(kernel, 0, "blob");
    for (let i = 0; i < 30; i++) {
      const t1 = performance.now();
      out = exampleEnvelope(kernel, i + 1, "blob");
      ts.push(performance.now() - t1);
    }
    out = exampleEnvelope(kernel, 0, "blob");
    info.envelope_ms = stats(ts);
    info.envelope_tris = out.solid.triangles.length;
    env = envelopeManifold(wasm, out.solid);
    envSource = "rules.buildEnvelope(가짜 팩, 요철 200각형 대지)";
  } catch (e) {
    info.envelope_error = String(e);
    env = fallbackEnvelope(wasm);
  }
  info.env_source = envSource;
  return info;
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<Req>) => {
  const r = ev.data;
  try {
    switch (r.op) {
      case "init":
        post({ op: "init", info: await init() });
        return;
      case "scene": {
        await init();
        const p = PRESETS.find((x) => x.name === r.preset)!;
        const t0 = performance.now();
        const meshes = sceneMeshes(wasm!, p);
        const ms = performance.now() - t0;
        post({ op: "scene", preset: r.preset, meshes, build_ms: ms }, meshes.flatMap((m) => [m.positions.buffer, m.index.buffer]));
        return;
      }
      case "envelope_mesh": {
        await init();
        const m = rawMesh(env!);
        post({ op: "envelope_mesh", mesh: m, source: envSource }, [m.positions.buffer, m.index.buffer]);
        return;
      }
      case "bench": {
        await init();
        const res = runGeomBench(wasm!, env!, { now: () => performance.now(), n: r.n });
        post({ op: "bench", result: res });
        return;
      }
      case "echo": {
        // 받은 버퍼를 그대로 돌려준다(Transferable이면 소유권 이동, 아니면 구조적 복제)
        post(
          { op: "echo", positions: r.positions, index: r.index, t_send: r.t_send, t_worker: performance.now() },
          r.transfer ? [r.positions.buffer, r.index.buffer] : [],
        );
        return;
      }
      case "drag": {
        await init();
        if (!dragCache || dragCache.preset !== r.preset || dragCache.mass !== r.mass) {
          for (const o of dragCache?.own ?? []) o.delete();
          const own: { delete(): void }[] = [];
          const spec = makeMasses(PRESETS.find((x) => x.name === r.preset)!)[r.mass]!;
          const m = massManifold(wasm!, spec, own);
          m.numTri();
          dragCache = { preset: r.preset, mass: r.mass, m, own };
        }
        const t0 = performance.now();
        const mv = dragCache.m.translate([r.dx, r.dy, 0]);
        const exc = mv.subtract(env!);
        const inside = mv.intersect(env!);
        const excVol = exc.volume();
        const insVol = inside.volume();
        const excess = rawMesh(exc);
        mv.delete();
        exc.delete();
        inside.delete();
        post(
          { op: "drag", seq: r.seq, excess, excess_volume_mm3: excVol, inside_volume_mm3: insVol, compute_ms: performance.now() - t0 },
          [excess.positions.buffer, excess.index.buffer],
        );
        return;
      }
    }
  } catch (e) {
    post({ op: "error", detail: String(e), stack: (e as Error).stack });
  }
};
