// arch.stt: 실제 길이 정산(분당 1, voice:<org_id>:<voice_ref>:settle 멱등), 재시도 분류, payload 검사, 실패 닫힘 등록(AR-06-053). 제공자는 가짜.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { JobRow } from "../../core/db.ts";
import { JobError } from "../../core/errors.ts";
import type { HandlerContext } from "../../core/runner.ts";
import { settleStt, sttCreditsFor } from "./billing.ts";
import { createSttHandler } from "./handler.ts";
import type { ConsultSttProvider } from "./provider.ts";
import { buildSttHandler } from "./register.ts";
import type { SttCredits, SttStorage } from "./storage.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VOICE = "22222222-2222-4222-8222-222222222222";
const AUDIO = `${ORG}/arch/consult_audio/99999999-9999-4999-8999-999999999991.webm`;
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);

function job(payload: Record<string, unknown> = {}, ledger: number | null = 7): JobRow {
  return {
    id: JOB,
    org_id: ORG,
    queue: "arch.stt",
    job_type: "arch.stt",
    payload: { voice_ref: VOICE, audio_path: AUDIO, notice_version: "2026-10-01", language: "ko", declared_duration_s: 185, ...payload },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    credit_ledger_id: ledger,
    run_after: "",
    last_error: null,
  };
}

interface Rec {
  uploads: { bucket: string; path: string; body: string }[];
  refunds: Map<string, { ledgerId: number; amount: number }>;
  beats: string[];
}

function setup(opts: { seconds?: number; providerFails?: boolean; downloadFails?: boolean; audio?: Uint8Array } = {}) {
  const rec: Rec = { uploads: [], refunds: new Map(), beats: [] };
  const storage: SttStorage = {
    async download(_b, path) {
      if (opts.downloadFails) throw new Error("network");
      if (path !== AUDIO) throw new Error("not found");
      return opts.audio ?? WEBM;
    },
    async uploadJson(bucket, path, body) {
      rec.uploads.push({ bucket, path, body });
    },
  };
  const credits: SttCredits = {
    async refund(ledgerId, amount, key) {
      if (!rec.refunds.has(key)) rec.refunds.set(key, { ledgerId, amount }); // refund_credits 멱등 키와 같은 규칙
    },
  };
  const provider: ConsultSttProvider = {
    name: "fake",
    model: "fake-1",
    async transcribe() {
      if (opts.providerFails) throw new Error("gpu down");
      return { text: "1층 근생, 2~4층 다세대", durationSeconds: opts.seconds ?? 121.5 };
    },
  };
  const ctx = (j: JobRow): HandlerContext => ({
    job: j,
    signal: new AbortController().signal,
    heartbeat: async (_p, m) => {
      rec.beats.push(m ?? "");
    },
  });
  return { rec, handler: createSttHandler({ provider, storage, credits }), ctx };
}

test("정산: 신고 185초(4 선차감) → 실제 121.5초(3) → 1 환불, 키 voice:<org_id>:<voice_ref>:settle", async () => {
  const { rec, handler, ctx } = setup({ seconds: 121.5 });
  const out = await handler(ctx(job()));
  assert.deepEqual(out?.jobResult, {
    transcript_path: `${ORG}/arch/stt/${JOB}.json`,
    duration_s: 121.5,
    chunks: 1,
    credits: 3,
    provider: "fake",
    model: "fake-1",
  });
  assert.deepEqual([...rec.refunds.entries()], [[`voice:${ORG}:${VOICE}:settle`, { ledgerId: 7, amount: 1 }]]);
  assert.equal(rec.uploads[0]?.bucket, "org-files");
  assert.equal(JSON.parse(rec.uploads[0]?.body ?? "{}").text, "1층 근생, 2~4층 다세대");
  assert.deepEqual(rec.beats.map((b) => JSON.parse(b).stage), ["split", "transcribe", "merge"]);
});

test("정산 멱등: 같은 잡 재실행(재시도)도 환불은 한 번", async () => {
  const { rec, handler, ctx } = setup({ seconds: 30 });
  await handler(ctx(job()));
  await handler(ctx(job()));
  assert.equal(rec.refunds.size, 1);
  assert.equal(rec.refunds.get(`voice:${ORG}:${VOICE}:settle`)?.amount, 3);
});

test("실제가 신고보다 조금(10% 이내) 길면 선차감 이상 받지 않음(환불 0), 원장 없는 잡은 정산 안 함", async () => {
  const long = setup({ seconds: 200 });
  assert.equal((await long.handler(long.ctx(job())))?.jobResult?.["credits"], 4);
  assert.equal(long.rec.refunds.size, 0);
  const free = setup({ seconds: 10 });
  await free.handler(free.ctx(job({}, null)));
  assert.equal(free.rec.refunds.size, 0);
  assert.deepEqual(settleStt(sttCreditsFor(185), 0), { charged: 0, refund: 4 });
});

test("실제가 신고보다 10% 넘게 길면 STT_DURATION_MISMATCH 실패(재시도 없음 → fail_job 전액 환불), 전사본·부분 환불 없음", async () => {
  const s = setup({ seconds: 185 * 1.1 + 0.5 });
  await assert.rejects(s.handler(s.ctx(job())), (e: unknown) => e instanceof JobError && !e.retryable && e.code === "STT_DURATION_MISMATCH");
  assert.equal(s.rec.uploads.length, 0);
  assert.equal(s.rec.refunds.size, 0);
  const edge = setup({ seconds: 185 * 1.1 });
  assert.equal((await edge.handler(edge.ctx(job())))?.jobResult?.["credits"], 4);
});

test("실패 분류: 제공자·내려받기 오류는 재시도(대체 없이 1회), 형식·payload 오류는 재시도 없음", async () => {
  const cases: [ReturnType<typeof setup>, JobRow, boolean, string][] = [
    [setup({ providerFails: true }), job(), true, "AI_UNAVAILABLE"],
    [setup({ downloadFails: true }), job(), true, "storage"],
    [setup({ audio: new TextEncoder().encode("<html>not audio") }), job(), false, "bad_input"],
    [setup(), job({ notice_version: "" }), false, "recording_notice_required"],
    [setup(), job({ audio_path: AUDIO.replace(ORG, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") }), false, "bad_payload"],
    [setup(), job({ declared_duration_s: 7201 }), false, "bad_payload"],
  ];
  for (const [s, j, retryable, code] of cases) {
    await assert.rejects(s.handler(s.ctx(j)), (e: unknown) => e instanceof JobError && e.retryable === retryable && e.code === code);
    assert.equal(s.rec.refunds.size, 0); // 실패 환불은 fail_job이 원장 전액으로 한다
    assert.equal(s.rec.uploads.length, 0);
  }
});

test("등록: 스위치 정확히 true + mock(development·test)일 때만, 운영·꺼짐은 미등록", () => {
  const make = {
    storage: (): SttStorage => ({ download: async () => WEBM, uploadJson: async () => {} }),
    credits: (): SttCredits => ({ refund: async () => {} }),
  };
  assert.equal(buildSttHandler({ ARCH_VOICE_CONSULT_ENABLED: "true", ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "test" }, make) !== null, true);
  assert.equal(buildSttHandler({ ARCH_VOICE_CONSULT_ENABLED: "true", ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "production" }, make), null);
  assert.equal(buildSttHandler({ ARCH_VOICE_CONSULT_ENABLED: "true", ARCH_VOICE_STT_PROVIDER: "oss-voice", NODE_ENV: "test" }, make), null);
  assert.equal(buildSttHandler({ ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "test" }, make), null);
});
