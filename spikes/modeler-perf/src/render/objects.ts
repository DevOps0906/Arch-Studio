// 스파이크(버리는 코드): 렌더 구성별 three 객체 만들기. 좌표는 mm(Z-up) 그대로 두고 루트 그룹에서 m·Y-up으로 바꾼다.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RawMesh } from "../geom/core.ts";
import type { GeomWorker, Msg } from "../worker-client.ts";

export type ConfigName = "individual" | "merged" | "instanced" | "merged+edges" | "merged+drag";
export const CONFIGS: { name: ConfigName; label: string }[] = [
  { name: "individual", label: "(a) 개별 mesh(매스마다 1개)" },
  { name: "merged", label: "(b) 병합 geometry 1개" },
  { name: "instanced", label: "(c) InstancedMesh(같은 모양 가정)" },
  { name: "merged+edges", label: "(b') 병합 + 윤곽선(EdgesGeometry)" },
  { name: "merged+drag", label: "(b'') 병합 + 매스 1개 드래그 + 워커 증분 불린" },
];

export interface SceneData {
  preset: string;
  meshes: RawMesh[];
  envelope: RawMesh;
}

export interface Built {
  root: THREE.Group;
  tick?: (now: number) => void;
  extra?: () => Record<string, unknown>;
  dispose: () => void;
}

export function toGeometry(m: RawMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// flatShading: 법선 속성 없이 화면 미분으로 면 법선 → Manifold 공유 꼭짓점 메시를 그대로 쓴다(메모리 절약)
const massMat = () => new THREE.MeshStandardMaterial({ color: 0xb8b2a7, roughness: 0.9, flatShading: true });
const envMat = () =>
  new THREE.MeshStandardMaterial({ color: 0x2aa198, transparent: true, opacity: 0.18, depthWrite: false, flatShading: true, side: THREE.DoubleSide });

export function build(cfg: ConfigName, data: SceneData, worker: GeomWorker | null, dragStats: { lat: number[]; compute: number[]; replies: number; sent: number }): Built {
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.001);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };
  const mat = keep(massMat());
  const env = new THREE.Mesh(keep(toGeometry(data.envelope)), keep(envMat()));
  env.renderOrder = 10;
  let tick: ((now: number) => void) | undefined;

  if (cfg === "individual") {
    for (const m of data.meshes) root.add(new THREE.Mesh(keep(toGeometry(m)), mat));
  } else if (cfg === "merged" || cfg === "merged+edges") {
    const parts = data.meshes.map(toGeometry);
    const merged = keep(mergeGeometries(parts, false)!);
    parts.forEach((p) => p.dispose());
    root.add(new THREE.Mesh(merged, mat));
    if (cfg === "merged+edges") {
      const eg = keep(new THREE.EdgesGeometry(merged, 20));
      root.add(new THREE.LineSegments(eg, keep(new THREE.LineBasicMaterial({ color: 0x3a3a3a }))));
    }
  } else if (cfg === "instanced") {
    // 실제 매스는 모양이 서로 달라 인스턴싱 대상이 아니다. 같은 모양(매스 0)을 50개 놓아 상한만 본다.
    const base = data.meshes[0]!;
    const g = keep(toGeometry(base));
    const inst = new THREE.InstancedMesh(g, mat, data.meshes.length);
    const c0 = new THREE.Vector3();
    g.boundingBox!.getCenter(c0);
    const mtx = new THREE.Matrix4();
    data.meshes.forEach((m, i) => {
      const bb = new THREE.Box3().setFromArray(m.positions);
      const c = new THREE.Vector3();
      bb.getCenter(c);
      mtx.makeTranslation(c.x - c0.x, c.y - c0.y, 0);
      inst.setMatrixAt(i, mtx);
    });
    inst.computeBoundingSphere();
    root.add(inst);
  } else if (cfg === "merged+drag") {
    const parts = data.meshes.slice(1).map(toGeometry);
    const merged = keep(mergeGeometries(parts, false)!);
    parts.forEach((p) => p.dispose());
    root.add(new THREE.Mesh(merged, mat));
    const movedMat = keep(new THREE.MeshStandardMaterial({ color: 0xd9c9a3, roughness: 0.9, flatShading: true }));
    const moved = new THREE.Mesh(keep(toGeometry(data.meshes[0]!)), movedMat);
    root.add(moved);
    const excessMat = keep(new THREE.MeshBasicMaterial({ color: 0xd33a2f, depthTest: false, transparent: true, opacity: 0.85 }));
    const excess = new THREE.Mesh(new THREE.BufferGeometry(), excessMat);
    excess.renderOrder = 20;
    root.add(excess);
    let seq = 0;
    let inFlight = false;
    let sentAt = 0;
    let lastDx = 0;
    if (worker) {
      worker.onDrag = (m: Msg) => {
        inFlight = false;
        if ((m.seq as number) !== seq) return; // 최신만 유효
        dragStats.replies++;
        dragStats.lat.push(performance.now() - sentAt);
        dragStats.compute.push(m.compute_ms as number);
        excess.geometry.dispose();
        excess.geometry = toGeometry(m.excess as RawMesh);
      };
    }
    tick = (now: number) => {
      // 매스 0을 남북으로 왕복(0 → 북쪽 30m). 렌더는 객체 위치만 바꾸고(지오메트리 재생성 없음), 불린은 워커에 맡긴다.
      const t = now / 1000;
      const dy = Math.round((Math.sin(t * 1.3) * 0.5 + 0.5) * 30000);
      moved.position.set(0, dy, 0);
      lastDx = dy;
      if (worker && !inFlight) {
        inFlight = true;
        seq++;
        sentAt = performance.now();
        dragStats.sent++;
        worker.post({ op: "drag", seq, preset: data.preset, mass: 0, dx: 0, dy: lastDx });
      }
    };
    disposables.push({ dispose: () => excess.geometry.dispose() });
    disposables.push({
      dispose: () => {
        if (worker) worker.onDrag = null;
      },
    });
  }
  root.add(env);
  return { root, tick, dispose: () => disposables.forEach((d) => d.dispose()) };
}

/** 레이캐스팅 비용: 병합 20만 삼각형(BVH 없음/있음)과 개별 mesh 50개. */
export async function raycastBench(data: SceneData, n = 100): Promise<Record<string, unknown>> {
  const { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } = await import("three-mesh-bvh");
  const parts = data.meshes.map(toGeometry);
  const merged = mergeGeometries(parts, false)!;
  const mat = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.001);
  const mergedMesh = new THREE.Mesh(merged, mat);
  root.add(mergedMesh);
  root.updateMatrixWorld(true);
  const ind = new THREE.Group();
  ind.rotation.x = -Math.PI / 2;
  ind.scale.setScalar(0.001);
  const indMeshes = parts.map((p) => new THREE.Mesh(p, mat));
  indMeshes.forEach((m) => ind.add(m));
  ind.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let s = 7;
  const rnd = () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
  const rays = Array.from({ length: n }, () => {
    const o = new THREE.Vector3(rnd() * 100, 80, -rnd() * 60);
    const target = new THREE.Vector3(rnd() * 100, 0, -rnd() * 60);
    return [o, target.sub(o).normalize()] as const;
  });
  const time = (fn: () => unknown) => {
    const ts: number[] = [];
    let hits = 0;
    for (const [o, d] of rays) {
      ray.set(o, d);
      const t0 = performance.now();
      const r = fn() as unknown[];
      ts.push(performance.now() - t0);
      if (r.length) hits++;
    }
    ts.sort((a, b) => a - b);
    return { median_ms: +ts[Math.floor(n / 2)]!.toFixed(3), p95_ms: +ts[Math.floor(n * 0.95)]!.toFixed(3), hits };
  };
  const noBvhMerged = time(() => ray.intersectObject(mergedMesh, false));
  const noBvhInd = time(() => ray.intersectObjects(indMeshes, false));
  const g = merged as THREE.BufferGeometry & { computeBoundsTree: typeof computeBoundsTree; disposeBoundsTree: typeof disposeBoundsTree };
  g.computeBoundsTree = computeBoundsTree;
  g.disposeBoundsTree = disposeBoundsTree;
  const t0 = performance.now();
  g.computeBoundsTree();
  const bvhBuild = performance.now() - t0;
  mergedMesh.raycast = acceleratedRaycast;
  ray.firstHitOnly = true;
  const bvhMerged = time(() => ray.intersectObject(mergedMesh, false));
  g.disposeBoundsTree();
  merged.dispose();
  parts.forEach((p) => p.dispose());
  return {
    tris: merged.index!.count / 3,
    rays: n,
    merged_no_bvh: noBvhMerged,
    individual50_no_bvh: noBvhInd,
    bvh_build_ms: +bvhBuild.toFixed(2),
    merged_bvh_first_hit: bvhMerged,
  };
}
