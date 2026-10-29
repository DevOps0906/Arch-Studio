// 잡 1건 실행: 핸들러(타임아웃·하트비트) → 성공이면 finish_ai_run → complete_job,
// 실패면 fail_job(재시도 또는 최종 실패 + 자동 환불) → 최종 실패일 때만 fail_ai_run(02장 4절 순서).
import type { Clock } from "./clock.ts";
import type { JobRow, JobsDb } from "./db.ts";
import { classifyError, DbError, errorMessage, JobError } from "./errors.ts";
import type { Logger } from "./log.ts";
import { maskSecrets } from "./mask.ts";
import { policyFor, withTimeout, type JobPolicy } from "./policy.ts";

export interface HandlerContext {
  job: JobRow;
  signal: AbortSignal;
  heartbeat(progress?: number, message?: string): Promise<void>;
}

export interface HandlerResult {
  /** 실행 행(payload.run_id)이 있는 잡의 결과 → finish_ai_run. */
  runResult?: Record<string, unknown>;
  /** jobs.result에 남길 값(id·경로만). */
  jobResult?: Record<string, unknown>;
}

export type JobHandler = (ctx: HandlerContext) => Promise<HandlerResult | void>;

export interface RunnerDeps {
  db: JobsDb;
  handlers: Readonly<Record<string, JobHandler>>;
  workerId: string;
  clock: Clock;
  log: Logger;
  secrets: readonly string[];
  retryDelaySeconds: number;
  heartbeatMs: number;
  policyFor?: (jobType: string) => JobPolicy;
}

export type Outcome = "succeeded" | "retry" | "failed";

function runIdOf(job: JobRow): string | null {
  const id = job.payload?.["run_id"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function processJob(job: JobRow, deps: RunnerDeps): Promise<Outcome> {
  const { db, workerId, clock, log } = deps;
  const policy = (deps.policyFor ?? policyFor)(job.job_type);
  const runId = runIdOf(job);

  const lost = new AbortController();
  const beat = async (progress?: number, message?: string) => {
    const ok = await db.heartbeat(job.id, workerId, progress, message);
    if (!ok) lost.abort(new JobError("job lock lost", { retryable: false, code: "lock_lost" }));
  };
  let timer: unknown;
  const schedule = () => {
    timer = clock.setTimer(() => {
      beat().catch((err: unknown) => log.warn("heartbeat failed", { job_id: job.id, err }));
      schedule();
    }, deps.heartbeatMs);
  };
  schedule();

  let result: HandlerResult = {};
  try {
    // finish_ai_run 뒤 complete_job 전에 끊긴 잡이 재큐잉된 경우: 핸들러(유료 호출)를 다시 돌리지 않고 complete만 한다.
    const resumed = runId !== null && (await db.runStatus(runId)) === "succeeded";
    if (lost.signal.aborted) throw lost.signal.reason;
    if (!resumed) {
      const handler = deps.handlers[job.job_type];
      if (!handler) throw new JobError(`no handler for ${job.job_type}`, { retryable: false, code: "no_handler" });
      result = (await withTimeout((signal) => handler({ job, signal, heartbeat: beat }), policy.timeoutMs, clock, lost.signal)) ?? {};
      // 핸들러가 signal을 무시하고 정상 반환해도 잠금을 잃었으면 결과를 넘기지 않는다.
      if (lost.signal.aborted) throw lost.signal.reason;
      if (runId) {
        if (!result.runResult) throw new JobError("handler returned no run result", { retryable: false, code: "no_result" });
        await finishOnce(db, runId, result.runResult);
      }
    } else {
      log.warn("run already succeeded, completing job only", { job_id: job.id });
    }
  } catch (err) {
    if (lost.signal.aborted) {
      // 잠금을 잃은 잡은 reap_stale_jobs가 처리한다. fail_job은 JB001로 실패하므로 부르지 않는다.
      log.warn("job lock lost", { job_id: job.id });
      return "failed";
    }
    return await fail(job, runId, err, policy, deps);
  } finally {
    clock.clearTimer(timer);
  }
  // finish_ai_run 뒤에는 실패 경로로 가지 않는다(결과 전달된 실행은 환불 대상 아님, refund_on_failure=false).
  await db.completeJob(job.id, workerId, result.jobResult ?? {});
  log.info("job succeeded", { job_id: job.id, job_type: job.job_type, attempts: job.attempts });
  return "succeeded";
}

/** finish_ai_run. 이미 succeeded(동시 실행·재시도 경합)면 22023 "run is succeeded"를 성공으로 본다. */
async function finishOnce(db: JobsDb, runId: string, runResult: Record<string, unknown>): Promise<void> {
  try {
    await db.finishAiRun(runId, runResult);
  } catch (err) {
    if (err instanceof DbError && err.code === "22023" && /run is succeeded/.test(err.message)) return;
    throw err;
  }
}

async function fail(job: JobRow, runId: string | null, err: unknown, policy: JobPolicy, deps: RunnerDeps): Promise<Outcome> {
  const { db, workerId, log } = deps;
  const { retryable, reason } = classifyError(err, policy.retryOnTimeout);
  const message = maskSecrets(errorMessage(err), deps.secrets).slice(0, 4000);
  const after = await db.failJob(job.id, workerId, message, retryable, deps.retryDelaySeconds);
  if (after.status !== "failed") {
    log.warn("job requeued", { job_id: job.id, job_type: job.job_type, attempts: after.attempts, reason });
    return "retry";
  }
  if (runId) {
    // fail_job이 잡 원장으로 이미 환불했으면 fail_ai_run은 남은 금액 0이라 추가 환불 없이 상태만 refunded로 바꾼다.
    await db.failAiRun(runId, reason);
  }
  log.error("job failed", { job_id: job.id, job_type: job.job_type, attempts: after.attempts, reason, err: message });
  return "failed";
}
