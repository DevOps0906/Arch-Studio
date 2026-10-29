// claim_jobs 폴링 루프: 큐를 돌아가며 빈 슬롯만큼 집고, 빈 폴링이 이어지면 대기를 늘린다.
// 종료 신호가 오면 새로 집지 않고 실행 중인 잡이 끝날 때까지 기다린다.
import type { Clock } from "./clock.ts";
import type { JobRow } from "./db.ts";
import type { Logger } from "./log.ts";
import { idleDelayMs } from "./policy.ts";

export interface LoopOptions {
  queues: readonly string[];
  concurrency: number;
  claim(queue: string, limit: number): Promise<JobRow[]>;
  process(job: JobRow): Promise<unknown>;
  clock: Clock;
  log: Logger;
  signal: AbortSignal;
  idleMinMs: number;
  idleMaxMs: number;
}

export async function runWorkerLoop(opts: LoopOptions): Promise<void> {
  const active = new Set<Promise<unknown>>();
  let emptyStreak = 0;
  let start = 0;

  while (!opts.signal.aborted) {
    let free = opts.concurrency - active.size;
    let claimed = 0;
    try {
      for (let i = 0; i < opts.queues.length && free > 0 && !opts.signal.aborted; i++) {
        const queue = opts.queues[(start + i) % opts.queues.length] as string;
        const jobs = await opts.claim(queue, free);
        for (const job of jobs) {
          const task = opts
            .process(job)
            .catch((err: unknown) => opts.log.error("job processing crashed", { job_id: job.id, err }))
            .finally(() => active.delete(task));
          active.add(task);
        }
        claimed += jobs.length;
        free -= jobs.length;
      }
    } catch (err) {
      opts.log.error("claim failed", { err });
    }
    start = opts.queues.length > 0 ? (start + 1) % opts.queues.length : 0;

    if (free <= 0 && active.size > 0) {
      await Promise.race(active);
    } else if (claimed === 0) {
      await opts.clock.sleep(idleDelayMs(emptyStreak, opts.idleMinMs, opts.idleMaxMs), opts.signal);
      emptyStreak++;
    } else {
      emptyStreak = 0;
    }
  }
  await Promise.allSettled(active);
}
