// workers/arch-jobs 진입점: claim 루프 + 크론. SIGTERM/SIGINT면 새로 집지 않고 실행 중 잡을 마친 뒤 끝낸다
// (실행 중 핸들러는 끊지 않는다: 끊으면 실패·환불로 처리된다. 못 마친 잡은 reap_stale_jobs가 재큐잉한다).
import { hostname } from "node:os";
import { createClient } from "@supabase/supabase-js";
import { systemClock } from "./core/clock.ts";
import { loadConfig, secretsOf } from "./core/config.ts";
import { createSupabaseJobsDb } from "./core/db.ts";
import { createLogger } from "./core/log.ts";
import { runWorkerLoop } from "./core/loop.ts";
import { processJob } from "./core/runner.ts";
import { runScheduler } from "./cron/scheduler.ts";
import { createCronTasks, createSettleCaller } from "./cron/tasks.ts";
import { HANDLERS } from "./handlers.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.env, `${hostname()}-${process.pid}`);
  const secrets = secretsOf(config);
  const log = createLogger(secrets);
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = createSupabaseJobsDb(client);
  const stop = new AbortController();
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      log.info("shutdown requested", { signal: sig });
      stop.abort();
    });
  }

  const queues = Object.keys(HANDLERS).sort();
  log.info("worker start", { worker_id: config.workerId, queues, concurrency: config.concurrency });
  const tasks = createCronTasks({ db, log, settle: createSettleCaller({ baseUrl: config.webUrl, workerKey: config.workerKey }) });

  await Promise.all([
    runScheduler(tasks, systemClock, log, stop.signal),
    queues.length === 0
      ? Promise.resolve()
      : runWorkerLoop({
          queues,
          concurrency: config.concurrency,
          claim: (queue, limit) => db.claimJobs(queue, config.workerId, limit),
          process: (job) =>
            processJob(job, {
              db,
              handlers: HANDLERS,
              workerId: config.workerId,
              clock: systemClock,
              log,
              secrets,
              retryDelaySeconds: config.retryDelaySeconds,
              heartbeatMs: config.heartbeatMs,
            }),
          clock: systemClock,
          log,
          signal: stop.signal,
          idleMinMs: config.idleMinMs,
          idleMaxMs: config.idleMaxMs,
        }),
  ]);
  log.info("worker stopped");
}

main().catch((err: unknown) => {
  // 설정 오류 메시지에는 env 이름만 있고 값은 없다.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
