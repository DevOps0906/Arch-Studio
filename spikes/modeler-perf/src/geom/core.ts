// 스파이크(버리는 코드): Manifold 불린·증분 재계산 측정 코어. Node(scripts/bench-geom.ts)와 브라우저(하니스·워커)가 같이 쓴다.
// packages/geometry/src/solid/kernel.ts와 같은 방식: CrossSection(정수 mm, Positive) → extrude → translate → union/intersect/difference,
// embind 객체는 수동 delete. 단, 렌더 경로는 정수 정규화(canonicalMesh·closeMesh) 없이 getMesh()의 Float32 버퍼를 그대로 쓴다(Node 벤치에서 정규화 비용을 따로 잰다).
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { makeMasses, PRESETS, stats, type MassSpec, type ScenePreset } from "./scene.ts";

export interface IntMeshLike {
  vertices: readonly (readonly [number, number, number])[];
  triangles: readonly (readonly [number, number, number])[];
}

export interface RawMesh {
  positions: Float32Array;
  index: Uint32Array;
  tris: number;
}

type Del = { delete(): void };

/**
 * 매스 솔리드. DesignModel v1의 층은 매스 바닥 하나를 공유하므로, 층고가 모두 같으면 extrude 1회 + nDivisions(층 경계 꼭짓점 유지)로 만든다.
 * 층별 extrude → union은 20~70배 느리다(scripts/bench-build.ts: S50 203ms vs 9ms, S200k 15.5s vs 0.22s). 층고가 다르면 그 방식으로 되돌아간다.
 * MODE=floor_union 환경(전역 __MASS_MODE)으로 강제할 수 있다(비교 측정용).
 */
export function massManifold(wasm: ManifoldToplevel, spec: MassSpec, own: Del[]): Manifold {
  const keep = <T extends Del>(x: T): T => {
    own.push(x);
    return x;
  };
  const cs = keep(new wasm.CrossSection([spec.footprint], "Positive"));
  const h0 = spec.floors[0]?.height_mm ?? 3000;
  const uniform = spec.floors.every((f) => f.height_mm === h0);
  const forceUnion = (globalThis as { __MASS_MODE?: string }).__MASS_MODE === "floor_union";
  if (uniform && !forceUnion) {
    const m = keep(cs.extrude(h0 * spec.floors.length, spec.floors.length - 1));
    return spec.base_level_mm === 0 ? m : keep(m.translate([0, 0, spec.base_level_mm]));
  }
  const parts: Manifold[] = [];
  let z = spec.base_level_mm;
  for (const f of spec.floors) {
    const e = keep(cs.extrude(f.height_mm));
    parts.push(keep(e.translate([0, 0, z])));
    z += f.height_mm;
  }
  return parts.length === 1 ? (parts[0] as Manifold) : keep(wasm.Manifold.union(parts));
}

export function envelopeManifold(wasm: ManifoldToplevel, env: IntMeshLike): Manifold {
  const vp = new Float32Array(env.vertices.length * 3);
  env.vertices.forEach((v, i) => vp.set(v, i * 3));
  const tv = new Uint32Array(env.triangles.length * 3);
  env.triangles.forEach((t, i) => tv.set(t, i * 3));
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties: vp, triVerts: tv });
  mesh.merge();
  const m = new wasm.Manifold(mesh);
  if (m.status() !== "NoError") throw new Error(`엔벨로프 Manifold 상태 ${m.status()}`);
  return m;
}

/** 엔벨로프 대용(대지 100m×60m 위 높이 30m 상자에서 북측 경사를 뺀 단순 솔리드). 브라우저에서 rules를 쓰지 않을 때만. */
export function fallbackEnvelope(wasm: ManifoldToplevel): Manifold {
  const box = wasm.Manifold.cube([100000, 60000, 30000]);
  const cut = wasm.Manifold.cube([200000, 60000, 60000]).rotate([-35, 0, 0]).translate([-50000, 30000, 18000]);
  const out = box.subtract(cut);
  box.delete();
  cut.delete();
  return out;
}

export function rawMesh(m: Manifold): RawMesh {
  const mesh = m.getMesh();
  const n = mesh.numProp;
  let positions: Float32Array;
  if (n === 3) positions = mesh.vertProperties;
  else {
    positions = new Float32Array((mesh.vertProperties.length / n) * 3);
    for (let i = 0, j = 0; i < mesh.vertProperties.length; i += n, j += 3) {
      positions[j] = mesh.vertProperties[i] as number;
      positions[j + 1] = mesh.vertProperties[i + 1] as number;
      positions[j + 2] = mesh.vertProperties[i + 2] as number;
    }
  }
  return { positions, index: mesh.triVerts, tris: mesh.triVerts.length / 3 };
}

export interface GeomBenchOptions {
  now: () => number;
  /** 반복 수(기본 30). */
  n?: number;
  presets?: ScenePreset[];
  /** 드래그 프레임 수(기본 60). */
  dragFrames?: number;
  log?: (s: string) => void;
}

export interface PresetResult {
  preset: string;
  masses: number;
  floors: number;
  verts: number;
  tris_masses: number;
  tris_intersect: number;
  tris_subtract: number;
  tris_excess: number;
  build_ms: ReturnType<typeof stats>;
  union_ms: ReturnType<typeof stats>;
  intersect_ms: ReturnType<typeof stats>;
  subtract_ms: ReturnType<typeof stats>;
  excess_ms: ReturnType<typeof stats>;
  getmesh_union_ms: ReturnType<typeof stats>;
}

export interface DragResult {
  preset: string;
  /** 전체 재계산: union(전 매스) ∩ 엔벨로프 + 엔벨로프 − union, 메시 추출 포함. */
  full_ms: ReturnType<typeof stats>;
  /** 증분: 움직인 매스 1개만 (매스 ∩ 엔벨로프, 매스 − 엔벨로프) + 메시 추출. 나머지는 캐시. */
  per_mass_ms: ReturnType<typeof stats>;
  /** 렌더만: 움직인 매스 translate + getMesh(불린 없음). */
  translate_only_ms: ReturnType<typeof stats>;
}

export function runGeomBench(wasm: ManifoldToplevel, env: Manifold, o: GeomBenchOptions): { presets: PresetResult[]; drag: DragResult[] } {
  const n = o.n ?? 30;
  const log = o.log ?? (() => {});
  const presets = o.presets ?? PRESETS;
  const out: PresetResult[] = [];
  env.numTri(); // 엔벨로프는 앱에서도 캐시된다

  for (const p of presets) {
    const specs = makeMasses(p);
    const t = { build: [] as number[], union: [] as number[], inter: [] as number[], sub: [] as number[], exc: [] as number[], gm: [] as number[] };
    let tris = { m: 0, i: 0, s: 0, e: 0 };
    for (let it = 0; it < n + 1; it++) {
      const own: Del[] = [];
      try {
        let t0 = o.now();
        const ms = specs.map((s) => massManifold(wasm, s, own));
        ms.forEach((m) => m.numTri()); // 지연 평가 강제
        const tb = o.now() - t0;
        t0 = o.now();
        const u = wasm.Manifold.union(ms);
        own.push(u);
        const tm = u.numTri();
        const tu = o.now() - t0;
        t0 = o.now();
        const i = u.intersect(env);
        own.push(i);
        const ti = i.numTri();
        const tInter = o.now() - t0;
        t0 = o.now();
        const s = env.subtract(u);
        own.push(s);
        const ts = s.numTri();
        const tSub = o.now() - t0;
        t0 = o.now();
        const e = u.subtract(env);
        own.push(e);
        const te = e.numTri();
        const tExc = o.now() - t0;
        t0 = o.now();
        rawMesh(u);
        const tGm = o.now() - t0;
        if (it > 0) {
          t.build.push(tb);
          t.union.push(tu);
          t.inter.push(tInter);
          t.sub.push(tSub);
          t.exc.push(tExc);
          t.gm.push(tGm);
        }
        tris = { m: tm, i: ti, s: ts, e: te };
      } finally {
        for (const x of own) x.delete();
      }
    }
    const r: PresetResult = {
      preset: p.name,
      masses: p.masses,
      floors: p.floors,
      verts: p.verts,
      tris_masses: tris.m,
      tris_intersect: tris.i,
      tris_subtract: tris.s,
      tris_excess: tris.e,
      build_ms: stats(t.build),
      union_ms: stats(t.union),
      intersect_ms: stats(t.inter),
      subtract_ms: stats(t.sub),
      excess_ms: stats(t.exc),
      getmesh_union_ms: stats(t.gm),
    };
    log(`${p.name}: 매스 삼각형 ${tris.m}, ∩ ${r.intersect_ms.median}/${r.intersect_ms.p95}ms, − ${r.subtract_ms.median}/${r.subtract_ms.p95}ms`);
    out.push(r);
  }

  // (d) 드래그 증분 재계산: 매스 0을 프레임마다 150mm씩 동쪽으로 옮긴다.
  const drag: DragResult[] = [];
  const frames = Math.max(30, o.dragFrames ?? 60);
  for (const name of ["S50", "S200k"]) {
    const p = presets.find((x) => x.name === name);
    if (!p) continue;
    const specs = makeMasses(p);
    const own: Del[] = [];
    try {
      const ms = specs.map((s) => massManifold(wasm, s, own));
      ms.forEach((m) => m.numTri());
      const moved = ms[0] as Manifold;
      const rest = ms.slice(1);
      const full: number[] = [];
      const per: number[] = [];
      const tr: number[] = [];
      for (let f = 0; f < frames + 1; f++) {
        const dx = (f + 1) * 150;
        const tmp: Del[] = [];
        try {
          let t0 = o.now();
          const mv = moved.translate([dx, 0, 0]);
          tmp.push(mv);
          rawMesh(mv);
          const tTr = o.now() - t0;
          t0 = o.now();
          const mv2 = moved.translate([dx, 0, 0]);
          tmp.push(mv2);
          const a = mv2.intersect(env);
          const b = mv2.subtract(env);
          tmp.push(a, b);
          rawMesh(a);
          rawMesh(b);
          const tPer = o.now() - t0;
          t0 = o.now();
          const mv3 = moved.translate([dx, 0, 0]);
          const u = wasm.Manifold.union([...rest, mv3]);
          const i = u.intersect(env);
          const s = env.subtract(u);
          tmp.push(mv3, u, i, s);
          rawMesh(i);
          rawMesh(s);
          const tFull = o.now() - t0;
          if (f > 0) {
            tr.push(tTr);
            per.push(tPer);
            full.push(tFull);
          }
        } finally {
          for (const x of tmp) x.delete();
        }
      }
      const d: DragResult = { preset: name, full_ms: stats(full), per_mass_ms: stats(per), translate_only_ms: stats(tr) };
      log(`드래그 ${name}: 전체 ${d.full_ms.median}/${d.full_ms.p95}ms, 매스 1개 ${d.per_mass_ms.median}/${d.per_mass_ms.p95}ms`);
      drag.push(d);
    } finally {
      for (const x of own) x.delete();
    }
  }
  return { presets: out, drag };
}

/** 렌더용 장면 메시: 매스별 RawMesh(Manifold 산출). */
export function sceneMeshes(wasm: ManifoldToplevel, p: ScenePreset): RawMesh[] {
  const specs = makeMasses(p);
  return specs.map((s) => {
    const own: Del[] = [];
    try {
      const m = massManifold(wasm, s, own);
      const r = rawMesh(m);
      // getMesh 버퍼는 WASM 힙 사본이므로 delete 뒤에도 유효하다
      return { positions: r.positions.slice(), index: r.index.slice(), tris: r.tris };
    } finally {
      for (const x of own) x.delete();
    }
  });
}
