// POST /api/ai/chat: 킬 스위치·멱등 재전송·409·no_source/타임아웃 환불·출처 재검사·403 폴백·일일 상한(AR-06-054 B). 원장·저장소·FastAPI는 가짜.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { isChatEnabled } from "./config.ts";
import { conversationIdFor, handleChat, NO_SOURCE_MESSAGE, kstDayStartIso, verifyAnswer, type ChatAnswer, type ChatDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RID = "11111111-1111-4111-8111-111111111111";

const session = (over: Partial<GatewaySession> = {}): GatewaySession => ({ userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "t".repeat(30), ...over });

const GOOD = {
  answer: { sentences: [{ text: "건폐율은 60% 이하입니다.", source_ids: ["c1"] }, { text: "출처 없는 문장", source_ids: [] }, { text: "가짜 출처", source_ids: ["zzz"] }] },
  sources: [
    { chunk_id: "c1", title: "건축법 시행령", article: "제84조", effective_from: "2026-01-01" },
    { chunk_id: "c2", title: "쓰이지 않음", article: "제1조", effective_from: "2026-01-01" },
  ],
  no_source: false,
};

interface H {
  deps: ChatDeps;
  consumed: string[];
  refunds: { ledgerId: string; reason: string }[];
  saved: { conversationId: string; answer: ChatAnswer; create: boolean }[];
  upstream: { n: number; auth: string[]; bodies: unknown[] };
}

function harness(
  opts: { enabled?: boolean; sess?: GatewaySession | Error; perDay?: number; used?: number; upstream?: (signal: AbortSignal) => Promise<Response>; timeoutMs?: number; refundFails?: boolean } = {},
): H {
  const keys = new Map<string, string>();
  const consumed: string[] = [];
  const refunds: { ledgerId: string; reason: string }[] = [];
  const saved: H["saved"] = [];
  const answers = new Map<string, { conversationId: string; answer: ChatAnswer }>();
  const upstream = { n: 0, auth: [] as string[], bodies: [] as unknown[] };
  const deps: ChatDeps = {
    enabled: () => opts.enabled ?? true,
    session: {
      async resolve() {
        if (opts.sess instanceof Error) throw opts.sess;
        return opts.sess ?? session();
      },
    },
    turnsPerDay: async () => opts.perDay ?? 20,
    ledger: {
      async find(key) {
        return keys.get(key) ?? null;
      },
      async countSince() {
        return opts.used ?? 0;
      },
      async consume(a) {
        const id = String(100 + keys.size);
        keys.set(a.key, id);
        consumed.push(a.key);
        return id;
      },
      async refund(a) {
        if (opts.refundFails) throw new Error("db");
        refunds.push({ ledgerId: a.ledgerId, reason: a.reason });
      },
    },
    store: {
      async ownsConversation() {
        return true;
      },
      async findAnswer(_org, ledgerId) {
        return answers.get(ledgerId) ?? null;
      },
      async saveTurn(a) {
        saved.push({ conversationId: a.conversationId, answer: a.answer, create: a.createConversation });
        answers.set(a.ledgerId, { conversationId: a.conversationId, answer: a.answer });
      },
    },
    apiUrl: () => "http://api.test",
    issueToken: () => "signed.token.value",
    fetch: (async (_url: string, init: RequestInit) => {
      upstream.n += 1;
      upstream.auth.push(String((init.headers as Record<string, string>)["authorization"]));
      upstream.bodies.push(JSON.parse(String(init.body)));
      if (opts.upstream) return opts.upstream(init.signal as AbortSignal);
      return new Response(JSON.stringify({ ok: true, data: GOOD }), { status: 200 });
    }) as unknown as typeof fetch,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.parse("2026-11-02T03:00:00Z"),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  };
  return { deps, consumed, refunds, saved, upstream };
}

function request(body: unknown = { request_id: RID, message: "건폐율이 얼마죠?" }): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer x" },
    body: JSON.stringify(body),
  });
}

async function code(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code?: string } }).error?.code;
}

function events(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((b) => {
      const [e, d] = b.split("\n") as [string, string];
      return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
    });
}

test("isChatEnabled: 정확히 \"true\"만 켜짐", () => {
  assert.equal(isChatEnabled({}), false);
  assert.equal(isChatEnabled({ ARCH_AI_CHAT_ENABLED: "1" }), false);
  assert.equal(isChatEnabled({ ARCH_AI_CHAT_ENABLED: "true" }), true);
});

test("킬 스위치 off: 인증 전 503, 차감·FastAPI 호출 0", async () => {
  const h = harness({ enabled: false, sess: new GatewayError("unauthorized") });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 503);
  assert.equal(await code(res), "chat_disabled");
  assert.deepEqual(h.consumed, []);
  assert.equal(h.upstream.n, 0);
});

test("정상: 문장 단위 SSE, 출처 없는·가짜 출처 문장 제거, 쓰인 출처만, 1회 차감·저장·서명 토큰 전달", async () => {
  const h = harness();
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const ev = events(await res.text());
  assert.deepEqual(ev.map((e) => e.event), ["sentence", "sources", "done"]);
  assert.equal((ev[0]!.data as { text: string }).text, "건폐율은 60% 이하입니다.");
  assert.deepEqual((ev[1]!.data as { chunk_id: string }[]).map((s) => s.chunk_id), ["c1"]);
  assert.equal((ev[2]!.data as { credits: number }).credits, 1);
  assert.equal(h.consumed.length, 1);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0]!.create, true);
  assert.equal(h.saved[0]!.conversationId, conversationIdFor(ORG, RID));
  assert.deepEqual(h.upstream.auth, ["Bearer signed.token.value"]);
  assert.equal((h.upstream.bodies[0] as { application_date: string }).application_date, "2026-11-02");
  assert.deepEqual(h.refunds, []);
});

test("멱등: 같은 request_id 재전송은 저장된 답변을 다시 보내고 차감·FastAPI 호출 추가 0", async () => {
  const h = harness();
  await (await handleChat(request(), h.deps)).text();
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 200);
  const ev = events(await res.text());
  assert.equal((ev[0]!.data as { text: string }).text, "건폐율은 60% 이하입니다.");
  assert.equal((ev.at(-1)!.data as { replay: boolean }).replay, true);
  assert.equal(h.consumed.length, 1);
  assert.equal(h.upstream.n, 1);
});

test("처리 중 동시 중복 → 409, 차감은 1회", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const h = harness({
    upstream: async () => {
      await gate;
      return new Response(JSON.stringify({ ok: true, data: GOOD }), { status: 200 });
    },
  });
  const first = handleChat(request(), h.deps);
  await new Promise((r) => setTimeout(r, 20));
  const second = await handleChat(request(), h.deps);
  assert.equal(second.status, 409);
  assert.equal(await code(second), "IDEMPOTENT_REPLAY");
  release();
  assert.equal((await first).status, 200);
  assert.equal(h.consumed.length, 1);
});

test("원장은 있는데 저장된 답변이 없으면(환불된 요청 등) 409", async () => {
  const h = harness({ upstream: async () => new Response(JSON.stringify({ ok: true, data: { ...GOOD, no_source: true } }), { status: 200 }) });
  await (await handleChat(request(), h.deps)).text();
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 409);
});

test("no_source: 환불, SSE done {no_source:true, refunded:true}, 저장 0", async () => {
  const h = harness({ upstream: async () => new Response(JSON.stringify({ ok: true, data: { answer: { sentences: [] }, sources: [], no_source: true } }), { status: 200 }) });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 200);
  const ev = events(await res.text());
  assert.deepEqual(ev.map((e) => e.event), ["done"]);
  assert.deepEqual(ev[0]!.data, { conversation_id: conversationIdFor(ORG, RID), no_source: true, credits: 0, refunded: true, message: NO_SOURCE_MESSAGE });
  assert.equal(h.refunds.length, 1);
  assert.equal(h.saved.length, 0);
});

test("출처 재검사 후 0문장이면 no_source로 환불", async () => {
  const bad = { answer: { sentences: [{ text: "x", source_ids: ["nope"] }] }, sources: [{ chunk_id: "c1", title: "t", article: "a", effective_from: "2026-01-01" }], no_source: false };
  const h = harness({ upstream: async () => new Response(JSON.stringify({ ok: true, data: bad }), { status: 200 }) });
  const ev = events(await (await handleChat(request(), h.deps)).text());
  assert.equal((ev[0]!.data as { no_source: boolean }).no_source, true);
  assert.equal(h.refunds.length, 1);
});

test("타임아웃: 504 chat_timeout, refunded:true, 환불 1회", async () => {
  const h = harness({
    timeoutMs: 30,
    upstream: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 504);
  const body = (await res.json()) as { error: { code: string; details: { refunded: boolean } } };
  assert.equal(body.error.code, "chat_timeout");
  assert.equal(body.error.details.refunded, true);
  assert.equal(h.refunds.length, 1);
  assert.equal(h.saved.length, 0);
});

test("FastAPI 오류 + 환불 실패: 502 refunded:false(정산 대기 문구)", async () => {
  const h = harness({ refundFails: true, upstream: async () => new Response("boom", { status: 500 }) });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { message: string; details: { refunded: boolean } } };
  assert.equal(body.error.details.refunded, false);
  assert.match(body.error.message, /환불 처리됩니다/);
});

test("라이선스 폴백(일일 0턴) → 403, 차감 0", async () => {
  const h = harness({ perDay: 0 });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 403);
  assert.equal(await code(res), "ai_chat_unavailable");
  assert.deepEqual(h.consumed, []);
});

test("일일 상한 도달 → 429 AI_DAILY_LIMIT, 차감 0", async () => {
  const h = harness({ perDay: 20, used: 20 });
  const res = await handleChat(request(), h.deps);
  assert.equal(res.status, 429);
  assert.equal(await code(res), "AI_DAILY_LIMIT");
  assert.deepEqual(h.consumed, []);
});

test("viewer 역할 403·엔타이틀먼트 만료 402·잘못된 본문 422, 모두 차감 0", async () => {
  const a = harness({ sess: session({ role: "viewer" }) });
  assert.equal((await handleChat(request(), a.deps)).status, 403);
  const b = harness({ sess: session({ entitled: false }) });
  assert.equal((await handleChat(request(), b.deps)).status, 402);
  const c = harness();
  assert.equal((await handleChat(request({ request_id: "x", message: "hi" }), c.deps)).status, 422);
  assert.equal((await handleChat(request({ request_id: RID, message: "hi", extra: 1 }), c.deps)).status, 422);
  assert.deepEqual([...a.consumed, ...b.consumed, ...c.consumed], []);
});

test("verifyAnswer·kstDayStartIso 단위", () => {
  assert.equal(verifyAnswer({ nope: 1 }), null);
  assert.equal(verifyAnswer(GOOD), null, "봉투 없는 응답은 거부");
  assert.equal(kstDayStartIso(Date.parse("2026-11-02T03:00:00Z")), "2026-11-01T15:00:00.000Z");
  assert.equal(kstDayStartIso(Date.parse("2026-11-01T16:00:00Z")), "2026-11-01T15:00:00.000Z");
});
