// 스파이크(버리는 코드): 번들 크기(gzip)와 보안 점검.
// (1) 크기: 진입점별로 따로 빌드 — three만 / three+R3F / three+R3F+drei(모델러가 쓸 만한 부분) / manifold JS(+ .wasm)
// (2) 하니스 dist에서 eval·new Function·blob: Worker 사용 흔적, sharp·@img 포함 여부(AR-06-016 확인 조건)
// 실행: pnpm build && pnpm audit
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = new URL("..", import.meta.url).pathname;
const tmp = join(root, "dist-size");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(tmp, "src"), { recursive: true });

const entries: Record<string, string> = {
  three_only: `import * as THREE from "three"; const r = new THREE.WebGLRenderer(); const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ flatShading: true }))); s.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry()))); new THREE.Raycaster(); new THREE.InstancedMesh(new THREE.BufferGeometry(), undefined, 1); r.render(s, new THREE.PerspectiveCamera()); export {};`,
  three_r3f: `import * as THREE from "three"; import { createRoot } from "react-dom/client"; import { createElement as h } from "react"; import { Canvas } from "@react-three/fiber"; new THREE.Raycaster(); new THREE.EdgesGeometry(new THREE.BoxGeometry()); createRoot(document.body).render(h(Canvas, null, h("mesh", null, h("meshStandardMaterial", { flatShading: true })))); export {};`,
  three_r3f_drei: `import * as THREE from "three"; import { createRoot } from "react-dom/client"; import { createElement as h } from "react"; import { Canvas } from "@react-three/fiber"; import { OrbitControls, Edges, Bvh, GizmoHelper, GizmoViewcube, Grid, OrthographicCamera, PerspectiveCamera } from "@react-three/drei"; new THREE.Raycaster(); createRoot(document.body).render(h(Canvas, null, h(PerspectiveCamera, { makeDefault: true }), h(OrthographicCamera, null), h(OrbitControls, null), h(Grid, null), h(Bvh, null, h("mesh", null, h(Edges, null), h("meshStandardMaterial", { flatShading: true }))), h(GizmoHelper, null, h(GizmoViewcube, null)))); export {};`,
  three_mesh_bvh: `import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh"; console.log(computeBoundsTree, acceleratedRaycast); export {};`,
  manifold_js: `import Module from "manifold-3d"; import url from "manifold-3d/manifold.wasm?url"; Module({ locateFile: () => url }).then((w) => w.setup()); export {};`,
};

const sizes: Record<string, { js_raw_kb: number; js_gzip_kb: number; wasm_raw_kb?: number; wasm_gzip_kb?: number }> = {};
for (const [name, code] of Object.entries(entries)) {
  const file = join(tmp, "src", `${name}.ts`);
  writeFileSync(file, code);
  const outDir = join(tmp, name);
  await build({ root, logLevel: "silent", configFile: false, build: { target: "chrome120", outDir, emptyOutDir: true, lib: false, rollupOptions: { input: file }, minify: true } });
  let js = 0;
  let jsz = 0;
  let w = 0;
  let wz = 0;
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".js")) {
        const b = readFileSync(p);
        js += b.length;
        jsz += gzipSync(b, { level: 9 }).length;
      } else if (f.endsWith(".wasm")) {
        const b = readFileSync(p);
        w += b.length;
        wz += gzipSync(b, { level: 9 }).length;
      }
    }
  };
  walk(outDir);
  const kb = (n: number) => Math.round((n / 1024) * 10) / 10;
  sizes[name] = { js_raw_kb: kb(js), js_gzip_kb: kb(jsz), ...(w ? { wasm_raw_kb: kb(w), wasm_gzip_kb: kb(wz) } : {}) };
  console.log(name, sizes[name]);
}

// 보안 점검(하니스 dist)
const dist = join(root, "dist");
const findings: Record<string, string[]> = { eval_call: [], new_function: [], blob_url: [], sharp: [], inline_script: [] };
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(f)) {
      const s = readFileSync(p, "utf8");
      const ctx = (re: RegExp) => [...s.matchAll(re)].map((m) => `${f}: …${s.slice(Math.max(0, m.index! - 40), m.index! + 60).replace(/\s+/g, " ")}…`);
      findings.eval_call!.push(...ctx(/(?<![\w$.])eval\s*\(/g));
      findings.new_function!.push(...ctx(/new\s+Function\s*\(/g));
      findings.blob_url!.push(...ctx(/createObjectURL|["'`]blob:/g));
      findings.sharp!.push(...ctx(/@img\/sharp|require\(["']sharp["']\)/g));
      if (f.endsWith(".html")) findings.inline_script!.push(...ctx(/<script(?![^>]*\bsrc=)[^>]*>/g));
    }
  }
};
walk(dist);
const res = { sizes, security_scan_dist: findings };
writeFileSync(join(root, "out", "audit.json"), JSON.stringify(res, null, 2));
console.log(JSON.stringify(findings, null, 2));
