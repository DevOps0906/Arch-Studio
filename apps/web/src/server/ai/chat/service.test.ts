// POST /api/ai/chat(AR-06-054): 답변마다 출처 1개 이상 또는 "근거를 찾지 못했습니다", Dify 입력에 토큰·org 없음,
// Dify 장애 시 answer-direct(폴백 턴 0크레딧), request_id 재사용 409, 일일 상한, 실패 닫힘.
// 원장은 consume_credits·refund_credits와 같은 멱등 규칙의 가짜. Dify·FastAPI는 가짜 fetch(외부 호출 없음).
import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { NO_SOURCE_ANSWER, toChatAnswer } from "./answer.ts";
import { chatChargeFor, chatIdempotencyKey, chatRefundKey } from "./billing.ts";
import { chatConfigOf, difyUserOf, type ChatConfig } from "./config.ts";
import { handleChat, kstDayStartIso, type ChatConversation, type ChatDeps } from "./service.ts";
import { difyClient, directClient } from "./upstream.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_USER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const REQ = "22222222-2222-4222-8222-222222222222";
const REQ2 = "33333333-3333-4333-8333-333333333333";
const CONV = "44444444-4444-4444-8444-444444444444";
const NEW_CONV = "55555555-5555-4555-8555-555555555555";
const ACCESS = "user-access-token-value-0123456789";
const SIGNED = "signed.chat.token-abcdef";
const NOW = Date.UTC(2026, 10, 2, 3, 0, 0);
const SECRET = "s".repeat(40);
const CONFIG: ChatConfig = { hmacSecret: SECRET, aiServiceUrl: "http://api.local", dify: { baseUrl: "http://dify.local/v1", appKey: "app-dify-key" } };

const CITE = { law: "건축법 시행령", article: "제80조", effective_from: "2024-07-01", source_id: "daylight-height" };

function toolBody(over: { citations?: unknown[]; no_source?: boolean; answer?: string } = {}) {
  return {
    ok: true,
    data: { answer: over.answer ?? "일반 해설입니다.", citations: over.citations ?? [CITE], no_source: over.no_source ?? false, usage: { model: "m" } },
  };
}

function difySse(answerJson: unknown, opts: { error?: boolean } = {}): string {
  const text = JSON.stringify(answerJson);
  const half = Math.floor(text.length / 2);
  let s = `data: ${JSON.stringify({ event: "workflow_started", conversation_id: "dify-conv-1" })}\n\n`;
  s += `data: ${JSON.stringify({ event: "message", answer: text.slice(0, half), conversation_id: "dify-conv-1" })}\n\n`;
  if (opts.error) return s + `data: ${JSON.stringify({ event: "error", message: "boom" })}\n\n`;
  s += `data: ${JSON.stringify({ event: "message", answer: text.slice(half) })}\n\n`;
  return s + `data: ${JSON.stringify({ event: "message_end", conversation_id: "dify-conv-1" })}\n\n`;
}

type Mode = { status: number; body?: string } | "network" | "hang";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface Row {
  id: number;
  amount: number;
  orgId: string;
  actorId: string;
  conversationId: string;
  nonce: string;
}

interface World {
  config: ChatConfig | null;
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  turnsToday: number;
  consumes: Map<string, Row>;
  refunds: Map<string, { ledgerId: number; amount: number; reason: string }>;
  balance: number;
  conversations: Map<string, ChatConversation & { userId: string }>;
  created: string[];
  difyMode: Mode;
  directMode: Mode;
  difyCalls: Call[];
  directCalls: Call[];
  tokenIssued: Array<Record<string, string>>;
}

function world(over: Partial<World> = {}): World {
  return {
    config: CONFIG,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: ACCESS },
    features: { ai_chat_turns_per_day: 20 },
    turnsToday: 0,
    consumes: new Map(),
    refunds: new Map(),
    balance: 10,
    conversations: new Map([[CONV, { id: CONV, userId: USER, difyUser: difyUserOf(SECRET, ORG, USER), difyConversationId: "dify-conv-1" }]]),
    created: [],
    difyMode: { status: 200, body: difySse(toolBody()) },
    directMode: { status: 200, body: JSON.stringify(toolBody()) },
    difyCalls: [],
    directCalls: [],
    tokenIssued: [],
    ...over,
  };
}

function fakeFetch(mode: () => Mode, calls: Call[]): typeof globalThis.fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? "") });
    const m = mode();
    if (m === "network") throw new TypeError("fetch failed http://secret-host");
    if (m === "hang") {
      return new Response(
        new ReadableStream({
          start(ctrl) {
            init?.signal?.addEventListener("abort", () => ctrl.error(new Error("aborted")));
          },
        }),
        { status: 200 },
      );
    }
    return new Response(m.body ?? "", { status: m.status });
  }) as typeof globalThis.fetch;
}

function deps(w: World): ChatDeps {
  let nonceSeq = 0;
  return {
    config: () => w.config,
    dify: (c) => difyClient({ baseUrl: c.dify.baseUrl, appKey: c.dify.appKey, fetch: fakeFetch(() => w.difyMode, w.difyCalls), idleMs: 50 }),
    direct: (c) =>
      directClient({
        baseUrl: c.aiServiceUrl,
        issueToken: (t) => {
          w.tokenIssued.push({ orgId: t.orgId, userId: t.userId, conv: t.platformConversationId });
          return SIGNED;
        },
        fetch: fakeFetch(() => w.directMode, w.directCalls),
      }),
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    org: () => ({ orgFeatures: async () => w.features }),
    credits: () => ({
      async reserve({ orgId, actorId, requestId, conversationId, amount, nonce }) {
        const key = chatIdempotencyKey(orgId, requestId);
        const hit = w.consumes.get(key);
        const row = hit ?? { id: w.consumes.size + 1, amount, orgId, actorId, conversationId, nonce };
        if (!hit) {
          if (w.balance < amount) throw Object.assign(new Error("db"), { code: "CR001" });
          w.balance -= amount;
          w.consumes.set(key, row);
        }
        return { ledgerId: row.id, orgId: row.orgId, actorId: row.actorId, amount: row.amount, conversationId: row.conversationId, nonce: row.nonce };
      },
      async refund({ ledgerId, orgId, requestId, amount, reason }) {
        const key = chatRefundKey(orgId, requestId);
        if (w.refunds.has(key)) return;
        w.refunds.set(key, { ledgerId, amount, reason });
        w.balance += amount;
      },
      async turnsSince() {
        return w.turnsToday;
      },
    }),
    conversations: () => ({
      async get(session, id) {
        const c = w.conversations.get(id);
        return c && c.userId === session.userId ? { id: c.id, difyUser: c.difyUser, difyConversationId: c.difyConversationId } : null;
      },
      async create({ id, userId, difyUser }) {
        w.created.push(id);
        w.conversations.set(id, { id, userId, difyUser, difyConversationId: null });
      },
      async setDifyConversation({ id, difyConversationId }) {
        const c = w.conversations.get(id);
        if (c) c.difyConversationId = difyConversationId;
      },
    }),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
    nonce: () => `nonce-${++nonceSeq}-${Math.random()}`,
    newId: () => NEW_CONV,
  };
}

function req(body: unknown): Request {
  return new Request("http://local/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ACCESS}` },
    body: JSON.stringify(body),
  });
}

async function events(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [ev, data] = block.split("\n");
      return { event: (ev ?? "").replace("event: ", ""), data: JSON.parse((data ?? "").replace("data: ", "")) as Record<string, unknown> };
    });
}

function find(evs: Awaited<ReturnType<typeof events>>, name: string) {
  return evs.find((e) => e.event === name)?.data;
}

const MSG = "일조 사선 제한은 어떻게 되나요";

test("Dify 경로: 출처가 붙은 답 → SSE delta·citations·done, 1크레딧 확정", async () => {
  const w = world();
  const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/event-stream/);
  const evs = await events(res);
  assert.deepEqual(evs.map((e) => e.event), ["delta", "citations", "done"]);
  assert.equal(find(evs, "delta")?.text, "일반 해설입니다.");
  const cites = find(evs, "citations")?.citations as unknown[];
  assert.ok(cites.length >= 1);
  assert.deepEqual(find(evs, "done"), { conversation_id: CONV, request_id: REQ, credits: 1, fallback: false });
  assert.equal(w.balance, 9);
  assert.equal(w.refunds.size, 0);
  assert.equal(w.directCalls.length, 0);
});

test("Dify 입력에 토큰·org·사용자 id 없음(입력 변수는 platform_conversation_id만, user는 HMAC)", async () => {
  const w = world();
  await handleChat(req({ request_id: REQ, message: MSG }), deps(w));
  assert.equal(w.difyCalls.length, 1);
  const call = w.difyCalls[0]!;
  const sent = JSON.stringify(call);
  for (const secret of [ORG, USER, ACCESS, SIGNED, SECRET]) assert.equal(sent.includes(secret), false, "Dify 요청에 민감 값");
  const body = JSON.parse(call.body) as { inputs: Record<string, unknown>; user: string; query: string };
  assert.deepEqual(Object.keys(body.inputs), ["platform_conversation_id"]);
  assert.equal(body.inputs.platform_conversation_id, NEW_CONV);
  assert.match(body.user, /^du_[A-Za-z0-9_-]{32}$/);
  assert.equal(body.query, MSG);
  assert.equal(call.headers.authorization, "Bearer app-dify-key");
  // 새 대화는 차감 뒤 서버가 만들고 Dify 대화 id를 기록한다.
  assert.deepEqual(w.created, [NEW_CONV]);
  assert.equal(w.conversations.get(NEW_CONV)?.difyConversationId, "dify-conv-1");
});

test("출처 없음: '근거를 찾지 못했습니다' + no_source 이벤트, 전액 환불(0크레딧)", async () => {
  for (const body of [toolBody({ citations: [], no_source: true, answer: NO_SOURCE_ANSWER }), toolBody({ citations: [] })]) {
    const w = world({ difyMode: { status: 200, body: difySse(body) } });
    const evs = await events(await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w)));
    assert.equal(find(evs, "delta")?.text, "근거를 찾지 못했습니다");
    assert.deepEqual(find(evs, "citations")?.citations, []);
    assert.equal(find(evs, "no_source")?.message, "근거를 찾지 못했습니다");
    assert.equal(find(evs, "done")?.credits, 0);
    assert.equal(w.balance, 10);
    assert.equal(w.refunds.get(chatRefundKey(ORG, REQ))?.reason, "chat_no_source");
  }
});

test("Dify 장애(5xx·연결 실패·error 이벤트·10초 무응답·계약 위반) → answer-direct, 폴백 턴 0크레딧", async () => {
  const modes: Mode[] = [
    { status: 502, body: "bad gateway" },
    "network",
    { status: 200, body: difySse(toolBody(), { error: true }) },
    "hang",
    { status: 200, body: difySse({ ok: true, data: { answer: "x" } }) },
  ];
  for (const difyMode of modes) {
    const w = world({ difyMode });
    const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w));
    assert.equal(res.status, 200);
    const evs = await events(res);
    assert.ok((find(evs, "citations")?.citations as unknown[]).length >= 1);
    assert.deepEqual(find(evs, "done"), { conversation_id: CONV, request_id: REQ, credits: 0, fallback: true });
    assert.equal(w.balance, 10, "폴백 턴은 환불");
    assert.equal(w.refunds.get(chatRefundKey(ORG, REQ))?.reason, "chat_fallback");
    // answer-direct: 서명 토큰(scope chat, conv 바인딩)으로, 본문에 org 없음.
    assert.equal(w.directCalls.length, 1);
    const d = w.directCalls[0]!;
    assert.equal(d.url, "http://api.local/tools/answer-direct");
    assert.equal(d.headers.authorization, `Bearer ${SIGNED}`);
    assert.deepEqual(JSON.parse(d.body), { platform_conversation_id: CONV, query: MSG });
    assert.deepEqual(w.tokenIssued, [{ orgId: ORG, userId: USER, conv: CONV }]);
  }
});

test("Dify 미설정(URL·키 없음)은 무료 폴백이 아니라 503(인증·차감·상류 호출 전)", async () => {
  const base = { DIFY_USER_HMAC_SECRET: SECRET, AI_SERVICE_URL: "http://api", DIFY_API_URL: "https://dify/v1", DIFY_APP_KEY_ARCH: "k" };
  for (const drop of ["DIFY_API_URL", "DIFY_APP_KEY_ARCH"] as const) {
    const env: Record<string, string | undefined> = { ...base, [drop]: undefined };
    const config = chatConfigOf(env);
    assert.equal(config, null);
    const w = world({ config });
    const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "AI_UNAVAILABLE");
    assert.equal(w.consumes.size, 0);
    assert.equal(w.difyCalls.length + w.directCalls.length, 0);
  }
});

test("Dify·answer-direct 모두 실패 → 503 AI_UNAVAILABLE, 환불", async () => {
  const w = world({ difyMode: { status: 500 }, directMode: { status: 503 } });
  const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w));
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "AI_UNAVAILABLE");
  assert.equal(w.balance, 10);
  assert.equal(w.refunds.get(chatRefundKey(ORG, REQ))?.reason, "chat_failed");
});

test("request_id 재사용 → 409, 상류 재호출·추가 차감 없음(성공 후·환불 후·다른 대화)", async () => {
  const w = world();
  const d = deps(w);
  assert.equal((await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), d)).status, 200);
  const again = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), d);
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: { code: string } }).error.code, "chat_request_done");
  assert.equal(w.difyCalls.length, 1);
  assert.equal(w.balance, 9);
  // 새 대화로 같은 request_id(대화 불일치)도 409.
  assert.equal((await handleChat(req({ request_id: REQ, message: MSG }), d)).status, 409);
  assert.equal(w.difyCalls.length, 1);

  // 환불된(출처 없음) 원장 재사용: 무료 턴 반복 차단.
  const w2 = world({ difyMode: { status: 200, body: difySse(toolBody({ citations: [] })) } });
  const d2 = deps(w2);
  assert.equal((await handleChat(req({ request_id: REQ2, conversation_id: CONV, message: MSG }), d2)).status, 200);
  assert.equal((await handleChat(req({ request_id: REQ2, conversation_id: CONV, message: MSG }), d2)).status, 409);
  assert.equal(w2.difyCalls.length, 1);
  assert.equal(w2.balance, 10);
});

test("설정 없음 → 503(인증·차감 전)", async () => {
  let resolved = false;
  const w = world({ config: null });
  const d = deps(w);
  d.session = { resolve: async () => ((resolved = true), w.session as GatewaySession) };
  const res = await handleChat(req({ request_id: REQ, message: MSG }), d);
  assert.equal(res.status, 503);
  assert.equal(resolved, false);
  assert.equal(w.consumes.size, 0);
});

test("일일 상한: 0(폴백 상태 포함)·초과 → 429 AI_DAILY_LIMIT, 차감 0", async () => {
  for (const over of [{ features: { ai_chat_turns_per_day: 0 } }, { features: {} }, { features: { ai_chat_turns_per_day: 20 }, turnsToday: 20 }]) {
    const w = world(over);
    const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(w));
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "AI_DAILY_LIMIT");
    assert.equal(w.consumes.size, 0);
    assert.equal(w.difyCalls.length, 0);
  }
});

test("입력·권한·대화 소유·크레딧 부족 거부는 차감 0", async () => {
  const cases: Array<[Partial<World>, unknown, number]> = [
    [{}, { request_id: REQ, message: MSG, org_id: ORG }, 422],
    [{}, { request_id: REQ, message: "   " }, 422],
    [{}, { request_id: REQ, message: "x".repeat(2001) }, 422],
    [{}, { request_id: "not-uuid", message: MSG }, 422],
    [{ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: ACCESS } }, { request_id: REQ, message: MSG }, 403],
    [{ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: ACCESS } }, { request_id: REQ, message: MSG }, 402],
    [{ session: new GatewayError("unauthorized") }, { request_id: REQ, message: MSG }, 401],
    [{ features: { ai_chat: false, ai_chat_turns_per_day: 20 } }, { request_id: REQ, message: MSG }, 402],
    [{ session: { userId: OTHER_USER, orgId: ORG, role: "member", entitled: true, accessToken: ACCESS } }, { request_id: REQ, conversation_id: CONV, message: MSG }, 404],
  ];
  for (const [over, body, status] of cases) {
    const w = world(over);
    const res = await handleChat(req(body), deps(w));
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(w.consumes.size, 0);
    assert.equal(w.difyCalls.length, 0);
  }
  const poor = world({ balance: 0 });
  const res = await handleChat(req({ request_id: REQ, conversation_id: CONV, message: MSG }), deps(poor));
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "CR001");
  assert.equal(poor.difyCalls.length, 0);
});

test("toChatAnswer: 출처 0개면 답 문장을 버림, 계약 위반은 예외", () => {
  assert.deepEqual(toChatAnswer(toolBody({ citations: [] })), { answer: NO_SOURCE_ANSWER, citations: [], noSource: true });
  assert.deepEqual(toChatAnswer(toolBody({ no_source: true })), { answer: NO_SOURCE_ANSWER, citations: [], noSource: true });
  assert.equal(toChatAnswer(toolBody()).citations.length, 1);
  assert.throws(() => toChatAnswer({ ok: true, data: { answer: "x", citations: [{ law: "a" }], no_source: false } }));
  assert.throws(() => toChatAnswer({ ok: false }));
});

test("크레딧 규칙·키·한국 시간 0시·설정 판정", () => {
  assert.equal(chatChargeFor("dify", false), 1);
  assert.equal(chatChargeFor("dify", true), 0);
  assert.equal(chatChargeFor("direct", false), 0);
  assert.equal(chatIdempotencyKey(ORG, REQ), `chat:${ORG}:${REQ}`);
  assert.equal(chatRefundKey(ORG, REQ), `chat:${ORG}:${REQ}:refund`);
  assert.equal(kstDayStartIso(Date.UTC(2026, 10, 2, 3, 0, 0)), "2026-11-01T15:00:00.000Z");
  assert.equal(kstDayStartIso(Date.UTC(2026, 10, 2, 16, 0, 0)), "2026-11-02T15:00:00.000Z");
  assert.equal(chatConfigOf({}), null);
  assert.equal(chatConfigOf({ DIFY_USER_HMAC_SECRET: "short", AI_SERVICE_URL: "http://api" }), null);
  assert.equal(chatConfigOf({ DIFY_USER_HMAC_SECRET: SECRET, AI_SERVICE_URL: "http://api/" }), null);
  const full = chatConfigOf({ DIFY_USER_HMAC_SECRET: SECRET, AI_SERVICE_URL: "https://api/", DIFY_API_URL: "https://dify/v1", DIFY_APP_KEY_ARCH: "k" });
  assert.deepEqual(full, { hmacSecret: SECRET, aiServiceUrl: "https://api", dify: { baseUrl: "https://dify/v1", appKey: "k" } });
  const du = difyUserOf(SECRET, ORG, USER);
  assert.equal(du, difyUserOf(SECRET, ORG, USER));
  assert.notEqual(du, difyUserOf(SECRET, ORG, OTHER_USER));
  assert.equal(du.includes(USER.slice(0, 8)), false);
});
