// 단일 프로세스 크론. 작업은 순서대로 하나씩 돌아 겹치지 않는다. 실패해도 다음 주기에 다시 돈다.
import type { Clock } from "../core/clock.ts";
import type { Logger } from "../core/log.ts";
import { planTick } from "./schedule.ts";

export interface CronTask {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export async function runScheduler(tasks: readonly CronTask[], clock: Clock, log: Logger, signal: AbortSignal): Promise<void> {
  const byName = new Map(tasks.map((t) => [t.name, t]));
  const intervals = Object.fromEntries(tasks.map((t) => [t.name, t.intervalMs]));
  const last: Record<string, number | null> = Object.fromEntries(tasks.map((t) => [t.name, null]));

  while (!signal.aborted) {
    const now = clock.now();
    const { due, wakeAt } = planTick(last, intervals, now);
    for (const name of due) {
      if (signal.aborted) break;
      last[name] = now;
      try {
        await (byName.get(name) as CronTask).run();
        log.info("cron done", { task: name });
      } catch (err) {
        log.error("cron failed", { task: name, err });
      }
    }
    await clock.sleep(Math.max(wakeAt - clock.now(), 0), signal);
  }
}
