// 워커 크론 주기(02_ARCHITECTURE.md 4절 "스케줄(잡 아님, 워커 크론)" 표와 같아야 한다).
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type CronName = "reap" | "settle" | "voice_audio" | "purge_expired" | "credit_grants" | "payment_orders";

export const CRON_INTERVALS: Readonly<Record<CronName, number>> = {
  reap: 10 * MINUTE_MS, // reap_stale_jobs(600) → reconcile_runs(조직마다)
  settle: 5 * MINUTE_MS, // AI 정산(settled_at is null)
  voice_audio: HOUR_MS, // expire_voice_audio → voice-audio 객체 삭제
  purge_expired: DAY_MS, // purge_expired(렌더 90일 등) → 반환 경로 삭제
  credit_grants: DAY_MS, // run_monthly_credit_grants()
  payment_orders: HOUR_MS, // expire_stale_payment_orders()
};

/** reap_stale_jobs의 하트비트 끊김 기준(초). */
export const REAP_STALE_SECONDS = 600;

/**
 * 다음 실행 시각. 처음(lastStartedAt=null)은 바로, 이후는 지난 시작 + 주기(고정 주기).
 * 실행이 주기보다 오래 걸려 이미 지났으면 지금 실행한다(밀린 횟수만큼 몰아서 돌지 않음).
 */
export function nextRunAt(lastStartedAt: number | null, intervalMs: number, now: number): number {
  if (lastStartedAt === null) return now;
  return Math.max(lastStartedAt + intervalMs, now);
}

/** now 기준 실행할 작업 이름(이름순)과 그다음 깨어날 시각. */
export function planTick(
  last: Readonly<Record<string, number | null>>,
  intervals: Readonly<Record<string, number>>,
  now: number,
): { due: string[]; wakeAt: number } {
  const due: string[] = [];
  let wakeAt = Number.POSITIVE_INFINITY;
  for (const name of Object.keys(intervals).sort()) {
    const interval = intervals[name] as number;
    const lastStart = last[name] ?? null;
    if (lastStart === null || lastStart + interval <= now) {
      due.push(name);
      wakeAt = Math.min(wakeAt, now + interval);
    } else {
      wakeAt = Math.min(wakeAt, nextRunAt(lastStart, interval, now));
    }
  }
  return { due, wakeAt };
}
