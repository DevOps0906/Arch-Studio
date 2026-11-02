// POST /api/voice/stt: 분당 1 실제 길이 정산, voice:<request_id> 멱등, 실패 닫힘, 실패 환불, 상담 녹음 접수(AR-06-053).
// 차감·환불은 가짜 원장이 consume_credits·refund_credits와 같은 멱등 규칙으로 센다. 제공자는 가짜.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { settleStt, sttCreditsFor, voiceIdempotencyKey, voiceSettleKey } from "./billing.ts";
import { isConsultEnabled, sttProviderOf } from "./config.ts";
import type { SttProvider, SttRequest } from "./provider.ts";
import { handleStt, type ConsultEnqueueInput, type VoiceDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const REQ2 = "33333333-3333-4333-8333-333333333333";
const AUDIO_PATH = `${ORG}/arch/consult_audio/99999999-9999-4999-8999-999999999991.webm`;
const NOW = Date.UTC(2026, 10, 2, 3, 0, 0);

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3]);

interface Ledger {
  consumes: Map<string, { id: number; amount: number }>;
  refunds: Map<string, { ledgerId: number; amount: number; reason: string }>;
  balance: number;
}

interface World {
  provider: SttProvider | null;
  consult: boolean;
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  ledger: Ledger;
  providerCalls: SttRequest[];
  enqueued: ConsultEnqueueInput[];
  objects: Map<string, Uint8Array>;
}

function fakeProvider(w: { providerCalls: SttRequest[] }, out: { seconds: number; fail?: boolean }): SttProvider {
  return {
    name: "mock",
    async transcribe(req) {
      w.providerCalls.push(req);
      if (out.fail) throw new Error("provider down");
      return { text: " 안녕하세요 ", durationSeconds: out.seconds, provider: "mock", model: "fake" };
    },
  };
}

function world(over: Partial<World> & { seconds?: number; fail?: boolean } = {}): World {
  const w: World = {
    provider: null,
    consult: true,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    features: { ai_intake: true },
    ledger: { consumes: new Map(), refunds: new Map(), balance: 10 },
    providerCalls: [],
    enqueued: [],
    objects: new Map([[AUDIO_PATH, WEBM]]),
  };
  Object.assign(w, over);
  if (!("provider" in over)) w.provider = fakeProvider(w, { seconds: over.seconds ?? 12.3, fail: over.fail ?? false });
  return w;
}

function deps(w: World): VoiceDeps {
  return {
    provider: () => w.provider,
    consultEnabled: () => w.consult,
    recordingNoticeVersion: () => "2026-10-01",
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    org: () => ({ orgFeatures: async () => w.features }),
    credits: () => ({
      async reserve({ requestId, amount }) {
        const key = voiceIdempotencyKey(requestId);
        const hit = w.ledger.consumes.get(key);
        const refunded = (id: number) => [...w.ledger.refunds.values()].filter((r) => r.ledgerId === id).reduce((s, r) => s + r.amount, 0);
        if (hit) return { ledgerId: hit.id, refunded: refunded(hit.id) };
        if (w.ledger.balance < amount) throw Object.assign(new Error("db"), { code: "CR001" });
        w.ledger.balance -= amount;
        const row = { id: w.ledger.consumes.size + 1, amount };
        w.ledger.consumes.set(key, row);
        return { ledgerId: row.id, refunded: 0 };
      },
      async refund({ ledgerId, requestId, amount, reason }) {
        const key = voiceSettleKey(requestId);
        if (w.ledger.refunds.has(key)) return;
        w.ledger.refunds.set(key, { ledgerId, amount, reason });
        w.ledger.balance += amount;
      },
    }),
    consultAudio: () => ({
      size: async (p) => w.objects.get(p)?.byteLength ?? null,
      head: async (p, n) => (w.objects.get(p) ?? new Uint8Array()).slice(0, n),
    }),
    queue: () => ({
      async enqueue(i) {
        w.enqueued.push(i);
        return { jobId: "44444444-4444-4444-8444-444444444444" };
      },
    }),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
  };
}

function dictation(requestId = REQ, audio: Uint8Array = WEBM, extra?: Record<string, string>): Request {
  const form = new FormData();
  form.set("request_id", requestId);
  form.set("mode", "dictation");
  form.set("audio", new Blob([audio as BlobPart], { type: "audio/webm" }), "a.webm");
  for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
  return new Request("http://localhost/api/voice/stt", { method: "POST", body: form });
}

function consult(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/voice/stt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: REQ,
      mode: "consult",
      project_ref: PROJECT,
      audio_path: AUDIO_PATH,
      duration_s: 185,
      notice_version: "2026-10-01",
      ...body,
    }),
  });
}

async function json(res: Response): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> {
  return (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string } };
}

test("정산 식: 분당 1, 실제 길이 올림, 선차감보다 더 받지 않음", () => {
  assert.equal(sttCreditsFor(0), 0);
  assert.equal(sttCreditsFor(0.4), 1);
  assert.equal(sttCreditsFor(60), 1);
  assert.equal(sttCreditsFor(60.004), 1); // 0.01초 단위로 자른 뒤 올림
  assert.equal(sttCreditsFor(60.01), 2);
  assert.equal(sttCreditsFor(7200), 120);
  assert.deepEqual(settleStt(4, 125), { charged: 3, refund: 1 });
  assert.deepEqual(settleStt(4, 400), { charged: 4, refund: 0 });
  assert.deepEqual(settleStt(1, 0), { charged: 0, refund: 1 });
  assert.throws(() => sttCreditsFor(Number.NaN));
});

test("받아쓰기: 1 선차감 → 실제 12.3초 = 1 확정, 200 { text, duration_s, credits }", async () => {
  const w = world({ seconds: 12.3 });
  const res = await handleStt(dictation(), deps(w));
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.deepEqual(body.data, { text: "안녕하세요", duration_s: 12.3, credits: 1 });
  assert.equal(w.ledger.balance, 9);
  assert.equal(w.ledger.refunds.size, 0);
  assert.equal(w.providerCalls[0]?.mime, "audio/webm");
  assert.equal(w.providerCalls[0]?.feature, "voice_chat");
});

test("받아쓰기: 무음(0초)은 실제 길이 정산으로 전액 환불", async () => {
  const w = world({ seconds: 0 });
  const res = await handleStt(dictation(), deps(w));
  assert.equal(res.status, 200);
  assert.equal((await json(res)).data?.credits, 0);
  assert.equal(w.ledger.balance, 10);
  assert.equal(w.ledger.refunds.get(voiceSettleKey(REQ))?.reason, "stt_settle");
});

test("멱등: 같은 request_id 재전송은 추가 차감 없음(voice:<request_id>)", async () => {
  const w = world({ seconds: 30 });
  const d = deps(w);
  assert.equal((await handleStt(dictation(), d)).status, 200);
  assert.equal((await handleStt(dictation(), d)).status, 200);
  assert.equal(w.ledger.consumes.size, 1);
  assert.ok(w.ledger.consumes.has(`voice:${REQ}`));
  assert.equal(w.ledger.balance, 9);
  // 다른 request_id는 새로 차감
  assert.equal((await handleStt(dictation(REQ2), d)).status, 200);
  assert.equal(w.ledger.balance, 8);
});

test("제공자 실패: 전액 환불 후 503, 같은 request_id 재전송은 제공자를 다시 부르지 않음(409)", async () => {
  const w = world({ fail: true });
  const d = deps(w);
  const res = await handleStt(dictation(), d);
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error?.code, "voice_unavailable");
  assert.equal(w.ledger.balance, 10);
  const again = await handleStt(dictation(), d);
  assert.equal(again.status, 409);
  assert.equal(w.providerCalls.length, 1);
  assert.equal(w.ledger.balance, 10);
});

test("60초 초과(허용치 1초 넘음): 전액 환불 후 VOICE_TOO_LONG 413, 텍스트 미반환", async () => {
  const w = world({ seconds: 75 });
  const res = await handleStt(dictation(), deps(w));
  assert.equal(res.status, 413);
  const body = await json(res);
  assert.equal(body.error?.code, "VOICE_TOO_LONG");
  assert.equal(body.data, undefined);
  assert.equal(w.ledger.balance, 10);
});

test("실패 닫힘: 제공자 없음(키·URL 없음)은 인증 전에 503, 차감 0", async () => {
  const w = world({ provider: null, session: new GatewayError("unauthorized") });
  const res = await handleStt(dictation(), deps(w));
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error?.code, "voice_disabled");
  assert.equal(w.ledger.consumes.size, 0);
});

test("설정: oss-voice는 URL이 있어야, mock은 development·test에서만", () => {
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: "oss-voice" }), null);
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: "oss-voice", OSS_VOICE_BASE_URL: "not a url" }), null);
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: "oss-voice", OSS_VOICE_BASE_URL: "https://voice.example" }), "oss-voice");
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "production" }), null);
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "test" }), "mock");
  assert.equal(sttProviderOf({}), null);
  assert.equal(isConsultEnabled({ ARCH_VOICE_CONSULT_ENABLED: "true", ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "test" }), true);
  assert.equal(isConsultEnabled({ ARCH_VOICE_CONSULT_ENABLED: "1", ARCH_VOICE_STT_PROVIDER: "mock", NODE_ENV: "test" }), false);
  assert.equal(isConsultEnabled({ ARCH_VOICE_CONSULT_ENABLED: "true", ARCH_VOICE_STT_PROVIDER: "oss-voice", OSS_VOICE_BASE_URL: "https://v.example" }), false);
});

test("받아쓰기 입력 거부는 모두 차감 0: 오디오 아님 415, 모르는 필드 422, 5MB 초과 413, 크레딧 부족 402, viewer 403", async () => {
  const cases: [Request, World, number][] = [
    [dictation(REQ, new TextEncoder().encode("not audio at all")), world(), 415],
    [dictation(REQ, WEBM, { org_id: ORG }), world(), 422],
    [dictation(REQ, new Uint8Array(5 * 1024 * 1024 + 1)), world(), 413],
    [dictation(), world({ ledger: { consumes: new Map(), refunds: new Map(), balance: 0 } }), 402],
    [dictation(), world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: "x".repeat(30) } }), 403],
    [dictation(), world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: "x".repeat(30) } }), 402],
  ];
  for (const [req, w, status] of cases) {
    const res = await handleStt(req, deps(w));
    assert.equal(res.status, status);
    assert.equal(w.providerCalls.length, 0);
    assert.equal(w.ledger.consumes.size, 0);
  }
});

test("상담 녹음: 신고 길이로 선차감(185초 = 4) → voice_jobs·arch.stt enqueue, 202", async () => {
  const w = world();
  const res = await handleStt(consult({}), deps(w));
  assert.equal(res.status, 202);
  assert.deepEqual((await json(res)).data, { job_id: "44444444-4444-4444-8444-444444444444", credits: 4 });
  assert.equal(w.ledger.balance, 6);
  assert.equal(w.enqueued[0]?.declaredSeconds, 185);
  assert.equal(w.enqueued[0]?.ledgerId, 1);
  assert.equal(w.providerCalls.length, 0); // 동기 경로에서 제공자를 부르지 않는다(워커가 한다)
});

test("상담 녹음 거부(차감 0): 고지 없음·버전 다름 422, 2시간 초과 413, 다른 조직 경로 422, 스위치 꺼짐 503, 기능 없음 402", async () => {
  const cases: [Request, Partial<World>, number, string][] = [
    [consult({ notice_version: undefined }), {}, 422, "recording_notice_required"],
    [consult({ notice_version: "old" }), {}, 422, "recording_notice_required"],
    [consult({ duration_s: 7201 }), {}, 413, "VOICE_TOO_LONG"],
    [consult({ audio_path: AUDIO_PATH.replace(ORG, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") }), {}, 422, "23514"],
    [consult({}), { consult: false }, 503, "voice_disabled"],
    [consult({}), { features: {} }, 402, "feature_unavailable"],
    [consult({}), { objects: new Map([[AUDIO_PATH, new TextEncoder().encode("<html>")]]) }, 415, "unsupported_media_type"],
  ];
  for (const [req, over, status, code] of cases) {
    const w = world(over);
    const res = await handleStt(req, deps(w));
    assert.equal(res.status, status, code);
    assert.equal((await json(res)).error?.code, code);
    assert.equal(w.ledger.consumes.size, 0);
    assert.equal(w.enqueued.length, 0);
  }
});
