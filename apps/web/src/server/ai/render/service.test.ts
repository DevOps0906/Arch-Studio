// POST /api/ai/render: 스위치·동의·입력 재검사·quality 거부·동시 상한·멱등(AR-06-056 0·1단계). 차감은 가짜 start_ai_run이 센다.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import type { RunStarter } from "../gateway/start-run.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { isRenderEnabled } from "./config.ts";
import { readPngSize } from "./png.ts";
import { handleRender, RENDER_INPUT_MAX_BYTES, type RenderDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const DEPTH = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999991.png`;
const EDGE = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999992.png`;
const NOW = Date.UTC(2026, 10, 1, 3, 0, 0);

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

interface Obj {
  size: number;
  bytes: Uint8Array;
}

interface World {
  enabled: boolean;
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  ack: boolean;
  objects: Map<string, Obj>;
  storageFails?: boolean;
  /** 가짜 DB: request_id → 실행. 활성 렌더 수로 AR030을 낸다(start_ai_run 2401 조직 직렬화와 같은 판정). */
  runs: Map<string, { run_id: string; job_id: string; credits: number }>;
  charged: number;
  starterCalls: number;
  storeCalls: number;
}

function world(over: Partial<World> = {}): World {
  return {
    enabled: true,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    features: { ai_render: true, render_max_px: 1024 },
    ack: true,
    objects: new Map([
      [DEPTH, { size: 5000, bytes: png(1024, 768) }],
      [EDGE, { size: 4000, bytes: png(1024, 768) }],
    ]),
    runs: new Map(),
    charged: 0,
    starterCalls: 0,
    storeCalls: 0,
    ...over,
  };
}

let seq = 0;
function fakeStarter(w: World): RunStarter {
  return {
    async startAiRun(args) {
      w.starterCalls += 1;
      const existing = w.runs.get(args.p_request_id);
      if (existing) return [existing];
      if (args.p_variant !== "render_std") throw Object.assign(new Error("x"), { code: "22023" });
      if (w.runs.size >= 3) throw Object.assign(new Error("start_ai_run: too many active renders"), { code: "AR030" });
      seq += 1;
      const hex = seq.toString(16).padStart(12, "0");
      const row = { run_id: `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`, job_id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`, credits: 3 };
      w.runs.set(args.p_request_id, row);
      w.charged += 3;
      return [row];
    },
    async runExists(requestId) {
      return w.runs.has(requestId);
    },
  };
}

function deps(w: World): RenderDeps {
  return {
    enabled: () => w.enabled,
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    org: () => ({ orgFeatures: async () => w.features, hasCrossBorderAck: async () => w.ack }),
    inputs: () => ({
      async size(path) {
        w.storeCalls += 1;
        if (w.storageFails) throw new Error(`storage 500 ${path} service_role=secret`);
        return w.objects.get(path)?.size ?? null;
      },
      async head(path, n) {
        w.storeCalls += 1;
        return (w.objects.get(path)?.bytes ?? new Uint8Array()).slice(0, n);
      },
    }),
    starter: () => fakeStarter(w),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
  };
}

let reqSeq = 0;
function rid(): string {
  reqSeq += 1;
  return `22222222-2222-4222-8222-${reqSeq.toString(16).padStart(12, "0")}`;
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: rid(),
    project_ref: PROJECT,
    quality: "standard",
    preset: { material: "concrete", time_of_day: "day", season: "summer" },
    inputs: { depth_path: DEPTH, edge_path: EDGE },
    ...over,
  };
}

function req(b: unknown): Request {
  return new Request("http://localhost/api/ai/render", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-access-token-value-0123456789" },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

function quiet(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

async function call(w: World, b: unknown = body()): Promise<{ status: number; json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } } }> {
  const res = await handleRender(req(b), deps(w));
  return { status: res.status, json: (await res.json()) as never };
}

test("render: 정상 → 202 { run_id, job_id, credits } · render_std · options에 경로·preset만", async (t) => {
  quiet(t);
  const w = world();
  const calls: unknown[] = [];
  const d = deps(w);
  const base = d.starter();
  d.starter = () => ({ ...base, startAiRun: async (args) => (calls.push(args), base.startAiRun(args)) });
  const res = await handleRender(req(body()), d);
  assert.equal(res.status, 202);
  const json = (await res.json()) as { data: Record<string, unknown> };
  assert.deepEqual(Object.keys(json.data).sort(), ["credits", "job_id", "run_id"]);
  const args = calls[0] as Record<string, unknown>;
  assert.equal(args.p_kind, "render");
  assert.equal(args.p_variant, "render_std");
  assert.equal(args.p_org, ORG);
  assert.equal(args.p_actor, USER);
  assert.deepEqual(args.p_options, { preset: { material: "concrete", time_of_day: "day", season: "summer" }, inputs: { depth_path: DEPTH, edge_path: EDGE } });
  assert.equal(w.charged, 3);
});

// 워커 handler.test.ts의 RENDER_CONFIG_CASES와 같은 표(바꾸면 양쪽 함께). [env, 켜짐 = 스위치 on && 제공자 있음]
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

test("스위치: 'true' + 사용 가능한 제공자(dev·test의 mock)일 때만 켬 — 워커와 같은 표", () => {
  for (const [env, expected] of RENDER_CONFIG_CASES) assert.equal(isRenderEnabled(env), expected, JSON.stringify(env));
});

test("스위치 off → 503 · 세션·저장소·start_ai_run 호출 0 · 차감 0", async (t) => {
  quiet(t);
  const w = world({ enabled: false, session: new GatewayError("unauthorized") });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "ai_render_disabled");
  assert.equal(w.starterCalls, 0);
  assert.equal(w.storeCalls, 0);
  assert.equal(w.charged, 0);
});

test("국외 이전 동의 없음 → 403 AI002 · 저장소·start_ai_run 호출 0 · 차감 0", async (t) => {
  quiet(t);
  const w = world({ ack: false });
  const r = await call(w);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "AI002");
  assert.equal(w.starterCalls, 0);
  assert.equal(w.storeCalls, 0);
  assert.equal(w.charged, 0);
});

test("quality high·upscale → 422 22023 · 차감 0(결정 전 거부)", async (t) => {
  quiet(t);
  for (const b of [body({ quality: "high" }), body({ quality: "upscale", inputs: { source_render_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001" } }), body({ quality: "standard", inputs: { source_render_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001" } })]) {
    const w = world({ features: { ai_render: true, render_max_px: 4096 } });
    const r = await call(w, b);
    assert.equal(r.status, 422);
    assert.equal(r.json.error?.code, "22023");
    assert.equal(w.starterCalls, 0);
    assert.equal(w.charged, 0);
  }
});

test("매직바이트가 PNG가 아니면 415 · IHDR 깨짐 415 · 차감 0", async (t) => {
  quiet(t);
  const jpeg = new Uint8Array(33);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
  const badIhdr = png(10, 10);
  badIhdr.set([0x49, 0x44, 0x41, 0x54], 12); // IDAT가 먼저
  const zero = png(0, 10);
  for (const bytes of [jpeg, badIhdr, zero, png(10, 10).slice(0, 20)]) {
    const w = world();
    w.objects.set(EDGE, { size: 4000, bytes });
    const r = await call(w);
    assert.equal(r.status, 415);
    assert.equal(r.json.error?.code, "unsupported_media_type");
    assert.equal(w.charged, 0);
  }
});

test("크기 10MB 초과 → 413 AR031 · 정확히 10MB는 통과", async (t) => {
  quiet(t);
  const over = world();
  over.objects.set(DEPTH, { size: RENDER_INPUT_MAX_BYTES + 1, bytes: png(512, 512) });
  const r = await call(over);
  assert.equal(r.status, 413);
  assert.equal(r.json.error?.code, "AR031");
  assert.equal(over.charged, 0);

  const edge = world();
  edge.objects.set(DEPTH, { size: RENDER_INPUT_MAX_BYTES, bytes: png(512, 512) });
  assert.equal((await call(edge)).status, 202);
});

test("IHDR 폭·높이 > render_max_px → 413 AR031 · 같으면 통과 · 기능 값 없으면 1024", async (t) => {
  quiet(t);
  for (const [w0, h0] of [[1025, 10], [10, 1025]] as const) {
    const w = world();
    w.objects.set(EDGE, { size: 4000, bytes: png(w0, h0) });
    const r = await call(w);
    assert.equal(r.status, 413);
    assert.equal(r.json.error?.details?.max_px, 1024);
    assert.equal(w.charged, 0);
  }
  const big = world({ features: { ai_render: true, render_max_px: 2048 } });
  big.objects.set(DEPTH, { size: 4000, bytes: png(2048, 2048) });
  assert.equal((await call(big)).status, 202);

  const missing = world({ features: { ai_render: true } });
  missing.objects.set(DEPTH, { size: 4000, bytes: png(1100, 10) });
  assert.equal((await call(missing)).status, 413);
});

test("객체 없음·다른 조직 경로·다른 목적·확장자 → 422 23514 · 차감 0", async (t) => {
  quiet(t);
  const otherOrg = `${OTHER_ORG}/arch/render_input/99999999-9999-4999-8999-999999999991.png`;
  const otherPurpose = `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999991.svg`;
  const traversal = `${ORG}/arch/render_input/../render/99999999-9999-4999-8999-999999999991.png`;
  const absent = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999993.png`;
  for (const p of [otherOrg, otherPurpose, traversal, absent]) {
    const w = world();
    const r = await call(w, body({ inputs: { depth_path: p, edge_path: EDGE } }));
    assert.equal(r.status, 422, p);
    assert.equal(r.json.error?.code, "23514");
    assert.equal(w.charged, 0);
  }
});

test("저장소 오류 → 503 storage_unavailable · 원문 로그 0", async (t) => {
  const lines = quiet(t);
  const w = world({ storageFails: true });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(w.charged, 0);
  assert.ok(!lines.join("\n").includes("secret"));
  assert.ok(!lines.join("\n").includes("render_input"));
});

test("동시 4번째 → 429 AR030 · 같은 request_id 재전송은 추가 차감 없음", async (t) => {
  quiet(t);
  const w = world();
  const first = body();
  for (const b of [first, body(), body()]) assert.equal((await call(w, b)).status, 202);
  assert.equal(w.charged, 9);
  const fourth = await call(w);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.error?.code, "AR030");
  assert.equal(w.charged, 9);
  const replay = await call(w, first);
  assert.equal(replay.status, 202);
  assert.equal(w.charged, 9);
});

test("본문: 모르는 키(org_id·credits·format) 422 · request_id v4 아님 422 · 깨진 JSON 400", async (t) => {
  quiet(t);
  for (const extra of [{ org_id: OTHER_ORG }, { credits: 0 }, { format: "jpg" }]) {
    const w = world();
    assert.equal((await call(w, body(extra))).status, 422);
    assert.equal(w.starterCalls, 0);
  }
  const w = world();
  assert.equal((await call(w, body({ request_id: "22222222-2222-1222-8222-222222222222" }))).status, 422);
  assert.equal((await call(w, body({ preset: { material: "concrete", time_of_day: "day", season: "summer", extra: "x" } }))).status, 422);
  assert.equal((await call(w, "{")).status, 400);
  assert.equal(w.charged, 0);
});

test("권한: viewer 403 · 엔타이틀먼트 만료 402 · ai_render 없음 402 · 세션 없음 401", async (t) => {
  quiet(t);
  const s = { userId: USER, orgId: ORG, entitled: true, accessToken: "user-access-token-value-0123456789" };
  assert.equal((await call(world({ session: { ...s, role: "viewer" } }))).status, 403);
  assert.equal((await call(world({ session: { ...s, role: "member", entitled: false } }))).status, 402);
  assert.equal((await call(world({ features: { ai_render: false } }))).status, 402);
  assert.equal((await call(world({ session: new GatewayError("unauthorized") }))).status, 401);
});

test("레이트 리밋: 조직 20회/분 초과 429", async (t) => {
  quiet(t);
  const w = world({ ack: false }); // 동의 거부로 차감 없이 레이트만 센다
  const d = deps(w);
  for (let i = 0; i < 20; i += 1) assert.equal((await handleRender(req(body()), d)).status, 403);
  assert.equal((await handleRender(req(body()), d)).status, 429);
});

test("readPngSize: 정상 IHDR 읽기", () => {
  assert.deepEqual(readPngSize(png(640, 480)), { width: 640, height: 480 });
});
