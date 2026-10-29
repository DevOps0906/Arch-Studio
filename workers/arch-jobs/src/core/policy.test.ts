import assert from "node:assert/strict";
import { test } from "node:test";
import { JobError, JobTimeoutError, DbError, classifyError } from "./errors.ts";
import { FakeClock } from "./fake-clock.test-util.ts";
import { idleDelayMs, JOB_POLICIES, policyFor, retryAt, withTimeout } from "./policy.ts";

test("타임아웃: 02장 4절 렌더 3분·검토 10분", () => {
  assert.equal(JOB_POLICIES["arch.render"]?.timeoutMs, 180_000);
  assert.equal(JOB_POLICIES["arch.review"]?.timeoutMs, 600_000);
  assert.equal(policyFor("unknown.type").retryOnTimeout, false);
});

test("retryAt은 fail_job 백오프와 같다: base*2^(attempts-1)", () => {
  assert.equal(retryAt(1_000, 1, 60), 61_000);
  assert.equal(retryAt(1_000, 2, 60), 121_000);
  assert.equal(retryAt(0, 0, 60), 60_000);
});

test("idleDelayMs: 지수 증가 후 상한", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map((n) => idleDelayMs(n, 1000, 15_000)), [1000, 2000, 4000, 8000, 15_000, 15_000]);
});

test("withTimeout: 시간 안에 끝나면 값", async () => {
  const clock = new FakeClock();
  assert.equal(await withTimeout(async () => 7, 1000, clock), 7);
  assert.equal(clock.timers.size, 0);
});

test("withTimeout: 초과하면 JobTimeoutError + signal abort", async () => {
  const clock = new FakeClock();
  let seen: AbortSignal | undefined;
  const p = withTimeout((signal) => {
    seen = signal;
    return new Promise<never>(() => {});
  }, 1000, clock);
  clock.advance(999);
  assert.equal(seen?.aborted, false);
  clock.advance(1);
  await assert.rejects(p, JobTimeoutError);
  assert.equal(seen?.aborted, true);
});

test("withTimeout: 바깥 signal을 전달한다", async () => {
  const clock = new FakeClock();
  const outer = new AbortController();
  let seen: AbortSignal | undefined;
  const p = withTimeout((signal) => {
    seen = signal;
    return new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  }, 1000, clock, outer.signal);
  outer.abort();
  await assert.rejects(p, /aborted/);
  assert.equal(seen?.aborted, true);
});

test("classifyError: 재시도 분류", () => {
  assert.deepEqual(classifyError(new JobTimeoutError(1), true), { retryable: true, reason: "timeout" });
  assert.deepEqual(classifyError(new JobTimeoutError(1), false), { retryable: false, reason: "timeout" });
  assert.deepEqual(classifyError(new JobError("x", { retryable: true, code: "provider" }), false), { retryable: true, reason: "provider" });
  assert.deepEqual(classifyError(new DbError("finish_ai_run", "x", "AR033"), true), { retryable: false, reason: "db_AR033" });
  assert.deepEqual(classifyError(new TypeError("fetch failed"), false), { retryable: true, reason: "network" });
  assert.deepEqual(classifyError(new Error("boom"), true), { retryable: false, reason: "error" });
});
