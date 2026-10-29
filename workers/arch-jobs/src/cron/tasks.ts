// 크론 6종(02장 4절 스케줄 표). DB 쪽 작업은 service_role RPC, 정산은 웹 ai-gateway 내부 경로(워커 키)를 부른다.
import type { JobsDb, StoragePath } from "../core/db.ts";
import type { Logger } from "../core/log.ts";
import { CRON_INTERVALS, REAP_STALE_SECONDS } from "./schedule.ts";
import type { CronTask } from "./scheduler.ts";

const REMOVE_BATCH = 1000;
const VOICE_EXPIRE_LIMIT = 500;

export async function removeGrouped(db: JobsDb, rows: readonly StoragePath[]): Promise<number> {
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of rows) {
    if (!path) continue;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }
  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH);
      await db.removeObjects(bucket, batch);
      removed += batch.length;
    }
  }
  return removed;
}

export function createCronTasks(deps: { db: JobsDb; log: Logger; settle: () => Promise<void> }): CronTask[] {
  const { db, log } = deps;
  return [
    {
      name: "reap",
      intervalMs: CRON_INTERVALS.reap,
      async run() {
        const reaped = await db.reapStaleJobs(REAP_STALE_SECONDS);
        let reconciled = 0;
        for (const org of await db.orgsWithActiveRuns()) reconciled += await db.reconcileRuns(org);
        log.info("reap", { reaped, reconciled });
      },
    },
    { name: "settle", intervalMs: CRON_INTERVALS.settle, run: deps.settle },
    {
      name: "voice_audio",
      intervalMs: CRON_INTERVALS.voice_audio,
      async run() {
        const removed = await removeGrouped(db, await db.expireVoiceAudio(VOICE_EXPIRE_LIMIT));
        log.info("voice_audio", { removed });
      },
    },
    {
      name: "purge_expired",
      intervalMs: CRON_INTERVALS.purge_expired,
      async run() {
        const removed = await removeGrouped(db, await db.purgeExpired());
        log.info("purge_expired", { removed });
      },
    },
    {
      name: "credit_grants",
      intervalMs: CRON_INTERVALS.credit_grants,
      async run() {
        log.info("credit_grants", { granted: await db.runMonthlyCreditGrants() });
      },
    },
    {
      name: "payment_orders",
      intervalMs: CRON_INTERVALS.payment_orders,
      async run() {
        log.info("payment_orders", { expired: await db.expireStalePaymentOrders() });
      },
    },
  ];
}

// 정산 로직은 웹 ai-gateway 소유(AI_ARCHITECTURE.md 7장). 워커는 주기만 맞춰 내부 경로를 깨운다.
// 경로는 04_API.md에 아직 없다(팀장 확인 필요) — 한곳에만 둔다.
export const SETTLE_PATH = "/api/internal/ai-settle";

export function createSettleCaller(opts: { baseUrl: string; workerKey: string; fetch?: typeof fetch }): () => Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const url = new URL(SETTLE_PATH, opts.baseUrl).toString();
  return async () => {
    const res = await doFetch(url, { method: "POST", headers: { authorization: `Bearer ${opts.workerKey}` } });
    if (!res.ok) throw new Error(`settle failed: HTTP ${res.status}`);
  };
}
