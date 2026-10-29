import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobsDb, StoragePath } from "../core/db.ts";
import { FakeClock } from "../core/fake-clock.test-util.ts";
import { createLogger } from "../core/log.ts";
import { CRON_INTERVALS, DAY_MS, HOUR_MS, MINUTE_MS, nextRunAt, planTick, REAP_STALE_SECONDS } from "./schedule.ts";
import { runScheduler, type CronTask } from "./scheduler.ts";
import { createCronTasks, createSettleCaller, removeGrouped } from "./tasks.ts";

const silent = createLogger([], () => {});

test("크론 주기는 02장 4절과 같다: reap 10분·정산 5분·녹음 1시간·purge 매일·크레딧 지급 매일·주문 만료 매시간", () => {
  assert.deepEqual(CRON_INTERVALS, {
    reap: 10 * MINUTE_MS,
    settle: 5 * MINUTE_MS,
    voice_audio: HOUR_MS,
    purge_expired: DAY_MS,
    credit_grants: DAY_MS,
    payment_orders: HOUR_MS,
  });
  assert.equal(REAP_STALE_SECONDS, 600);
});

test("nextRunAt: 처음은 즉시, 이후 고정 주기, 밀리면 지금", () => {
  assert.equal(nextRunAt(null, 100, 50), 50);
  assert.equal(nextRunAt(1000, 100, 1050), 1100);
  assert.equal(nextRunAt(1000, 100, 1500), 1500);
});

test("planTick: 만기 작업과 다음 깨어날 시각", () => {
  const intervals = { a: 100, b: 300 };
  assert.deepEqual(planTick({ a: null, b: null }, intervals, 0), { due: ["a", "b"], wakeAt: 100 });
  assert.deepEqual(planTick({ a: 0, b: 0 }, intervals, 100), { due: ["a"], wakeAt: 200 });
  assert.deepEqual(planTick({ a: 100, b: 0 }, intervals, 150), { due: [], wakeAt: 200 });
});

test("스케줄러: 하루 동안 작업별 실행 횟수가 주기와 맞고, 실패해도 계속한다", async () => {
  const clock = new FakeClock();
  const stop = new AbortController();
  const counts: Record<string, number> = {};
  const tasks: CronTask[] = Object.entries(CRON_INTERVALS).map(([name, intervalMs]) => ({
    name,
    intervalMs,
    async run() {
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === "voice_audio" && clock.now() >= DAY_MS) stop.abort();
      if (name === "settle") throw new Error("web down");
    },
  }));
  await runScheduler(tasks, clock, silent, stop.signal);
  // [0, DAY] 양 끝 포함(이름순 마지막 voice_audio가 DAY에 돌면 멈춘다)
  assert.deepEqual(counts, { credit_grants: 2, payment_orders: 25, purge_expired: 2, reap: 145, settle: 289, voice_audio: 25 });
});

function fakeDb(rows: { purge?: StoragePath[]; voice?: StoragePath[]; orgs?: string[] }) {
  const calls: string[] = [];
  const db: Partial<JobsDb> = {
    reapStaleJobs: async (s) => (calls.push(`reap:${s}`), 1),
    orgsWithActiveRuns: async () => rows.orgs ?? [],
    reconcileRuns: async (org) => (calls.push(`reconcile:${org}`), 1),
    purgeExpired: async () => rows.purge ?? [],
    expireVoiceAudio: async (limit) => (calls.push(`voice:${limit}`), rows.voice ?? []),
    runMonthlyCreditGrants: async () => (calls.push("grants"), 0),
    expireStalePaymentOrders: async () => (calls.push("orders"), 0),
    removeObjects: async (bucket, paths) => {
      calls.push(`remove:${bucket}:${paths.length}`);
    },
  };
  return { db: db as JobsDb, calls };
}

test("reap: reap_stale_jobs(600) 직후 활성 조직마다 reconcile_runs", async () => {
  const { db, calls } = fakeDb({ orgs: ["o1", "o2"] });
  const reap = createCronTasks({ db, log: silent, settle: async () => {} }).find((t) => t.name === "reap");
  await reap?.run();
  assert.deepEqual(calls, ["reap:600", "reconcile:o1", "reconcile:o2"]);
});

test("purge·녹음: 반환 경로를 버킷별 1000개 묶음으로 지운다", async () => {
  const purge = Array.from({ length: 1001 }, (_, i) => ({ bucket: "org-files", path: `p${i}` }));
  const { db, calls } = fakeDb({ purge, voice: [{ bucket: "voice-audio", path: "v1" }] });
  const tasks = createCronTasks({ db, log: silent, settle: async () => {} });
  await tasks.find((t) => t.name === "purge_expired")?.run();
  await tasks.find((t) => t.name === "voice_audio")?.run();
  assert.deepEqual(calls, ["remove:org-files:1000", "remove:org-files:1", "voice:500", "remove:voice-audio:1"]);
  assert.equal(await removeGrouped(db, [{ bucket: "x", path: "" }]), 0);
});

test("정산 호출: 워커 키 Bearer, 실패 상태는 오류", async () => {
  let auth = "";
  const ok = createSettleCaller({
    baseUrl: "https://web.example",
    workerKey: "wk-123456789",
    fetch: (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization ?? "";
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch,
  });
  await ok();
  assert.equal(auth, "Bearer wk-123456789");
  const bad = createSettleCaller({
    baseUrl: "https://web.example",
    workerKey: "k",
    fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
  });
  await assert.rejects(bad(), /HTTP 500/);
});

test("크레딧 지급·주문 만료 크론은 각 RPC를 부른다", async () => {
  const { db, calls } = fakeDb({});
  const tasks = createCronTasks({ db, log: silent, settle: async () => {} });
  assert.deepEqual(tasks.map((t) => t.name).sort(), Object.keys(CRON_INTERVALS).sort());
  await tasks.find((t) => t.name === "credit_grants")?.run();
  await tasks.find((t) => t.name === "payment_orders")?.run();
  assert.deepEqual(calls, ["grants", "orders"]);
});
