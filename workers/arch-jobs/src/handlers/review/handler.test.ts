// arch.review 핸들러: 그래프 시작·폴링·결과 사전 검사(AR033), 실패 분류, 10분 초과 환불(러너 정책), 스위치 표(웹과 같음).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRow, JobsDb } from "../../core/db.ts";
import { DbError, JobError } from "../../core/errors.ts";
import { FakeClock } from "../../core/fake-clock.test-util.ts";
import { createLogger } from "../../core/log.ts";
import { processJob, type HandlerContext } from "../../core/runner.ts";
import { loadReviewConfig } from "./config.ts";
import { GraphHttpError, parseView, type GraphClient, type GraphRunView } from "./graph-client.ts";
import { createReviewHandler, REVIEW_SCOPE } from "./handler.ts";
import { buildReviewHandler } from "./register.ts";

const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const GRAPH_RUN = "99999999-9999-4999-8999-000000000001";
const PAYLOAD = { run_id: RUN, variant: "review", rule_pack_version: "2026.10.0", application_date: "2026-03-01", municipality_code: "1168010100" };
const RESULT = {
  schema_version: "review.v1",
  rule_pack_version: "2026.10.0",
  items: [{ key: "far", verdict: "FAIL", sentences: [{ text: "용적률 초과.", source_ids: ["far-law@2020-01-01#0"] }] }],
  needs_check: [],
  sources: [{ id: "far-law@2020-01-01#0", law: "건축법", article: "제56조", effective_from: "2020-01-01", kind: "law" }],
  disclaimer_version: "arch-review-disclaimer.v1",
};

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    org_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    queue: "arch.review",
    job_type: "arch.review",
    payload: { ...PAYLOAD },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    credit_ledger_id: 10,
    run_after: "",
    last_error: null,
    ...over,
  };
}

function view(over: Partial<GraphRunView> = {}): GraphRunView {
  return { graph_run_id: GRAPH_RUN, run_id: RUN, status: "running", ...over };
}

function world(sequence: (GraphRunView | Error)[]) {
  const calls: string[] = [];
  const beats: string[] = [];
  let i = 0;
  const next = () => {
    const v = sequence[Math.min(i, sequence.length - 1)] as GraphRunView | Error;
    i += 1;
    if (v instanceof Error) throw v;
    return v;
  };
  const graph: GraphClient = {
    async start(runId, token) {
      calls.push(`start:${runId}:${token}`);
      return next();
    },
    async get(id, token) {
      calls.push(`get:${id}:${token}`);
      return next();
    },
  };
  let t = 0;
  const tokens = {
    async get(jobId: string, scope: string) {
      t += 1;
      calls.push(`token:${scope}`);
      assert.equal(jobId, job().id);
      return `tok${t}`;
    },
  };
  const handler = createReviewHandler({ tokens, graph, sleep: async () => {}, pollMs: 1 });
  const ctx = (j = job()): HandlerContext => ({
    job: j,
    signal: new AbortController().signal,
    heartbeat: async (_p, m) => void beats.push(m ?? ""),
  });
  return { handler, ctx, calls, beats };
}

test("성공: 토큰(graph:arch.review) → 시작 → 폴링 → stage 하트비트 → runResult(결과 그대로)·jobResult(id만)", async () => {
  const w = world([view({ status: "accepted" }), view({ stage: "retrieve" }), view({ stage: "interpret" }), view({ status: "succeeded", stage: "compliance", result: RESULT })]);
  const out = await w.handler(w.ctx());
  assert.deepEqual(out, { runResult: RESULT, jobResult: { run_id: RUN, graph_run_id: GRAPH_RUN } });
  assert.equal(w.calls[0], `token:${REVIEW_SCOPE}`);
  assert.equal(w.calls[1], `start:${RUN}:tok1`);
  assert.deepEqual(w.beats.map((b) => JSON.parse(b).stage), ["load", "retrieve", "interpret", "compliance"]);
});

test("출처 없는 문장·문장 0·형식 오류 결과 → AR033(재시도 없음)", async () => {
  const bad = [
    { ...RESULT, items: [{ key: "far", verdict: "FAIL", sentences: [{ text: "출처 없음.", source_ids: [] }] }] },
    { ...RESULT, items: [{ key: "far", verdict: "FAIL", sentences: [] }], needs_check: [] },
    { ...RESULT, needs_check: [{ text: "확인.", source_ids: [""] }] },
    { ...RESULT, schema_version: "review.v2" },
  ];
  for (const result of bad) {
    const w = world([view({ status: "succeeded", result })]);
    await assert.rejects(w.handler(w.ctx()), (e: unknown) => e instanceof JobError && e.code === "AR033" && !e.retryable);
  }
});

test("그래프 실패: AR033은 재시도 없음, AI_UNAVAILABLE은 재시도, 알 수 없는 코드는 재시도 없음", async () => {
  const cases: [GraphRunView["error"], string, boolean][] = [
    [{ code: "AR033" }, "AR033", false],
    [{ code: "AI_UNAVAILABLE" }, "AI_UNAVAILABLE", true],
    [{ code: "bad_snapshot" }, "bad_snapshot", false],
    [{ code: "x y <script>" }, "graph_failed", false],
  ];
  for (const [error, code, retryable] of cases) {
    const w = world([view({ status: "failed", ...(error ? { error } : {}) })]);
    await assert.rejects(w.handler(w.ctx()), (e: unknown) => e instanceof JobError && e.code === code && e.retryable === retryable);
  }
});

test("폴링 중 401 → 잡 토큰 1회 새로 받아 재시도, 5xx는 재시도 가능 오류", async () => {
  const w = world([view(), new GraphHttpError(401), view({ status: "succeeded", result: RESULT })]);
  await w.handler(w.ctx());
  assert.deepEqual(w.calls.filter((c) => c.startsWith("get:")), [`get:${GRAPH_RUN}:tok1`, `get:${GRAPH_RUN}:tok2`]);
  const e = world([new GraphHttpError(503)]);
  await assert.rejects(e.handler(e.ctx()), (x: unknown) => x instanceof JobError && x.retryable);
});

test("payload 검사: run_id·형식이 틀리면 재시도 없는 실패(그래프·토큰 호출 0)", async () => {
  for (const payload of [{ ...PAYLOAD, run_id: "x" }, { ...PAYLOAD, municipality_code: "T-OK" }, { ...PAYLOAD, variant: "render_std" }, {}]) {
    const w = world([view()]);
    await assert.rejects(w.handler(w.ctx(job({ payload }))), (e: unknown) => e instanceof JobError && e.code === "bad_payload");
    assert.deepEqual(w.calls, []);
  }
  const w = world([view({ run_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002" })]);
  await assert.rejects(w.handler(w.ctx()), (e: unknown) => e instanceof JobError && e.code === "graph_bad_response");
});

function fakeDb(final: boolean, finishError?: Error) {
  const calls: string[] = [];
  const db: Partial<JobsDb> = {
    runStatus: async () => "running",
    heartbeat: async () => true,
    finishAiRun: async (runId) => {
      calls.push(`finish:${runId}`);
      if (finishError) throw finishError;
      return {};
    },
    completeJob: async (id) => (calls.push(`complete:${id}`), job({ status: "succeeded" })),
    failJob: async (id, _w, error, retryable) => (calls.push(`fail_job:${retryable}:${error.split(":")[0]}`), job({ status: final ? "failed" : "queued" })),
    failAiRun: async (runId, reason) => (calls.push(`fail_ai_run:${runId}:${reason}`), { status: "refunded" }),
  };
  return { db: db as JobsDb, calls };
}

function runnerDeps(db: JobsDb, handler: ReturnType<typeof createReviewHandler>, clock: FakeClock) {
  // policyFor 생략: 실제 정책(arch.review 10분, 타임아웃 재시도 1회)을 쓴다.
  return { db, handlers: { "arch.review": handler }, workerId: "w1", clock, log: createLogger([], () => {}), secrets: [], retryDelaySeconds: 60, heartbeatMs: 30_000 };
}

test("10분 초과: 첫 시도는 재시도, 마지막 시도는 fail_ai_run(전액 환불)", async () => {
  for (const final of [false, true]) {
    const clock = new FakeClock();
    const { db, calls } = fakeDb(final);
    const graph: GraphClient = { start: async () => view(), get: async () => view() };
    const handler = createReviewHandler({
      tokens: { get: async () => "tok" },
      graph,
      sleep: (_ms, signal) => new Promise((r) => signal.addEventListener("abort", () => r())),
      pollMs: 5_000,
    });
    const p = processJob(job({ attempts: final ? 2 : 1 }), runnerDeps(db, handler, clock));
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    clock.advance(10 * 60 * 1000 - 1);
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    assert.ok(!calls.some((c) => c.startsWith("fail_job")), "10분 전에는 끊지 않는다");
    clock.advance(1);
    assert.equal(await p, final ? "failed" : "retry");
    assert.equal(calls[0], "fail_job:true:JobTimeoutError");
    if (final) assert.equal(calls[1], `fail_ai_run:${RUN}:timeout`);
    else assert.equal(calls.length, 1);
  }
});

test("DB finish_ai_run AR033 → 재시도 없이 fail_ai_run(환불)", async () => {
  const { db, calls } = fakeDb(true, new DbError("finish_ai_run", "sentences without sources", "AR033"));
  const handler = createReviewHandler({
    tokens: { get: async () => "tok" },
    graph: { start: async () => view({ status: "succeeded", result: RESULT }), get: async () => view() },
    sleep: async () => {},
  });
  assert.equal(await processJob(job(), runnerDeps(db, handler, new FakeClock())), "failed");
  assert.deepEqual(calls, [`finish:${RUN}`, "fail_job:false:DbError", `fail_ai_run:${RUN}:db_AR033`]);
});

test("응답 봉투 파싱: ok·UUID·status 검사, result·error만 통과", () => {
  const v = parseView({ ok: true, data: { graph_run_id: GRAPH_RUN, run_id: RUN, graph: "arch.review", status: "failed", error: { code: "AR033", retryable: false } } });
  assert.deepEqual(v, { graph_run_id: GRAPH_RUN, run_id: RUN, status: "failed", error: { code: "AR033", retryable: false } });
  assert.throws(() => parseView({ ok: false, error: {} }), JobError);
  assert.throws(() => parseView({ ok: true, data: { graph_run_id: "x", run_id: RUN, status: "running" } }), JobError);
  assert.throws(() => parseView({ ok: true, data: { graph_run_id: GRAPH_RUN, run_id: RUN, status: "done" } }), JobError);
});

// 웹 service.test.ts의 REVIEW_CONFIG_CASES와 같은 표(바꾸면 양쪽 함께).
const REVIEW_CONFIG_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "https://ai.example.com" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://127.0.0.1:8000" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://localhost:8000/" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://ai.example.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://localhost.evil.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "true" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "TRUE", ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "1", ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{ ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{}, false],
];

test("스위치: 웹과 같은 표 · 꺼짐이면 핸들러 미등록(큐 claim 안 함)", () => {
  const core = { ARCH_WEB_URL: "https://web.example.com", ARCH_WORKER_INTERNAL_KEY: "k" };
  const make = { tokens: () => ({ get: async () => "t" }), graph: () => ({ start: async () => view(), get: async () => view() }) };
  for (const [env, expected] of REVIEW_CONFIG_CASES) {
    const cfg = loadReviewConfig(env);
    assert.equal(cfg.enabled && cfg.apiUrl !== null, expected, JSON.stringify(env));
    assert.equal(buildReviewHandler({ ...env, ...core }, make) !== null, expected, JSON.stringify(env));
  }
  assert.equal(buildReviewHandler({ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "https://ai.example.com" }, make), null);
});
