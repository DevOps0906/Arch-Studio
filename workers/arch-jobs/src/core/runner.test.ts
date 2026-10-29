import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRow, JobsDb } from "./db.ts";
import { DbError, JobError } from "./errors.ts";
import { FakeClock } from "./fake-clock.test-util.ts";
import { createLogger } from "./log.ts";
import { processJob, type JobHandler, type RunnerDeps } from "./runner.ts";

function job(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    org_id: "org-1",
    queue: "arch.test",
    job_type: "arch.test",
    payload: { run_id: "run-1" },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    credit_ledger_id: 10,
    run_after: "",
    last_error: null,
    ...over,
  };
}

function fakeDb(opts: { requeue?: boolean; heartbeatOk?: boolean; finishError?: Error; runStatus?: string } = {}) {
  const calls: string[] = [];
  const db: Partial<JobsDb> = {
    runStatus: async () => opts.runStatus ?? "queued",
    heartbeat: async () => {
      calls.push("heartbeat");
      return opts.heartbeatOk ?? true;
    },
    finishAiRun: async (runId) => {
      calls.push(`finish:${runId}`);
      if (opts.finishError) throw opts.finishError;
      return {};
    },
    completeJob: async (id) => {
      calls.push(`complete:${id}`);
      return job({ status: "succeeded" });
    },
    failJob: async (id, _w, error, retryable) => {
      calls.push(`fail_job:${id}:${retryable}:${error}`);
      return job({ status: opts.requeue ? "queued" : "failed" });
    },
    failAiRun: async (runId, reason) => {
      calls.push(`fail_ai_run:${runId}:${reason}`);
      return { status: "refunded" };
    },
  };
  return { db: db as JobsDb, calls };
}

function deps(db: JobsDb, handler: JobHandler | undefined, clock = new FakeClock(), timeoutMs = 1000): RunnerDeps {
  return {
    db,
    handlers: handler ? { "arch.test": handler } : {},
    workerId: "w1",
    clock,
    log: createLogger([], () => {}),
    secrets: ["very-secret-key-1"],
    retryDelaySeconds: 60,
    heartbeatMs: 100,
    policyFor: () => ({ timeoutMs, retryOnTimeout: true }),
  };
}

test("성공: finish_ai_run → complete_job", async () => {
  const { db, calls } = fakeDb();
  const out = await processJob(job(), deps(db, async () => ({ runResult: { ok: true } })));
  assert.equal(out, "succeeded");
  assert.deepEqual(calls, ["finish:run-1", "complete:job-1"]);
});

test("실행 행 없는 잡은 finish 없이 complete", async () => {
  const { db, calls } = fakeDb();
  const out = await processJob(job({ payload: {} }), deps(db, async () => {}));
  assert.equal(out, "succeeded");
  assert.deepEqual(calls, ["complete:job-1"]);
});

test("최종 실패: fail_job 다음 fail_ai_run, 메시지 마스킹", async () => {
  const { db, calls } = fakeDb();
  const out = await processJob(
    job(),
    deps(db, async () => {
      throw new JobError("provider down very-secret-key-1", { retryable: false, code: "provider" });
    }),
  );
  assert.equal(out, "failed");
  assert.deepEqual(calls, ["fail_job:job-1:false:JobError: provider down ***", "fail_ai_run:run-1:provider"]);
});

test("재시도 가능 실패로 재큐잉되면 fail_ai_run을 부르지 않는다", async () => {
  const { db, calls } = fakeDb({ requeue: true });
  const out = await processJob(job(), deps(db, async () => Promise.reject(new TypeError("fetch failed"))));
  assert.equal(out, "retry");
  assert.deepEqual(calls, ["fail_job:job-1:true:TypeError: fetch failed"]);
});

test("finish_ai_run 검증 실패(AR033)는 재시도 없이 실패·환불", async () => {
  const { db, calls } = fakeDb({ finishError: new DbError("finish_ai_run", "no sources", "AR033") });
  const out = await processJob(job(), deps(db, async () => ({ runResult: {} })));
  assert.equal(out, "failed");
  assert.equal(calls[1], "fail_job:job-1:false:DbError: finish_ai_run: no sources");
  assert.equal(calls[2], "fail_ai_run:run-1:db_AR033");
});

test("핸들러 없음·결과 없음은 재시도 없는 실패", async () => {
  const a = fakeDb();
  assert.equal(await processJob(job(), deps(a.db, undefined)), "failed");
  assert.match(a.calls[0] ?? "", /^fail_job:job-1:false:JobError: no handler/);
  const b = fakeDb();
  assert.equal(await processJob(job(), deps(b.db, async () => ({}))), "failed");
  assert.equal(b.calls[1], "fail_ai_run:run-1:no_result");
});

test("타임아웃: 하트비트 후 정책대로 재시도 요청, 타이머 정리", async () => {
  const clock = new FakeClock();
  const { db, calls } = fakeDb({ requeue: true });
  const p = processJob(job(), deps(db, () => new Promise<never>(() => {}), clock, 250));
  await new Promise((r) => setImmediate(r)); // runStatus 조회 뒤 핸들러가 시작될 때까지
  clock.advance(250);
  assert.equal(await p, "retry");
  assert.deepEqual(calls.slice(0, 2), ["heartbeat", "heartbeat"]);
  assert.match(calls[2] ?? "", /^fail_job:job-1:true:JobTimeoutError/);
  assert.equal(clock.timers.size, 0);
});

test("하트비트 잠금 상실: fail_job을 부르지 않고 끝낸다", async () => {
  const clock = new FakeClock();
  const { db, calls } = fakeDb({ heartbeatOk: false });
  const handler: JobHandler = ({ signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
  const p = processJob(job(), deps(db, handler, clock, 10_000));
  clock.advance(100);
  assert.equal(await p, "failed");
  assert.deepEqual(calls, ["heartbeat"]);
});

test("핸들러가 signal을 무시하고 정상 반환해도 잠금을 잃었으면 finish·complete 하지 않는다", async () => {
  const clock = new FakeClock();
  const { db, calls } = fakeDb({ heartbeatOk: false });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const p = processJob(
    job(),
    deps(db, async () => {
      await gate;
      return { runResult: { ok: true } };
    }, clock, 10_000),
  );
  await new Promise((r) => setImmediate(r));
  clock.advance(100);
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal(await p, "failed");
  assert.deepEqual(calls, ["heartbeat"]);
});

test("재claim 시 실행이 이미 succeeded면 핸들러 없이 complete만", async () => {
  const { db, calls } = fakeDb({ runStatus: "succeeded" });
  let ran = false;
  const out = await processJob(
    job({ attempts: 2 }),
    deps(db, async () => {
      ran = true;
      return { runResult: {} };
    }),
  );
  assert.equal(out, "succeeded");
  assert.equal(ran, false);
  assert.deepEqual(calls, ["complete:job-1"]);
});

test("finish_ai_run이 '이미 succeeded'(22023)면 complete로 넘어간다", async () => {
  const { db, calls } = fakeDb({ finishError: new DbError("finish_ai_run", "finish_ai_run: run is succeeded", "22023") });
  const out = await processJob(job(), deps(db, async () => ({ runResult: { ok: true } })));
  assert.equal(out, "succeeded");
  assert.deepEqual(calls, ["finish:run-1", "complete:job-1"]);
});
