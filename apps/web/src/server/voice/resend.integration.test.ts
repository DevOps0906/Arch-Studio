// 통합형: 실제 서비스(handleVoiceStt) + 실제 클라이언트 경로(api-client·transcribeAudio·dictation). 환불 뒤 새 request_id 재전송 성공, 409 뒤 재전송 숨김.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "../../../../../packages/features/src/api-client/index.ts";
import type { FetchInit, FetchResponseLike } from "../../../../../packages/features/src/api-client/types.ts";
import { createDictation, type DictationDeps, type RecordingHandle } from "../../../../../packages/features/src/voice/dictation.ts";
import { transcribeAudio } from "../../../../../packages/features/src/voice/transcribe.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { fakeSttProvider } from "./provider.ts";
import { handleVoiceStt, type VoiceDeps } from "./service.ts";

const tick = () => new Promise<void>((r) => setImmediate(r));
const SESSION: GatewaySession = { userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", orgId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: "member", entitled: true, accessToken: "t".repeat(30) };

function webmBlob(): Blob {
  const b = new Uint8Array(20000).fill(1);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return new Blob([b], { type: "audio/webm" });
}

function setup(opts: { failFirstProvider: boolean; failRefund?: boolean }) {
  const keys = new Set<string>();
  const refundKeys: string[] = [];
  let providerCalls = 0;
  const server: VoiceDeps = {
    enabled: () => true,
    session: { resolve: async () => SESSION },
    ledger: {
      exists: async (k) => keys.has(k),
      consume: async (a) => {
        keys.add(a.key);
        return "7";
      },
      refund: async (a) => {
        if (opts.failRefund) throw new Error("down");
        refundKeys.push(a.key);
      },
    },
    provider: {
      async transcribe(r) {
        providerCalls += 1;
        if (opts.failFirstProvider && providerCalls === 1) throw new Error("provider down");
        return fakeSttProvider().transcribe(r);
      },
    },
    token: async () => "tok",
    rateLimit: new MemoryRateLimitStore(),
    now: () => 1_000_000,
  };
  const sentIds: string[] = [];
  const api = createApiClient({
    baseUrl: "https://x.test",
    getAccessToken: async () => "tok",
    genId: () => "gen",
    fetch: async (url, init: FetchInit): Promise<FetchResponseLike> => {
      const body = init.binaryBody instanceof Blob ? new Uint8Array(await init.binaryBody.arrayBuffer()) : (init.binaryBody as Uint8Array);
      sentIds.push(init.headers["x-request-id"] ?? "");
      const res = await handleVoiceStt(new Request(url, { method: "POST", headers: init.headers, body: body as BodyInit }), server);
      return { status: res.status, headers: { get: (n) => res.headers.get(n) }, text: () => res.text() };
    },
  });
  let n = 0;
  const rec: RecordingHandle = { stop() {}, release() {}, done: Promise.resolve({ audio: webmBlob(), contentType: "audio/webm" }) };
  const deps: DictationDeps = {
    supported: () => true,
    startRecording: async () => rec,
    transcribe: (a, ct, id, sig) => transcribeAudio(api, a, ct, id, sig),
    newRequestId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`,
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => 0,
  };
  return { dictation: createDictation(deps, { noticeAccepted: true }), sentIds, refundKeys, calls: () => providerCalls };
}

async function run(d: ReturnType<typeof createDictation>): Promise<void> {
  d.start();
  for (let k = 0; k < 12; k++) await tick();
}

test("제공자 실패 → 환불 확정 → 같은 녹음 + 새 request_id 재전송 성공", async () => {
  const s = setup({ failFirstProvider: true });
  await run(s.dictation);
  const e = s.dictation.state();
  assert.equal(e.kind, "error");
  assert.equal(e.kind === "error" && e.canResend, true);
  assert.equal(s.refundKeys.length, 1);
  s.dictation.resend();
  for (let k = 0; k < 12; k++) await tick();
  assert.equal(s.dictation.state().kind, "result");
  assert.equal(s.sentIds.length, 2);
  assert.notEqual(s.sentIds[0], s.sentIds[1]);
  assert.equal(s.calls(), 2);
});

test("환불까지 실패하면 재전송 숨김(\"환불 처리됩니다\")", async () => {
  const s = setup({ failFirstProvider: true, failRefund: true });
  await run(s.dictation);
  const e = s.dictation.state();
  assert.equal(e.kind === "error" && e.canResend, false);
  assert.match(e.kind === "error" ? e.message : "", /환불 처리됩니다/);
});
