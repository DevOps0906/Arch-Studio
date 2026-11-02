// POST /api/voice/stt: 킬 스위치·크기·형식 위조·멱등 재전송·환불 경로·권한(AR-06-053 서버). 원장·제공자는 가짜.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { isVoiceSttEnabled } from "./config.ts";
import { fakeSttProvider, type SttProvider } from "./provider.ts";
import { handleVoiceStt, STT_MAX_BYTES, type VoiceDeps, type VoiceLedger } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RID = "11111111-1111-4111-8111-111111111111";

const session = (over: Partial<GatewaySession> = {}): GatewaySession => ({ userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "t".repeat(30), ...over });

function webm(n = 20000): Buffer {
  const b = Buffer.alloc(n, 1);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(b);
  return b;
}

interface Harness {
  deps: VoiceDeps;
  consumed: string[];
  refunds: { ledgerId: string; reason: string }[];
  providerCalls: { n: number };
}

function harness(opts: { enabled?: boolean; sess?: GatewaySession | Error; provider?: SttProvider; insufficient?: boolean; limit?: number } = {}): Harness {
  const keys = new Set<string>();
  const consumed: string[] = [];
  const refunds: { ledgerId: string; reason: string }[] = [];
  const providerCalls = { n: 0 };
  const base = opts.provider ?? fakeSttProvider();
  const ledger: VoiceLedger = {
    async exists(key) {
      return keys.has(key);
    },
    async consume(a) {
      if (opts.insufficient) throw Object.assign(new Error("x"), { code: "CR001" });
      keys.add(a.key);
      consumed.push(a.key);
      return "42";
    },
    async refund(a) {
      refunds.push({ ledgerId: a.ledgerId, reason: a.reason });
    },
  };
  const deps: VoiceDeps = {
    enabled: () => opts.enabled ?? true,
    session: {
      async resolve() {
        if (opts.sess instanceof Error) throw opts.sess;
        return opts.sess ?? session();
      },
    },
    ledger,
    provider: {
      async transcribe(r) {
        providerCalls.n += 1;
        return base.transcribe(r);
      },
    },
    token: async () => "tok",
    rateLimit: new MemoryRateLimitStore(),
    now: () => 1_000_000,
  };
  return { deps, consumed, refunds, providerCalls };
}

function request(body: Uint8Array | string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/voice/stt", {
    method: "POST",
    headers: { "content-type": "audio/webm", "x-request-id": RID, authorization: "Bearer x", ...headers },
    body: body as BodyInit,
  });
}

async function code(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

test("isVoiceSttEnabled: 정확히 \"true\"만 켜짐", () => {
  assert.equal(isVoiceSttEnabled({}), false);
  assert.equal(isVoiceSttEnabled({ ARCH_VOICE_STT_ENABLED: "1" }), false);
  assert.equal(isVoiceSttEnabled({ ARCH_VOICE_STT_ENABLED: "true" }), true);
});

test("킬 스위치 off: 인증 전 503, 세션·원장·제공자 접근 0", async () => {
  const h = harness({ enabled: false, sess: new GatewayError("unauthorized") });
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 503);
  assert.equal(await code(res), "stt_disabled");
  assert.deepEqual(h.consumed, []);
  assert.equal(h.providerCalls.n, 0);
});

test("정상: 200 {text, duration_s, credits:1}, 1회 차감, 환불 없음", async () => {
  const h = harness();
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; data: { text: string; duration_s: number; credits: number } };
  assert.equal(body.data.credits, 1);
  assert.equal(body.data.duration_s, 2);
  assert.match(body.data.text, /^가짜 전사 [0-9a-f]{8}$/);
  assert.deepEqual(h.consumed, [`voice:${ORG}:${RID}`]);
  assert.deepEqual(h.refunds, []);
});

test("request_id는 쿼리로도 받는다", async () => {
  const h = harness();
  const req = new Request(`http://localhost/api/voice/stt?request_id=${RID}`, { method: "POST", headers: { "content-type": "audio/webm; codecs=opus" }, body: new Uint8Array(webm()) });
  assert.equal((await handleVoiceStt(req, h.deps)).status, 200);
});

test("인증 실패는 401, 차감 0", async () => {
  const h = harness({ sess: new GatewayError("unauthorized") });
  assert.equal((await handleVoiceStt(request(webm()), h.deps)).status, 401);
  assert.deepEqual(h.consumed, []);
});

test("권한: viewer 403 · 엔타이틀먼트 만료 402, 차감 0", async () => {
  const a = harness({ sess: session({ role: "viewer" }) });
  assert.equal((await handleVoiceStt(request(webm()), a.deps)).status, 403);
  const b = harness({ sess: session({ entitled: false }) });
  assert.equal((await handleVoiceStt(request(webm()), b.deps)).status, 402);
  assert.deepEqual([...a.consumed, ...b.consumed], []);
  assert.equal(a.providerCalls.n + b.providerCalls.n, 0);
});

test("크기: content-length·실제 본문 5MB 초과는 413 AR031, 차감 0", async () => {
  const h = harness();
  const big = webm(STT_MAX_BYTES + 1);
  const res = await handleVoiceStt(request(big), h.deps);
  assert.equal(res.status, 413);
  assert.equal(await code(res), "AR031");
  // 선언 길이 없이 스트림으로 보내도 막힌다
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(big.subarray(0, 3 * 1024 * 1024));
      c.enqueue(big.subarray(3 * 1024 * 1024));
      c.close();
    },
  });
  const req = new Request("http://localhost/api/voice/stt", { method: "POST", headers: { "content-type": "audio/webm", "x-request-id": RID }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleVoiceStt(req, h.deps)).status, 413);
  assert.deepEqual(h.consumed, []);
});

test("형식 위조: 허용 외 Content-Type 415 · 매직바이트 불일치 415 · 빈 본문 422, 차감 0", async () => {
  const h = harness();
  assert.equal((await handleVoiceStt(request(webm(), { "content-type": "audio/mpeg" }), h.deps)).status, 415);
  assert.equal((await handleVoiceStt(request(Buffer.from("not audio at all, plain text"), { "content-type": "audio/webm" }), h.deps)).status, 415);
  assert.equal((await handleVoiceStt(request(webm(), { "content-type": "audio/ogg" }), h.deps)).status, 415); // webm 바이트를 ogg로 위장
  assert.equal((await handleVoiceStt(request(new Uint8Array(0)), h.deps)).status, 422);
  assert.deepEqual(h.consumed, []);
  assert.equal(h.providerCalls.n, 0);
});

test("request_id가 UUID v4가 아니면 422", async () => {
  const h = harness();
  assert.equal((await handleVoiceStt(request(webm(), { "x-request-id": "nope" }), h.deps)).status, 422);
  assert.deepEqual(h.consumed, []);
});

test("멱등 재전송: 409 IDEMPOTENT_REPLAY, 제공자 미호출, 추가 차감 0", async () => {
  const h = harness();
  assert.equal((await handleVoiceStt(request(webm()), h.deps)).status, 200);
  assert.equal(h.providerCalls.n, 1);
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 409);
  assert.equal(await code(res), "IDEMPOTENT_REPLAY");
  assert.equal(h.providerCalls.n, 1);
  assert.equal(h.consumed.length, 1);
});

test("같은 request_id라도 조직이 다르면 별개 키", async () => {
  const h = harness({ sess: session({ orgId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }) });
  await handleVoiceStt(request(webm()), h.deps);
  assert.deepEqual(h.consumed, [`voice:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee:${RID}`]);
});

test("크레딧 부족: 402 CR001, 제공자 미호출", async () => {
  const h = harness({ insufficient: true });
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 402);
  assert.equal(await code(res), "CR001");
  assert.equal(h.providerCalls.n, 0);
});

test("환불: 60초 초과 duration은 결과 폐기·전액 환불", async () => {
  const h = harness({ provider: { transcribe: async () => ({ text: "길다", durationS: 61 }) } });
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 422);
  assert.equal(await code(res), "stt_too_long");
  assert.deepEqual(h.refunds, [{ ledgerId: "42", reason: "stt_too_long" }]);
});

test("환불: 빈 전사·0초는 전액 환불", async () => {
  const h = harness({ provider: { transcribe: async () => ({ text: "  ", durationS: 3 }) } });
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 422);
  assert.equal(await code(res), "stt_empty");
  assert.deepEqual(h.refunds, [{ ledgerId: "42", reason: "stt_empty" }]);
});

test("환불: 제공자 예외는 502 + 전액 환불, 예외 원문은 응답에 없음", async () => {
  const h = harness({
    provider: {
      transcribe: async () => {
        throw new Error("secret-detail");
      },
    },
  });
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(await res.json()).includes("secret-detail"));
  assert.deepEqual(h.refunds, [{ ledgerId: "42", reason: "stt_provider_failed" }]);
});

test("레이트 리밋: 한도 초과는 429", async () => {
  const h = harness();
  let last = 0;
  for (let i = 0; i < 13; i++) {
    const rid = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
    last = (await handleVoiceStt(request(webm(), { "x-request-id": rid }), h.deps)).status;
  }
  assert.equal(last, 429);
});

test("환불 확정 실패 응답은 details.refunded 를 싣는다(true/false), 환불 실패 문구는 \"환불 처리됩니다\"", async () => {
  const fail: SttProvider = {
    transcribe: async () => {
      throw new Error("x");
    },
  };
  const ok = harness({ provider: fail });
  const a = (await (await handleVoiceStt(request(webm()), ok.deps)).json()) as { error: { details?: { refunded?: boolean }; message: string } };
  assert.equal(a.error.details?.refunded, true);
  const bad = harness({ provider: fail });
  bad.deps.ledger.refund = async () => {
    throw new Error("db down");
  };
  const b = (await (await handleVoiceStt(request(webm()), bad.deps)).json()) as { error: { details?: { refunded?: boolean }; message: string } };
  assert.equal(b.error.details?.refunded, false);
  assert.match(b.error.message, /환불 처리됩니다/);
});

test("409 문구는 크레딧이 사용되었을 수 있음을 알린다", async () => {
  const h = harness();
  await handleVoiceStt(request(webm()), h.deps);
  const res = await handleVoiceStt(request(webm()), h.deps);
  assert.match(((await res.json()) as { error: { message: string } }).error.message, /크레딧 1이 사용되었을 수 있습니다/);
});

test("동시 같은 request_id 두 요청: 차감 1회·제공자 1회, 나머지는 409", async () => {
  const h = harness();
  const [x, y] = await Promise.all([handleVoiceStt(request(webm()), h.deps), handleVoiceStt(request(webm()), h.deps)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal(h.consumed.length, 1);
  assert.equal(h.providerCalls.n, 1);
});

test("레이트 리밋은 본문 읽기 전: 한도 초과 요청은 본문 스트림을 열지 않는다", async () => {
  const h = harness();
  for (let i = 0; i < 12; i++) {
    const rid = `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`;
    await handleVoiceStt(request(webm(), { "x-request-id": rid }), h.deps);
  }
  let pulled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        pulled = true;
        c.close();
      },
    },
    { highWaterMark: 0 },
  );
  const req = new Request("http://localhost/api/voice/stt", { method: "POST", headers: { "content-type": "audio/webm", "x-request-id": RID }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleVoiceStt(req, h.deps)).status, 429);
  assert.equal(pulled, false);
});
