// 퍼징(AR-06-039): 시드 고정 의사 난수로 손상 .3dm 입력을 만들어 "예외가 아니라 구조화된 결과만" 나오는지 확인한다(dxf-import 패턴).
// 난수는 mulberry32(Math.random 금지) — 같은 시드면 같은 입력이라 실패를 재현할 수 있다.
// 앱과 같은 방식으로 돌린다: 커널은 워커 안, 한 건마다 시간 상한(TIME_LIMIT_MS) — 넘으면 워커를 terminate하고 새로 띄운다.
// (rhino3dm은 동기 wasm이라 함수 안에서 끊을 수 없다. 손상 입력 하나가 메모리 증가 없이 9초 넘게 CPU를 쓰는 사례가 실측됐다.)
// discard_kernel 오류(wasm 트랩·메모리 상한)가 나오면 워커 안에서 커널을 버리고 새로 로드한다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { after, before, test } from "node:test";
// eslint-disable-next-line no-restricted-imports -- 테스트는 워커로 시간 상한을 건다(앱 쪽 책임을 흉내)
import { Worker } from "node:worker_threads";
import { COORD_LIMIT } from "@arch-studio/geometry";
import { boxMesh } from "../gltf/fixtures.ts";
import { makeFile, quadBox } from "./fixtures.ts";
import { loadKernel, loadRaw } from "./node-harness.test.ts";
import type { Rhino3dmImportResult } from "./index.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rbytes(rnd: () => number, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256);
  return b;
}

// 정상 입력은 건당 10ms 안팎이다. 상한을 짧게 둬서 느린 손상 입력(실측 9초+)에 테스트 시간이 끌려가지 않게 한다.
const TIME_LIMIT_MS = 500;
// 기본 200건(빠른 회귀), IO_FUZZ_FULL=1이면 2,000건. 건수 비율은 A 40% · B 25% · C 35%.
const FULL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.IO_FUZZ_FULL === "1";
const N_A = FULL ? 800 : 80;
const N_B = FULL ? 500 : 50;
const N_C = FULL ? 700 : 70;
const N_TOTAL = N_A + N_B + N_C;
const counts = { total: 0, ok: 0, needs_unit: 0, error: 0, reloads: 0, timeouts: 0 } as Record<string, number>;
const codes = new Map<string, number>();
let BASE: Uint8Array;
let MIXED: Uint8Array;

// 워커: node-harness.test.ts의 loadKernel로 커널을 만들고, 받은 바이트를 import3dm 해서 결과를 돌려준다.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { loadKernel } = await import(workerData.fixtures);
  let k = await loadKernel();
  parentPort.on("message", async (bytes) => {
    const r = k.import3dm(bytes);
    if (!r.ok && r.error.discard_kernel) k = await loadKernel();
    parentPort.postMessage(r);
  });
  parentPort.postMessage("ready");
})();`;

interface Runner {
  worker: Worker;
  ready: Promise<void>;
}
let runner: Runner | undefined;

function spawn(): Runner {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { fixtures: new URL("./node-harness.test.ts", import.meta.url).href } });
  const ready = new Promise<void>((resolve, reject) => {
    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
  return { worker, ready };
}

/** 워커에서 import3dm 한 건. 시간 상한을 넘으면 null(워커는 terminate 후 새로 띄운다). */
async function runInWorker(input: Uint8Array): Promise<Rhino3dmImportResult | null> {
  runner ??= spawn();
  const cur = runner;
  await cur.ready;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await new Promise<Rhino3dmImportResult | null>((resolve, reject) => {
    cur.worker.once("message", (r: Rhino3dmImportResult) => resolve(r));
    cur.worker.once("error", reject);
    // eslint-disable-next-line no-restricted-globals -- 테스트 하네스의 시간 상한(엔진 코드가 아님)
    timer = setTimeout(() => resolve(null), TIME_LIMIT_MS);
    cur.worker.postMessage(input);
  });
  clearTimeout(timer);
  cur.worker.removeAllListeners("message");
  cur.worker.removeAllListeners("error");
  if (result === null) {
    await cur.worker.terminate();
    runner = undefined;
  }
  return result;
}

after(async () => {
  await runner?.worker.terminate();
});

before(async () => {
  const k = await loadKernel();
  BASE = k.export3dm({
    projectId: "fuzz",
    masses: [
      { key: "a", name: "매스", mesh: boxMesh(0, 0, 0, 10000, 8000, 3000) },
      { key: "b", mesh: boxMesh(-5000, -5000, 0, -1000, -2000, 6000) },
    ],
  });
  const raw = await loadRaw();
  MIXED = makeFile(raw, "Meters", [quadBox(0, 0, 0, 1.5, 2.5, 3.5), quadBox(-1, -1, -1, 0, 0, 0)], (f) => f.objects().addPointXYZ(1, 2, 3));
});

async function check(input: Uint8Array, label: string): Promise<void> {
  let r: Rhino3dmImportResult | null;
  try {
    r = await runInWorker(input);
  } catch (e) {
    assert.fail(`${label}: 예외가 새어 나옴 ${(e as Error).message}`);
  }
  counts.total = (counts.total ?? 0) + 1;
  if (r === null) {
    counts.timeouts = (counts.timeouts ?? 0) + 1;
    return;
  }
  assert.equal(typeof r, "object", label);
  if (!r.ok) {
    assert.notEqual(r.error.code, "R3DM_INTERNAL", `${label}: 내부 오류 ${JSON.stringify(r.error)}`);
    assert.ok(r.error.message.length > 0, label);
    counts.error = (counts.error ?? 0) + 1;
    codes.set(r.error.code, (codes.get(r.error.code) ?? 0) + 1);
    if (r.error.discard_kernel) counts.reloads = (counts.reloads ?? 0) + 1;
    return;
  }
  if (r.status === "needs_unit") {
    counts.needs_unit = (counts.needs_unit ?? 0) + 1;
    assert.equal(r.code, "AR053");
    return;
  }
  counts.ok = (counts.ok ?? 0) + 1;
  assert.ok(r.candidates.length > 0, label);
  for (const c of r.candidates) {
    assert.ok(c.mesh.triangles.length > 0, label);
    for (const v of c.mesh.vertices) for (const x of v) assert.ok(Number.isSafeInteger(x) && Math.abs(x) <= COORD_LIMIT, `${label}: 좌표 ${x}`);
    for (const t of c.mesh.triangles) for (const i of t) assert.ok(i >= 0 && i < c.mesh.vertices.length, label);
  }
}

test(`퍼징 A: 임의 바이트 ${N_A}건 (절반은 3dm 머리말을 붙여 파서 깊이 진입)`, async () => {
  const rnd = mulberry32(20261101);
  const head = BASE.slice(0, 32);
  for (let i = 0; i < N_A; i++) {
    const body = rbytes(rnd, Math.floor(rnd() * 600));
    await check(i % 2 === 0 ? body : new Uint8Array([...head, ...body]), `A#${i}`);
  }
});

test(`퍼징 B: 내보낸 .3dm 변조 ${N_B}건 (바이트 뒤집기·구간 삭제·복제·잘라내기·삽입)`, async () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < N_B; i++) {
    let b = [...(i % 3 === 0 ? MIXED : BASE)];
    const ops = 1 + Math.floor(rnd() * 4);
    for (let n = 0; n < ops; n++) {
      const p = Math.floor(rnd() * b.length);
      const kind = Math.floor(rnd() * 5);
      if (kind === 0) b[p] = Math.floor(rnd() * 256);
      else if (kind === 1) b.splice(p, Math.floor(rnd() * 40));
      else if (kind === 2) b.splice(p, 0, ...b.slice(p, p + Math.floor(rnd() * 80)));
      else if (kind === 3) b = b.slice(0, p);
      else b.splice(p, 0, ...rbytes(rnd, Math.floor(rnd() * 12)));
      if (b.length === 0) b = [0];
    }
    await check(new Uint8Array(b), `B#${i}`);
  }
});

test(`퍼징 C: 단일 바이트 변조 ${N_C}건 (구조는 유지하고 값만 바꿔 메시·단위 단계로 깊이 들어감)`, async () => {
  const rnd = mulberry32(424242);
  for (let i = 0; i < N_C; i++) {
    const b = new Uint8Array(i % 2 === 0 ? BASE : MIXED);
    b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    await check(b, `C#${i}`);
  }
});

test("퍼징 요약: 건수 일치, 성공·오류가 모두 관찰됨, 내부 오류 0, 시간 초과 ≤ 10%", () => {
  assert.equal(counts.total, N_TOTAL);
  assert.ok((counts.timeouts ?? 0) <= N_TOTAL * 0.1, `시간 초과 ${counts.timeouts}건 > 10%`);
  assert.ok((counts.ok ?? 0) > 0 && (counts.error ?? 0) > 0, JSON.stringify(counts));
  assert.equal(codes.get("R3DM_INTERNAL") ?? 0, 0);
  console.log(JSON.stringify({ fuzz_counts: counts, error_codes: [...codes] }));
});
