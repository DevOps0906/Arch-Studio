// 로컬 Supabase 통합 테스트: 빈 잡 성공·실패 처리와 실패 시 환불 원장 1행.
// 실행: SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<npx supabase@2.122.0 status 값> pnpm test:integration
// 키는 코드·파일에 두지 않는다. 테스트마다 새 사용자·조직을 만들어 기존 데이터와 섞이지 않는다.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { systemClock } from "../../src/core/clock.ts";
import { createSupabaseJobsDb, type JobRow, type JobsDb } from "../../src/core/db.ts";
import { JobError } from "../../src/core/errors.ts";
import { createLogger } from "../../src/core/log.ts";
import { processJob, type JobHandler } from "../../src/core/runner.ts";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const WORKER = `itest-${randomUUID()}`;
// 다른 대기 잡을 집지 않게 이 실행만의 큐로 옮긴다(핸들러는 job_type으로 고른다).
const QUEUE = `itest.${randomUUID()}`;
const JOB_TYPE = "arch.intake";

let client: SupabaseClient;
let db: JobsDb;

before(() => {
  assert.ok(url && key, "SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY env가 필요하다");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  db = createSupabaseJobsDb(client);
});

async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

/** 새 사용자(개인 조직 자동 생성) + 크레딧 충전 + intake 실행 1건(선차감 2, max_attempts 2). */
async function startRun(): Promise<{ orgId: string; runId: string; jobId: string; ledgerId: number; credits: number }> {
  const { data: created, error } = await client.auth.admin.createUser({
    email: `worker-${randomUUID()}@test.local`,
    email_confirm: true,
    user_metadata: { signup_app: "arch", full_name: "Worker Test" },
  });
  if (error) throw error;
  const userId = created.user.id;
  const org = await must(client.from("organizations").select("id").eq("owner_id", userId).single<{ id: string }>());
  await must(
    client.rpc("grant_credits", { p_org_id: org.id, p_amount: 100, p_app_id: "arch", p_reason: "itest", p_idempotency_key: `itest:${randomUUID()}` }),
  );
  const rows = await must(
    client.rpc("start_ai_run", {
      p_org: org.id,
      p_actor: userId,
      p_kind: "intake",
      p_variant: "intake_text",
      p_request_id: randomUUID(),
      p_project_ref: randomUUID(),
      p_options: { text: "통합 테스트 요구사항" },
    }),
  );
  const run = (rows as { run_id: string; job_id: string; credits: number }[])[0];
  assert.ok(run, "start_ai_run 결과 없음");
  const job = await must(
    client.from("jobs").update({ queue: QUEUE }).eq("id", run.job_id).select("credit_ledger_id").single<{ credit_ledger_id: number }>(),
  );
  return { orgId: org.id, runId: run.run_id, jobId: run.job_id, ledgerId: job.credit_ledger_id, credits: run.credits };
}

async function claimOurs(jobId: string): Promise<JobRow> {
  const [job] = await db.claimJobs(QUEUE, WORKER, 1);
  assert.equal(job?.id, jobId);
  return job;
}

function run(job: JobRow, handler: JobHandler, retryDelaySeconds = 0) {
  return processJob(job, {
    db,
    handlers: { [JOB_TYPE]: handler },
    workerId: WORKER,
    clock: systemClock,
    log: createLogger([key ?? ""], () => {}),
    secrets: [key ?? ""],
    retryDelaySeconds,
    heartbeatMs: 60_000,
  });
}

async function refunds(ledgerId: number) {
  return must(client.from("credit_ledger").select("id, amount, idempotency_key").eq("refund_of", ledgerId));
}

async function runStatus(runId: string): Promise<string> {
  const row = await must(client.from("intake_runs").select("status").eq("id", runId).single<{ status: string }>());
  return row.status;
}

test("빈 잡 성공: finish_ai_run → complete_job, 환불 없음", async () => {
  const s = await startRun();
  const job = await claimOurs(s.jobId);
  const out = await run(job, async () => ({ runResult: { schema_version: "intake.v1", checklist_answers: [], rooms: [], memo: [] } }));
  assert.equal(out, "succeeded");
  const after = await must(client.from("jobs").select("status").eq("id", s.jobId).single<{ status: string }>());
  assert.equal(after.status, "succeeded");
  assert.equal(await runStatus(s.runId), "succeeded");
  assert.equal((await refunds(s.ledgerId)).length, 0);
});

test("빈 잡 실패: 1회 재큐잉(환불 없음) → 최종 실패 fail_job → fail_ai_run, 환불 원장 1행", async () => {
  const s = await startRun();
  const fails: JobHandler = async () => {
    throw new JobError("provider error", { retryable: true, code: "provider" });
  };

  const first = await claimOurs(s.jobId);
  assert.equal(await run(first, fails), "retry");
  const queued = await must(client.from("jobs").select("status, attempts").eq("id", s.jobId).single<{ status: string; attempts: number }>());
  assert.deepEqual(queued, { status: "queued", attempts: 1 });
  assert.equal((await refunds(s.ledgerId)).length, 0);

  const second = await claimOurs(s.jobId);
  assert.equal(await run(second, fails), "failed");
  const failed = await must(client.from("jobs").select("status, attempts").eq("id", s.jobId).single<{ status: string; attempts: number }>());
  assert.deepEqual(failed, { status: "failed", attempts: 2 });
  const rows = (await refunds(s.ledgerId)) as { amount: number; idempotency_key: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.amount, s.credits);
  assert.equal(rows[0]?.idempotency_key, `refund:job:${s.jobId}`);
  assert.equal(await runStatus(s.runId), "refunded");
});
