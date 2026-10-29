// 스파이크(버리는 코드): 실행 취소 100단계 비용 — 스냅샷(JSON 문자열·structuredClone) vs 구조 공유(불변 갱신) vs 명령 패턴(역연산).
// 모델: DesignModel v1 모양(packages/rules 고정 입력 + 매스 50개, 12각형·5층). 단계 = 매스 1개 이동(일반), 또는 매스 50개 동시 이동(최악).
// 실행: pnpm bench:undo (--expose-gc 필요)
import { mkdirSync, writeFileSync } from "node:fs";
import { fixtureModel } from "../../../packages/rules/src/test-fixtures.ts";
import { makeMasses, PRESETS, stats } from "../src/geom/scene.ts";

type Model = ReturnType<typeof fixtureModel>;
const gc = globalThis.gc as (() => void) | undefined;
if (!gc) throw new Error("--expose-gc 로 실행하세요");
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};

function baseModel(): Model {
  const m = fixtureModel();
  const p = PRESETS.find((x) => x.name === "S50")!;
  m.masses = makeMasses(p).map((s) => ({ ...s, footprint: { outer: s.footprint } })) as unknown as Model["masses"];
  return m;
}
const moveMass = (mass: Model["masses"][number], dx: number) => ({ ...mass, footprint: { outer: mass.footprint.outer.map(([x, y]) => [x + dx, y] as [number, number]) } });

const STEPS = 100;
const out: Record<string, unknown> = {};
const m0 = baseModel();
const json0 = JSON.stringify(m0);
out.model = { masses: m0.masses.length, json_bytes: Buffer.byteLength(json0), json_kb: Math.round(Buffer.byteLength(json0) / 1024) };

for (const scope of ["one", "all"] as const) {
  const step = (m: Model, i: number): Model => ({
    ...m,
    masses: m.masses.map((x, k) => (scope === "all" || k === i % m.masses.length ? moveMass(x, 100) : x)),
  });
  const res: Record<string, unknown> = {};

  // (1) JSON 문자열 스냅샷
  {
    let m = m0;
    const h0 = heap();
    const snaps: string[] = [];
    const ts: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      m = step(m, i);
      const t0 = performance.now();
      snaps.push(JSON.stringify(m));
      ts.push(performance.now() - t0);
    }
    const mem = heap() - h0;
    const tu: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      JSON.parse(snaps[STEPS - 1 - i]!);
      tu.push(performance.now() - t0);
    }
    res.json_snapshot = { record_ms: stats(ts), undo_ms: stats(tu), heap_100_kb: Math.round(mem / 1024), bytes_100_kb: Math.round(snaps.reduce((a, s) => a + s.length, 0) / 1024) };
    snaps.length = 0;
  }
  // (2) structuredClone 스냅샷
  {
    let m = m0;
    const h0 = heap();
    const snaps: Model[] = [];
    const ts: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      m = step(m, i);
      const t0 = performance.now();
      snaps.push(structuredClone(m));
      ts.push(performance.now() - t0);
    }
    const mem = heap() - h0;
    res.clone_snapshot = { record_ms: stats(ts), heap_100_kb: Math.round(mem / 1024) };
    snaps.length = 0;
  }
  // (3) 구조 공유(불변 갱신, 이전 모델 참조 보관) — 바뀐 매스 객체만 새로 생긴다
  {
    let m = m0;
    const h0 = heap();
    const hist: Model[] = [];
    const ts: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      const t0 = performance.now();
      hist.push(m);
      m = step(m, i);
      ts.push(performance.now() - t0);
    }
    const mem = heap() - h0;
    res.structural_sharing = { record_ms: stats(ts), undo_ms: "O(1) 참조 교체", heap_100_kb: Math.round(mem / 1024) };
    hist.length = 0;
  }
  // (4) 명령 패턴: { 매스 id, 이전 footprint, 이후 footprint } (역연산 = before 적용)
  {
    type Cmd = { op: "move_mass"; ids: string[]; dx: number };
    let m = m0;
    const h0 = heap();
    const cmds: Cmd[] = [];
    const ts: number[] = [];
    for (let i = 0; i < STEPS; i++) {
      const t0 = performance.now();
      const ids = scope === "all" ? m.masses.map((x) => x.id) : [m.masses[i % m.masses.length]!.id];
      const cmd: Cmd = { op: "move_mass", ids, dx: 100 };
      const set = new Set(cmd.ids);
      m = { ...m, masses: m.masses.map((x) => (set.has(x.id) ? moveMass(x, cmd.dx) : x)) };
      cmds.push(cmd);
      ts.push(performance.now() - t0);
    }
    const mem = heap() - h0 - 0; // 현재 모델 m 하나 포함
    const tu: number[] = [];
    let mu = m;
    for (let i = 0; i < 30; i++) {
      const c = cmds[STEPS - 1 - i]!;
      const set = new Set(c.ids);
      const t0 = performance.now();
      mu = { ...mu, masses: mu.masses.map((x) => (set.has(x.id) ? moveMass(x, -c.dx) : x)) };
      tu.push(performance.now() - t0);
    }
    res.command = { record_ms: stats(ts), undo_ms: stats(tu), heap_100_kb_incl_current_model: Math.round(mem / 1024), cmd_json_100_bytes: JSON.stringify(cmds).length };
  }
  out[`step_${scope}`] = res;
}
console.log(JSON.stringify(out, null, 2));
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/undo-node.json", import.meta.url), JSON.stringify(out, null, 2));
