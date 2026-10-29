// 스파이크(버리는 코드): 모델러 성능 실기 측정 하니스(AR-06-036). 브라우저에서 열면 구성별 fps·p95 프레임 시간·메모리·WebGL 정보를 표시하고 JSON으로 복사한다.
// ?auto=1 이면 자동으로 전부 측정하고 window.__result에 결과를 둔다(playwright용). ?secs=N 구성당 측정 초(기본 8), ?presets=S50,S200k
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import type { RawMesh } from "./geom/core.ts";
import { build, CONFIGS, raycastBench, type ConfigName, type SceneData } from "./render/objects.ts";
import { GeomWorker, type Msg } from "./worker-client.ts";
import "./harness.css";

const q = new URLSearchParams(location.search);
const AUTO = q.get("auto") === "1";
const SECS = Number(q.get("secs") ?? 8);
const WARM_MS = 1500;
const PRESET_LIST = (q.get("presets") ?? "S50,S200k").split(",");
const W = 1280;
const H = 720;

type Stat = { n: number; mean: number; median: number; p95: number; max: number };
function stat(xs: number[]): Stat {
  const s = [...xs].sort((a, b) => a - b);
  const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)), median: r(pick(0.5)), p95: r(pick(0.95)), max: r(s[s.length - 1] ?? 0) };
}

interface RenderRow {
  preset: string;
  config: ConfigName;
  tris_scene: number;
  draw_calls: number;
  fps_avg: number;
  frame_ms: Stat;
  render_cpu_ms: Stat;
  first_frame_ms: number;
  build_ms: number;
  js_heap_mb: number | null;
  drag?: { sent: number; replies: number; latency_ms: Stat; worker_compute_ms: Stat };
  verdict_min30: boolean;
  verdict_rec60: boolean;
}

function webglInfo(): Record<string, unknown> {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return { webgl2: false };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    webgl2: true,
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    max_texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    timer_query: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
  };
}

function envInfo(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    device_memory_gb_hint: nav.deviceMemory ?? null, // Chrome은 8로 상한을 둔다(8GB 이상도 8)
    dpr: devicePixelRatio,
    viewport_css: `${W}x${H}`,
    screen: `${screen.width}x${screen.height}`,
    webgl: webglInfo(),
    cross_origin_isolated: crossOriginIsolated,
  };
}

const heapMb = () => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round((m.usedJSHeapSize / 2 ** 20) * 10) / 10 : null;
};

/** 측정기: 렌더 루프를 직접 잡아(useFrame priority 1) gl.render CPU 시간과 rAF 간격을 잰다. 카메라는 궤도로 계속 돈다. */
function Bench({ data, cfg, worker, onDone }: { data: SceneData; cfg: ConfigName; worker: GeomWorker; onDone: (r: RenderRow) => void }) {
  const { gl, scene, camera } = useThree();
  const dragStats = useMemo(() => ({ lat: [] as number[], compute: [] as number[], replies: 0, sent: 0 }), [cfg, data]);
  const t0b = performance.now();
  const built = useMemo(() => build(cfg, data, worker, dragStats), [cfg, data, worker, dragStats]);
  const buildMs = performance.now() - t0b;
  const st = useRef({ start: 0, last: 0, frames: [] as number[], cpu: [] as number[], first: -1, done: false, calls: 0, tris: 0 });
  // 루트는 첫 렌더 전에 장면에 넣는다(첫 프레임 = 버퍼 업로드·셰이더 컴파일 포함 시간이 되도록)
  if (built.root.parent !== scene) scene.add(built.root);
  useEffect(
    () => () => {
      scene.remove(built.root);
      built.dispose();
    },
    [built, scene],
  );
  useFrame(() => {
    const s = st.current;
    const now = performance.now();
    if (!s.start) s.start = now;
    const t = (now - s.start) / 1000;
    camera.position.set(50 + Math.cos(t * 0.4) * 110, 65, -30 + Math.sin(t * 0.4) * 110);
    camera.lookAt(50, 5, -30);
    built.tick?.(now);
    const c0 = performance.now();
    gl.render(scene, camera);
    const c1 = performance.now();
    if (s.first < 0) s.first = c1 - c0; // 첫 프레임: 버퍼 업로드·셰이더 컴파일 포함
    if (s.last && now - s.start > WARM_MS) {
      s.frames.push(now - s.last);
      s.cpu.push(c1 - c0);
    }
    s.last = now;
    s.calls = gl.info.render.calls;
    s.tris = gl.info.render.triangles;
    if (!s.done && now - s.start > WARM_MS + SECS * 1000) {
      s.done = true;
      const f = stat(s.frames);
      const fps = Math.round((1000 / f.mean) * 10) / 10;
      const row: RenderRow = {
        preset: data.preset,
        config: cfg,
        tris_scene: s.tris,
        draw_calls: s.calls,
        fps_avg: fps,
        frame_ms: f,
        render_cpu_ms: stat(s.cpu),
        first_frame_ms: Math.round(s.first * 10) / 10,
        build_ms: Math.round(buildMs * 10) / 10,
        js_heap_mb: heapMb(),
        verdict_min30: fps >= 30 && f.p95 <= 40,
        verdict_rec60: fps >= 57 && f.p95 <= 20,
      };
      if (cfg === "merged+drag") row.drag = { sent: dragStats.sent, replies: dragStats.replies, latency_ms: stat(dragStats.lat), worker_compute_ms: stat(dragStats.compute) };
      onDone(row);
    }
  }, 1);
  return null;
}

async function loadScene(worker: GeomWorker, preset: string): Promise<SceneData & { build_ms: number }> {
  const s = await worker.request<Msg>({ op: "scene", preset });
  if (s.op === "error") throw new Error(String(s.detail));
  const e = await worker.request<Msg>({ op: "envelope_mesh" });
  return { preset, meshes: s.meshes as RawMesh[], envelope: e.mesh as RawMesh, build_ms: s.build_ms as number };
}

async function transferBench(worker: GeomWorker, data: SceneData, n = 30) {
  const totalP = data.meshes.reduce((a, m) => a + m.positions.length, 0);
  const totalI = data.meshes.reduce((a, m) => a + m.index.length, 0);
  const mk = () => {
    const p = new Float32Array(totalP);
    const ix = new Uint32Array(totalI);
    let o = 0;
    let oi = 0;
    for (const m of data.meshes) {
      p.set(m.positions, o);
      ix.set(m.index, oi);
      o += m.positions.length;
      oi += m.index.length;
    }
    return { p, ix };
  };
  const out: Record<string, unknown> = { bytes: totalP * 4 + totalI * 4, tris: totalI / 3 };
  for (const transfer of [true, false]) {
    const rt: number[] = [];
    for (let i = 0; i < n + 1; i++) {
      const { p, ix } = mk();
      const t0 = performance.now();
      await worker.request({ op: "echo", positions: p, index: ix, t_send: t0, transfer }, transfer ? [p.buffer, ix.buffer] : []);
      if (i > 0) rt.push(performance.now() - t0);
    }
    out[transfer ? "transferable_roundtrip_ms" : "structured_clone_roundtrip_ms"] = stat(rt);
  }
  return out;
}

async function mainThreadInit(n = 10) {
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const w = await Module({ locateFile: () => wasmUrl });
    w.setup();
    ts.push(performance.now() - t0);
  }
  return { first_ms: Math.round(ts[0]! * 10) / 10, rest: stat(ts.slice(1)) };
}

function App() {
  const worker = useMemo(() => new GeomWorker(), []);
  const [env] = useState(envInfo);
  const [status, setStatus] = useState("준비");
  const [rows, setRows] = useState<RenderRow[]>([]);
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [current, setCurrent] = useState<{ data: SceneData; cfg: ConfigName; key: number } | null>(null);
  const resolver = useRef<((r: RenderRow) => void) | null>(null);
  const violations = useRef<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const h = (e: SecurityPolicyViolationEvent) => violations.current.push(`${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener("securitypolicyviolation", h);
    return () => document.removeEventListener("securitypolicyviolation", h);
  }, []);

  const result = useMemo(
    () => ({ spike: "AR-06-036 modeler-perf", at: new Date().toISOString(), env, render: rows, ...extra, csp_violations: violations.current, worker_errors: worker.errors }),
    [env, rows, extra, worker],
  );

  async function runRender(data: SceneData, cfg: ConfigName) {
    return new Promise<RenderRow>((resolve) => {
      resolver.current = resolve;
      setCurrent({ data, cfg, key: Math.random() });
    });
  }

  async function runAll(opts: { render: boolean; geom: boolean }) {
    setRunning(true);
    const ex: Record<string, unknown> = {};
    try {
      setStatus("워커 초기화(Manifold WASM + 엔벨로프)…");
      const init = await worker.request<Msg>({ op: "init" });
      ex.worker_init = init.info;
      setExtra({ ...ex });
      if (opts.render) {
        for (const preset of PRESET_LIST) {
          setStatus(`${preset} 장면 메시 생성(워커)…`);
          const data = await loadScene(worker, preset);
          ex[`scene_${preset}`] = { worker_build_ms: Math.round(data.build_ms), masses: data.meshes.length, tris: data.meshes.reduce((a, m) => a + m.tris, 0) };
          for (const c of CONFIGS) {
            setStatus(`${preset} · ${c.label} 측정 중(${SECS}초)…`);
            const row = await runRender(data, c.name);
            setRows((r) => [...r, row]);
          }
          setCurrent(null);
          setStatus(`${preset} 레이캐스팅·전송 비용…`);
          ex[`raycast_${preset}`] = await raycastBench(data);
          ex[`transfer_${preset}`] = await transferBench(worker, data);
          setExtra({ ...ex });
        }
      }
      if (opts.geom) {
        setStatus("메인 스레드 WASM 초기화…");
        ex.main_thread_init = await mainThreadInit();
        setStatus("지오메트리 벤치(워커, n=30, 수 분 걸릴 수 있음)…");
        const b = await worker.request<Msg>({ op: "bench", n: 30 });
        ex.geom_worker = b.result ?? b;
        setExtra({ ...ex });
      }
      setStatus("완료");
    } catch (e) {
      setStatus(`오류: ${String(e)}`);
      ex.error = String(e);
      setExtra({ ...ex });
    } finally {
      setRunning(false);
    }
    return ex;
  }

  useEffect(() => {
    if (!AUTO) return;
    void runAll({ render: true, geom: q.get("geom") !== "0" }).then(() => {
      (window as unknown as { __done: boolean }).__done = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    (window as unknown as { __result: unknown }).__result = result;
  }, [result]);

  const json = JSON.stringify(result, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setStatus("JSON을 복사했습니다");
    } catch {
      const ta = document.getElementById("json") as HTMLTextAreaElement;
      ta.select();
      document.execCommand("copy");
      setStatus("JSON을 선택했습니다(복사 안 되면 Ctrl+C)");
    }
  };
  const webgl = env.webgl as Record<string, unknown>;

  return (
    <main>
      <h1>Arch Studio 모델러 성능 측정 하니스 (AR-06-036 스파이크)</h1>
      <p className="env">
        GPU: <b>{String(webgl.renderer ?? "WebGL2 없음")}</b> · 코어 {String(env.cores)} · deviceMemory {String(env.device_memory_gb_hint)}GB · DPR {String(env.dpr)} · 화면 {String(env.screen)}
      </p>
      <p className="hint">
        합격 기준(장면 S200k = 매스 50개·삼각형 약 20만): 최소 사양(RAM 8GB, WebGL2) 평균 30fps 이상 · p95 프레임 40ms 이하 / 권장 사양 평균 57fps 이상(60Hz) · p95 20ms 이하. 측정 중에는 다른 창을 가리지 말고 전원 연결.
      </p>
      <div className="bar">
        <button disabled={running} onClick={() => void runAll({ render: true, geom: false })}>
          렌더 측정
        </button>
        <button disabled={running} onClick={() => void runAll({ render: true, geom: true })}>
          전체 측정(렌더 + 지오메트리)
        </button>
        <button onClick={() => void copy()}>JSON 복사</button>
        <span className="status">{status}</span>
      </div>
      <div className="viewport" style={{ width: W, height: H }}>
        <Canvas dpr={Math.min(devicePixelRatio, 2)} camera={{ fov: 45, near: 1, far: 2000, position: [160, 65, 80] }} frameloop="always" gl={{ antialias: true, powerPreference: "high-performance" }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[60, 120, 40]} intensity={1.6} />
          <OrbitControls target={[50, 5, -30]} enabled={!current} />
          {current && (
            <Bench
              key={current.key}
              data={current.data}
              cfg={current.cfg}
              worker={worker}
              onDone={(r) => {
                const f = resolver.current;
                resolver.current = null;
                f?.(r);
              }}
            />
          )}
        </Canvas>
      </div>
      <table>
        <thead>
          <tr>
            <th>장면</th>
            <th>구성</th>
            <th>삼각형</th>
            <th>드로우콜</th>
            <th>평균 fps</th>
            <th>p95 프레임 ms</th>
            <th>gl.render CPU ms(중앙/p95)</th>
            <th>첫 프레임 ms</th>
            <th>JS 힙 MB</th>
            <th>최소 30</th>
            <th>권장 60</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.preset}</td>
              <td>{CONFIGS.find((c) => c.name === r.config)?.label}</td>
              <td>{r.tris_scene.toLocaleString()}</td>
              <td>{r.draw_calls}</td>
              <td>{r.fps_avg}</td>
              <td>{r.frame_ms.p95}</td>
              <td>
                {r.render_cpu_ms.median} / {r.render_cpu_ms.p95}
              </td>
              <td>{r.first_frame_ms}</td>
              <td>{r.js_heap_mb ?? "-"}</td>
              <td className={r.verdict_min30 ? "ok" : "ng"}>{r.verdict_min30 ? "통과" : "미달"}</td>
              <td className={r.verdict_rec60 ? "ok" : "ng"}>{r.verdict_rec60 ? "통과" : "미달"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <textarea id="json" readOnly value={json} rows={16} />
    </main>
  );
}

THREE.ColorManagement.enabled = true;
// StrictMode는 쓰지 않는다(개발 모드 이중 실행이 워커·측정을 두 번 만든다)
createRoot(document.getElementById("root")!).render(<App />);
