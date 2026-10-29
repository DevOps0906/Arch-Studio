// 스파이크(버리는 코드): 드래그 증분에서 엔벨로프 복잡도가 지배적인지 확인. 드래그 시작 때 엔벨로프를 매스 주변 상자(여유 10m)로 한 번 잘라 두고
// 프레임마다 (매스 − 잘린 엔벨로프)만 계산한다. 매스가 상자를 벗어나면 다시 자른다(측정에서는 왕복 범위 안이라 1회).
import Module from "manifold-3d";
import { loadSolidKernel } from "../../../packages/geometry/src/solid/kernel.ts";
import { envelopeManifold, massManifold, rawMesh } from "../src/geom/core.ts";
import { exampleEnvelope } from "../src/geom/envelope-input.ts";
import { makeMasses, PRESETS, stats } from "../src/geom/scene.ts";

const wasm = await Module();
wasm.setup();
const env = envelopeManifold(wasm, exampleEnvelope(await loadSolidKernel(), 0, "blob").solid);
env.numTri();
for (const name of ["S50", "S200k"]) {
  const spec = makeMasses(PRESETS.find((p) => p.name === name)!)[0]!;
  const own: { delete(): void }[] = [];
  const m = massManifold(wasm, spec, own);
  m.numTri();
  const bb = m.boundingBox();
  const margin = 10000;
  let t0 = performance.now();
  const box = wasm.Manifold.cube([bb.max[0] - bb.min[0] + 2 * margin, bb.max[1] - bb.min[1] + 2 * margin, 40000]).translate([bb.min[0] - margin, bb.min[1] - margin, -1000]);
  const crop = env.intersect(box);
  const cropTris = crop.numTri();
  const cropMs = performance.now() - t0;
  const full: number[] = [];
  const cropped: number[] = [];
  for (let f = 0; f < 61; f++) {
    const d = (f % 20) * 400; // 0~8m 왕복(상자 안)
    t0 = performance.now();
    const a = m.translate([d, 0, 0]);
    const ea = a.subtract(env);
    rawMesh(ea);
    const tf = performance.now() - t0;
    t0 = performance.now();
    const b = m.translate([d, 0, 0]);
    const eb = b.subtract(crop);
    rawMesh(eb);
    const tc = performance.now() - t0;
    if (f > 0) {
      full.push(tf);
      cropped.push(tc);
    }
    if (Math.abs(ea.volume() - eb.volume()) > 1e3) console.warn("부피 차이", ea.volume(), eb.volume());
    [a, ea, b, eb].forEach((x) => x.delete());
  }
  console.log(JSON.stringify({ preset: name, env_tris: env.numTri(), crop_tris: cropTris, crop_once_ms: Math.round(cropMs * 10) / 10, excess_full_env_ms: stats(full), excess_cropped_env_ms: stats(cropped) }));
  [box, crop, ...own].forEach((x) => x.delete());
}
