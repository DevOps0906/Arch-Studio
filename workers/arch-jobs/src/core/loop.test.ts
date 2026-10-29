import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRow } from "./db.ts";
import { FakeClock } from "./fake-clock.test-util.ts";
import { createLogger } from "./log.ts";
import { runWorkerLoop } from "./loop.ts";

const row = (id: string, queue: string) => ({ id, queue, job_type: queue, payload: {} }) as unknown as JobRow;

test("루프: 큐를 돌며 빈 슬롯만큼 집고, 비면 대기를 늘리고, 종료 시 실행 중 잡을 기다린다", async () => {
  const clock = new FakeClock();
  const stop = new AbortController();
  const claims: string[] = [];
  const pending: Record<string, JobRow[]> = { a: [row("1", "a"), row("2", "a")], b: [row("3", "b")] };
  const done: string[] = [];
  await runWorkerLoop({
    queues: ["a", "b"],
    concurrency: 2,
    claim: async (q, limit) => {
      claims.push(`${q}:${limit}`);
      if (clock.sleeps.length >= 3) stop.abort();
      return (pending[q] ?? []).splice(0, limit);
    },
    process: async (job) => {
      await new Promise((r) => setImmediate(r));
      done.push(job.id);
    },
    clock,
    log: createLogger([], () => {}),
    signal: stop.signal,
    idleMinMs: 1000,
    idleMaxMs: 3000,
  });
  assert.deepEqual(claims[0], "a:2");
  assert.deepEqual(done.sort(), ["1", "2", "3"]);
  assert.deepEqual(clock.sleeps.slice(0, 3), [1000, 2000, 3000]);
});

test("루프: claim 오류는 기록하고 계속한다", async () => {
  const clock = new FakeClock();
  const stop = new AbortController();
  const logs: string[] = [];
  let n = 0;
  await runWorkerLoop({
    queues: ["a"],
    concurrency: 1,
    claim: async () => {
      if (++n >= 2) stop.abort();
      throw new Error("db down");
    },
    process: async () => {},
    clock,
    log: createLogger([], (l) => logs.push(l)),
    signal: stop.signal,
    idleMinMs: 10,
    idleMaxMs: 10,
  });
  assert.equal(n, 2);
  assert.ok(logs.length === 2 && logs.every((l) => l.includes("claim failed")));
});

test("루프: 큐 사이에서 종료 신호가 오면 다음 큐를 claim하지 않는다", async () => {
  const stop = new AbortController();
  const claims: string[] = [];
  await runWorkerLoop({
    queues: ["a", "b"],
    concurrency: 2,
    claim: async (q) => {
      claims.push(q);
      stop.abort();
      return [];
    },
    process: async () => {},
    clock: new FakeClock(),
    log: createLogger([], () => {}),
    signal: stop.signal,
    idleMinMs: 10,
    idleMaxMs: 10,
  });
  assert.deepEqual(claims, ["a"]);
});
