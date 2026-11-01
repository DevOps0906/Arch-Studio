import assert from "node:assert/strict";
import { test } from "node:test";
import { loadRenderConfig } from "../../config.ts";
import type { JobRow } from "../../core/db.ts";
import { JobError } from "../../core/errors.ts";
import { buildHandlers } from "../../handlers.ts";
import { createRenderHandler, RENDER_INPUT_MAX_BYTES } from "./handler.ts";
import { mockRenderProvider } from "./mock-provider.ts";
import type { RenderProvider } from "./provider.ts";
import type { RenderStorage } from "./storage.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUT = "77777777-7777-4777-8777-777777777777";
const DEPTH = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999991.png`;
const EDGE = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999992.png`;

function png(width: number, height: number, extra = 9): Uint8Array {
  const b = new Uint8Array(24 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function job(payload: Record<string, unknown> = {}): JobRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    org_id: ORG,
    queue: "arch.render",
    job_type: "arch.render",
    payload: { run_id: RUN, variant: "render_std", quality: "standard", preset: { material: "concrete" }, inputs: { depth_path: DEPTH, edge_path: EDGE }, max_px: 1024, ...payload },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    credit_ledger_id: 1,
    run_after: "",
    last_error: null,
  };
}

function fakeStorage(objects: Map<string, Uint8Array>, uploads: { bucket: string; path: string; bytes: number }[], failDownload = false): RenderStorage {
  return {
    async download(_bucket, path) {
      if (failDownload) throw new Error("network");
      const b = objects.get(path);
      if (!b) throw new Error("not found");
      return b;
    },
    async uploadPng(bucket, path, bytes) {
      uploads.push({ bucket, path, bytes: bytes.byteLength });
    },
  };
}

function objects(): Map<string, Uint8Array> {
  return new Map([
    [DEPTH, png(800, 600)],
    [EDGE, png(800, 600)],
  ]);
}

async function run(j: JobRow, provider: RenderProvider = mockRenderProvider(), objs = objects(), failDownload = false) {
  const uploads: { bucket: string; path: string; bytes: number }[] = [];
  const beats: string[] = [];
  const handler = createRenderHandler({ provider, storage: fakeStorage(objs, uploads, failDownload), randomUUID: () => OUT });
  const result = await handler({ job: j, signal: new AbortController().signal, heartbeat: async (_p, m) => void beats.push(m ?? "") });
  return { result, uploads, beats };
}

async function rejectsWith(p: Promise<unknown>, code: string, retryable = false): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof JobError && e.code === code && e.retryable === retryable);
}

test("render 핸들러(모의): PNG를 org-files <org>/arch/render/<uuid>.png에 저장, ai_label·크기·제공자 기록", async () => {
  const { result, uploads, beats } = await run(job());
  assert.deepEqual(uploads, [{ bucket: "org-files", path: `${ORG}/arch/render/${OUT}.png`, bytes: 33 }]);
  assert.deepEqual(result?.runResult, {
    output_path: `${ORG}/arch/render/${OUT}.png`,
    width: 800,
    height: 600,
    bytes: 33,
    provider: "mock",
    model: "mock-echo-v1",
    seed: 0,
    ai_label: true,
  });
  assert.deepEqual(beats.map((m) => (JSON.parse(m) as { stage: string }).stage), ["submit", "generate", "persist"]);
});

test("render 핸들러: high·upscale payload는 재시도 없이 실패(결정 전)", async () => {
  await rejectsWith(run(job({ quality: "high", variant: "render_hq" })), "unsupported_quality");
  await rejectsWith(run(job({ quality: "upscale", variant: "upscale" })), "unsupported_quality");
});

test("render 핸들러: 다른 조직·다른 목적 입력 경로 거부", async () => {
  const other = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/arch/render_input/99999999-9999-4999-8999-999999999991.png";
  await rejectsWith(run(job({ inputs: { depth_path: other, edge_path: EDGE } })), "bad_payload");
  await rejectsWith(run(job({ inputs: { depth_path: `${ORG}/arch/render/99999999-9999-4999-8999-999999999991.png`, edge_path: EDGE } })), "bad_payload");
});

test("render 핸들러: 입력 재검사(PNG 아님·10MB 초과·max_px 초과) 재시도 없이 실패", async () => {
  const notPng = objects();
  notPng.set(EDGE, new Uint8Array(40));
  await rejectsWith(run(job(), undefined, notPng), "bad_input");
  const big = objects();
  big.set(DEPTH, png(10, 10, RENDER_INPUT_MAX_BYTES));
  await rejectsWith(run(job(), undefined, big), "AR031");
  const wide = objects();
  wide.set(DEPTH, png(1025, 10));
  await rejectsWith(run(job(), undefined, wide), "AR031");
});

test("render 핸들러: 입력 내려받기 실패만 재시도, 제공자 실패·PNG 아닌 출력은 재시도 없음", async () => {
  await rejectsWith(run(job(), undefined, objects(), true), "storage", true);
  const failing: RenderProvider = { name: "x", model: "x", render: async () => Promise.reject(new Error("boom")) };
  await rejectsWith(run(job(), failing), "AI_UNAVAILABLE");
  const jpeg: RenderProvider = { name: "x", model: "x", render: async () => ({ png: new Uint8Array([0xff, 0xd8, 0xff]), seed: 1 }) };
  await rejectsWith(run(job(), jpeg), "AR032");
});

// 웹 apps/web/src/server/ai/render/service.test.ts의 RENDER_CONFIG_CASES와 같은 표(바꾸면 양쪽 함께). [env, 켜짐 = 스위치 on && 제공자 있음]
const RENDER_CONFIG_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, true],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "test" }, true],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "production" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "staging" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", NODE_ENV: "development" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "fal", NODE_ENV: "production" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "MOCK", NODE_ENV: "development" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "1", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "TRUE", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{}, false],
];

test("설정·등록: 웹과 같은 표 — 켜짐일 때만 arch.render 등록", () => {
  const storage = () => fakeStorage(new Map(), []);
  for (const [env, expected] of RENDER_CONFIG_CASES) {
    const c = loadRenderConfig(env);
    assert.equal(c.enabled && c.provider !== null, expected, JSON.stringify(env));
    assert.equal("arch.render" in buildHandlers(env, storage), expected, JSON.stringify(env));
  }
});

test("설정: 스위치는 정확히 'true'만, 모의 제공자는 NODE_ENV development·test에서만", () => {
  assert.deepEqual(loadRenderConfig({ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }), { enabled: true, provider: "mock" });
  assert.equal(loadRenderConfig({ ARCH_AI_RENDER_ENABLED: "1" }).enabled, false);
  assert.equal(loadRenderConfig({}).enabled, false);
  for (const nodeEnv of ["production", undefined, "", "staging"]) {
    assert.equal(loadRenderConfig({ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: nodeEnv }).provider, null, String(nodeEnv));
  }
});

test("등록: 스위치 off·운영·제공자 없음이면 arch.render 미등록(claim 안 함), dev+mock+on이면 등록", () => {
  const storage = () => fakeStorage(new Map(), []);
  assert.deepEqual(Object.keys(buildHandlers({}, storage)), []);
  assert.deepEqual(Object.keys(buildHandlers({ ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, storage)), []);
  assert.deepEqual(Object.keys(buildHandlers({ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "production" }, storage)), []);
  assert.deepEqual(Object.keys(buildHandlers({ ARCH_AI_RENDER_ENABLED: "true", NODE_ENV: "development" }, storage)), []);
  assert.deepEqual(Object.keys(buildHandlers({ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "test" }, storage)), ["arch.render"]);
});
