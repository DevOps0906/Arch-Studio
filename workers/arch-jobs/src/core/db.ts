// service_role RPC 래퍼. 함수·인자 이름은 supabase/migrations(모놀리스 public.*)와 같다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, JobError } from "./errors.ts";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface JobRow {
  id: string;
  org_id: string;
  queue: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  credit_ledger_id: number | null;
  run_after: string;
  last_error: string | null;
}

export interface StoragePath {
  bucket: string;
  path: string;
}

export interface JobsDb {
  claimJobs(queue: string, workerId: string, limit: number): Promise<JobRow[]>;
  heartbeat(jobId: string, workerId: string, progress?: number, message?: string): Promise<boolean>;
  completeJob(jobId: string, workerId: string, result: Record<string, unknown>): Promise<JobRow>;
  failJob(jobId: string, workerId: string, error: string, retryable: boolean, retryDelaySeconds: number): Promise<JobRow>;
  finishAiRun(runId: string, result: Record<string, unknown>): Promise<unknown>;
  failAiRun(runId: string, reason: string): Promise<{ status: string }>;
  /** 실행 행 상태(4개 실행 테이블 중 하나). 없으면 null. */
  runStatus(runId: string): Promise<string | null>;
  reapStaleJobs(staleSeconds: number): Promise<number>;
  reconcileRuns(orgId: string): Promise<number>;
  orgsWithActiveRuns(): Promise<string[]>;
  purgeExpired(): Promise<StoragePath[]>;
  expireVoiceAudio(limit: number): Promise<StoragePath[]>;
  removeObjects(bucket: string, paths: string[]): Promise<void>;
  runMonthlyCreditGrants(): Promise<number>;
  expireStalePaymentOrders(): Promise<number>;
}

const RUN_TABLES = ["renders", "reviews", "intake_runs", "proposals"] as const;
export const VOICE_AUDIO_BUCKET = "voice-audio";

function toError(fn: string, err: { message: string; code?: string }): Error {
  // supabase-js는 네트워크 실패도 error 객체로 돌려준다(code 비어 있음) → 재시도 가능으로 분류
  if (!err.code && /fetch failed|network|ECONN/i.test(err.message)) {
    return new JobError(`${fn}: ${err.message}`, { retryable: true, code: "network" });
  }
  return new DbError(fn, err.message, err.code ?? "unknown");
}

export function createSupabaseJobsDb(client: SupabaseClient): JobsDb {
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw toError(fn, error);
    return data as T;
  }

  return {
    claimJobs: (queue, workerId, limit) =>
      rpc<JobRow[]>("claim_jobs", { p_queue: queue, p_worker_id: workerId, p_limit: limit }).then((rows) => rows ?? []),
    heartbeat: (jobId, workerId, progress, message) =>
      rpc<boolean>("heartbeat_job", { p_job_id: jobId, p_worker_id: workerId, p_progress: progress ?? null, p_message: message ?? null }),
    completeJob: (jobId, workerId, result) =>
      rpc<JobRow>("complete_job", { p_job_id: jobId, p_worker_id: workerId, p_result: result }),
    failJob: (jobId, workerId, error, retryable, retryDelaySeconds) =>
      rpc<JobRow>("fail_job", {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_error: error,
        p_retryable: retryable,
        p_retry_delay_seconds: retryDelaySeconds,
      }),
    finishAiRun: (runId, result) => rpc("finish_ai_run", { p_run_id: runId, p_result: result }),
    failAiRun: (runId, reason) => rpc<{ status: string }>("fail_ai_run", { p_run_id: runId, p_reason: reason }),
    async runStatus(runId) {
      for (const table of RUN_TABLES) {
        const { data, error } = await client.from(table).select("status").eq("id", runId).maybeSingle<{ status: string }>();
        if (error) throw toError(`select ${table}`, error);
        if (data) return data.status;
      }
      return null;
    },
    reapStaleJobs: (staleSeconds) => rpc<number>("reap_stale_jobs", { p_stale_seconds: staleSeconds }),
    reconcileRuns: (orgId) => rpc<number>("reconcile_runs", { p_org: orgId }),
    async orgsWithActiveRuns() {
      const orgs = new Set<string>();
      for (const table of RUN_TABLES) {
        const { data, error } = await client.from(table).select("org_id").in("status", ["queued", "running"]);
        if (error) throw toError(`select ${table}`, error);
        for (const row of (data ?? []) as { org_id: string }[]) orgs.add(row.org_id);
      }
      return [...orgs].sort();
    },
    purgeExpired: () => rpc<StoragePath[]>("purge_expired", {}).then((rows) => rows ?? []),
    expireVoiceAudio: (limit) =>
      rpc<{ job_id: string; storage_path: string | null }[]>("expire_voice_audio", { p_limit: limit }).then((rows) =>
        (rows ?? []).filter((r) => r.storage_path).map((r) => ({ bucket: VOICE_AUDIO_BUCKET, path: r.storage_path as string })),
      ),
    runMonthlyCreditGrants: () => rpc<number>("run_monthly_credit_grants", {}),
    expireStalePaymentOrders: () => rpc<number>("expire_stale_payment_orders", {}),
    async removeObjects(bucket, paths) {
      if (paths.length === 0) return;
      const { error } = await client.storage.from(bucket).remove(paths);
      if (error) throw toError(`storage.remove ${bucket}`, { message: error.message });
    },
  };
}
