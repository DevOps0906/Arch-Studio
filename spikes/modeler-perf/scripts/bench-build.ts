// 스파이크(버리는 코드): 매스 솔리드 만드는 방식별 비용. bench-geom에서 "층별 압출 → union"이 매스당 3.7ms(12각형)~300ms(340각형)로 비싸게 나와 대안을 잰다.
// (1) 층별 extrude + union(현재 core.massManifold) (2) extrude 1회 + nDivisions(층 경계 꼭짓점 유지) (3) extrude 1회(층 구분 없음)
// (4) three ExtrudeGeometry(렌더 전용, Manifold 없음)  (5) 이미 만든 매스에서 매스 − 엔벨로프(드래그 1프레임)를 방식별로
import Module from "manifold-3d";
import * as THREE from "three";
import { massManifold, fallbackEnvelope } from "../src/geom/core.ts";
import { makeMasses, PRESETS, stats } from "../src/geom/scene.ts";
import { mkdirSync, writeFileSync } from "node:fs";

const wasm = await Module();
wasm.setup();
const env = fallbackEnvelope(wasm);
env.numTri();
const now = () => performance.now();
const out: Record<string, unknown>[] = [];
for (const name of ["S50", "S50-k64", "S200k"]) {
  const p = PRESETS.find((x) => x.name === name)!;
  const specs = makeMasses(p);
  const reps = name === "S200k" ? 10 : 30;
  const res: Record<string, unknown> = { preset: name, reps };
  const variants: Record<string, (s: (typeof specs)[number], own: { delete(): void }[]) => { numTri(): number }> = {
    floor_union: (s, own) => {
      (globalThis as { __MASS_MODE?: string }).__MASS_MODE = "floor_union";
      try {
        return massManifold(wasm, s, own);
      } finally {
        delete (globalThis as { __MASS_MODE?: string }).__MASS_MODE;
      }
    },
    extrude_ndiv: (s, own) => {
      const cs = new wasm.CrossSection([s.footprint], "Positive");
      own.push(cs);
      const h = s.floors.reduce((a, f) => a + f.height_mm, 0);
      const m = cs.extrude(h, s.floors.length - 1);
      own.push(m);
      return m;
    },
    extrude_once: (s, own) => {
      const cs = new wasm.CrossSection([s.footprint], "Positive");
      own.push(cs);
      const m = cs.extrude(s.floors.reduce((a, f) => a + f.height_mm, 0));
      own.push(m);
      return m;
    },
  };
  for (const [vn, fn] of Object.entries(variants)) {
    const ts: number[] = [];
    const drag: number[] = [];
    let tris = 0;
    for (let i = 0; i < reps + 1; i++) {
      const own: { delete(): void }[] = [];
      const t0 = now();
      const ms = specs.map((s) => fn(s, own));
      tris = ms.reduce((a, m) => a + m.numTri(), 0);
      const dt = now() - t0;
      // 매스 0 한 프레임 드래그(이동 + 매스 − 엔벨로프)
      const t1 = now();
      const mv = (ms[0] as unknown as { translate(v: number[]): { subtract(e: unknown): { numTri(): number; getMesh(): unknown; delete(): void }; delete(): void } }).translate([300 * i, 0, 0]);
      const ex = mv.subtract(env);
      ex.getMesh();
      const dd = now() - t1;
      ex.delete();
      mv.delete();
      if (i > 0) {
        ts.push(dt);
        drag.push(dd);
      }
      for (const o of own) o.delete();
    }
    res[vn] = { tris, build_all_ms: stats(ts), drag_one_excess_ms: stats(drag) };
    console.log(name, vn, tris, stats(ts).median, stats(drag).median);
  }
  // three ExtrudeGeometry(렌더 전용 삼각분할)
  {
    const ts: number[] = [];
    let tris = 0;
    for (let i = 0; i < reps + 1; i++) {
      const t0 = now();
      tris = 0;
      for (const s of specs) {
        const shape = new THREE.Shape(s.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
        const g = new THREE.ExtrudeGeometry(shape, { depth: s.floors.reduce((a, f) => a + f.height_mm, 0), steps: s.floors.length, bevelEnabled: false });
        tris += g.attributes.position!.count / 3;
        g.dispose();
      }
      if (i > 0) ts.push(now() - t0);
    }
    res.three_extrude = { tris, build_all_ms: stats(ts) };
    console.log(name, "three_extrude", tris, stats(ts).median);
  }
  out.push(res);
}
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/build-node.json", import.meta.url), JSON.stringify(out, null, 2));
