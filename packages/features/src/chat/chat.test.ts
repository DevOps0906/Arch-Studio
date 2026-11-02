// 법규 채팅 순수 로직 테스트(AR-06-055): SSE 증분 파싱, fetch + ReadableStream 스트리밍, 출처 재검사, 턴 비용,
// request_id 재전송(같은 id 재사용)·409 처리·환불 문구.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient, type FetchLike, type FetchResponseLike } from "../api-client/index.ts";
import {
  ChatFailure,
  EMPTY_ANSWER,
  applyEvent,
  classifyChatError,
  keepsRequestId,
  requestIdFor,
  sendChatTurn,
  turnCostText,
  visibleSentences,
} from "./model.ts";
import { createSseParser } from "./sse.ts";

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const SRC = { chunk_id: "c1", title: "건축법", article: "제55조", effective_from: "2026-01-01" };
const STREAM =
  sse("sentence", { index: 0, text: "건폐율 상한은 용도지역 조례를 따릅니다.", source_ids: ["c1"] }) +
  sse("sentence", { index: 1, text: "근거 없는 문장", source_ids: ["zz"] }) +
  sse("sources", [SRC]) +
  sse("done", { conversation_id: "conv-1", no_source: false, credits: 1 });

/** 바이트 조각으로 나눠 흘려 보내는 응답(ReadableStream 흉내). */
function streamResponse(text: string, pieces: number): FetchResponseLike {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / pieces);
  let i = 0;
  return {
    status: 200,
    headers: { get: () => null },
    text: async () => {
      throw new Error("stream response must not be read as text");
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (i >= bytes.length) return { done: true };
          const value = bytes.slice(i, i + size);
          i += size;
          return { done: false, value };
        },
        cancel: async () => undefined,
      }),
    },
  };
}
const jsonResponse = (status: number, body: unknown): FetchResponseLike => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });

function client(fetch: FetchLike) {
  let n = 0;
  return createApiClient({
    baseUrl: "https://api.test",
    getAccessToken: async () => "tok",
    fetch,
    genId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    sleep: async () => undefined,
  });
}

test("SSE 파서: 조각 경계(줄 중간·\\r\\n 분리)와 무관하게 같은 이벤트", () => {
  const whole = createSseParser().feed(STREAM);
  for (const cut of [1, 7, 13, 40]) {
    const p = createSseParser();
    const got = [];
    for (let i = 0; i < STREAM.length; i += cut) got.push(...p.feed(STREAM.slice(i, i + cut)));
    got.push(...p.flush());
    assert.deepEqual(got, whole);
  }
  const crlf = createSseParser();
  const ev = [...crlf.feed("event: done\r"), ...crlf.feed("\ndata: {}\r\n\r\n")];
  assert.deepEqual(ev, [{ event: "done", data: "{}" }]);
});

test("스트리밍: fetch POST(stream) → 조각마다 onUpdate, 출처 칩·턴 비용, 모르는 출처 문장 제거", async () => {
  const calls: Array<{ url: string; body: string | undefined; headers: Record<string, string> }> = [];
  const api = client(async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    return streamResponse(STREAM, 9);
  });
  const updates: number[] = [];
  const out = await sendChatTurn(api, { requestId: "11111111-1111-4111-8111-111111111111", message: "건폐율?", conversationId: null }, (s) => updates.push(s.sentences.length));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.test/api/ai/chat");
  assert.deepEqual(JSON.parse(calls[0]!.body!), { request_id: "11111111-1111-4111-8111-111111111111", message: "건폐율?" });
  assert.equal(calls[0]!.headers["Idempotency-Key"], undefined);
  assert.ok(updates.length >= 3, "이벤트마다 갱신");
  const vis = visibleSentences(out);
  assert.equal(vis.length, 1);
  assert.deepEqual(vis[0]!.sources, [SRC]);
  assert.equal(turnCostText(out.done!), "이번 답변 1 크레딧");
});

test("done 없이 끊긴 스트림 = 결과 모름(unknown) → 같은 request_id 유지", async () => {
  const api = client(async () => streamResponse(sse("sentence", { index: 0, text: "가", source_ids: ["c1"] }), 2));
  await assert.rejects(
    sendChatTurn(api, { requestId: "r1", message: "질문", conversationId: null }, () => undefined),
    (e: unknown) => e instanceof ChatFailure && e.kind === "unknown" && e.code === "stream_interrupted",
  );
  assert.equal(keepsRequestId("unknown"), true);
});

test("request_id 재전송: 같은 질문 재시도는 같은 id, 새 질문·새 요청은 새 id", () => {
  let n = 0;
  const gen = () => `new-${++n}`;
  const pending = { message: "질문", requestId: "keep-1" };
  assert.equal(requestIdFor(pending, "질문", gen), "keep-1");
  assert.equal(requestIdFor(pending, "다른 질문", gen), "new-1");
  assert.equal(requestIdFor(null, "질문", gen), "new-2");
});

test("같은 id 재전송 → 서버 재송출(replay): 0 크레딧 표시, 두 요청 본문의 request_id 동일", async () => {
  const ids: string[] = [];
  let call = 0;
  const api = client(async (_url, init) => {
    ids.push(JSON.parse(init.body!).request_id);
    call += 1;
    if (call === 1) throw new Error("socket closed");
    return streamResponse(sse("sentence", { index: 0, text: "답", source_ids: ["c1"] }) + sse("sources", [SRC]) + sse("done", { conversation_id: "c", no_source: false, credits: 0, replay: true }), 3);
  });
  let pending: { message: string; requestId: string } | null = null;
  const attempt = async () => {
    const requestId = requestIdFor(pending, "질문", () => api.newIdempotencyKey());
    pending = { message: "질문", requestId };
    try {
      const s = await sendChatTurn(api, { requestId, message: "질문", conversationId: null }, () => undefined);
      pending = null;
      return s;
    } catch (e) {
      const f = classifyChatError(e);
      if (!keepsRequestId(f.kind)) pending = null;
      throw f;
    }
  };
  await assert.rejects(attempt(), (e: unknown) => e instanceof ChatFailure && e.kind === "unknown" && e.code === "network_offline");
  const ok = await attempt();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1], "결과를 모르는 실패 뒤 재전송은 같은 request_id");
  assert.equal(turnCostText(ok.done!), "이전 답변 다시 받기 · 0 크레딧");
});

test("409 IDEMPOTENT_REPLAY: 자동 재시도 없이 replay_conflict, id 유지(다시 확인) · 새 요청은 새 id", async () => {
  let calls = 0;
  const api = client(async () => {
    calls += 1;
    return jsonResponse(409, { ok: false, error: { code: "IDEMPOTENT_REPLAY", message: "..." } });
  });
  await assert.rejects(
    sendChatTurn(api, { requestId: "r409", message: "q", conversationId: null }, () => undefined),
    (e: unknown) => e instanceof ChatFailure && e.kind === "replay_conflict" && /새 요청/.test(e.message),
  );
  assert.equal(calls, 1);
  assert.equal(keepsRequestId("replay_conflict"), true);
});

test("확정 실패(환불)·잠금·한도: 다음 전송은 새 id, 환불 실패는 '환불 처리됩니다'", async () => {
  const cases: Array<[number, string, Record<string, unknown> | undefined, string]> = [
    [502, "chat_failed", { refunded: true }, "final"],
    [504, "chat_timeout", undefined, "final"],
    [403, "ai_chat_unavailable", undefined, "locked"],
    [429, "AI_DAILY_LIMIT", undefined, "final"],
    [402, "CR001", undefined, "final"],
  ];
  for (const [status, code, details, kind] of cases) {
    let calls = 0;
    const api = client(async () => {
      calls += 1;
      return jsonResponse(status, { ok: false, error: { code, message: "", ...(details ? { details } : {}) } });
    });
    await assert.rejects(sendChatTurn(api, { requestId: "r", message: "q", conversationId: null }, () => undefined), (e: unknown) => e instanceof ChatFailure && e.kind === kind);
    assert.equal(calls, 1, `${code}: 자동 재시도 없음(같은 id 재전송은 409가 된다)`);
    assert.equal(keepsRequestId(kind as "final"), false);
  }
  const api = client(async () => jsonResponse(502, { ok: false, error: { code: "chat_failed", message: "", details: { refunded: false } } }));
  await assert.rejects(sendChatTurn(api, { requestId: "r", message: "q", conversationId: null }, () => undefined), (e: unknown) => e instanceof ChatFailure && e.message.includes("환불 처리됩니다"));
});

test("no_source done: 문장 없음, 0 크레딧 문구, 대화 id는 다음 턴에 실린다", () => {
  let s = EMPTY_ANSWER;
  s = applyEvent(s, { event: "done", data: JSON.stringify({ conversation_id: "c9", no_source: true, credits: 0, refunded: true, message: "근거를 찾지 못했습니다." }) });
  assert.equal(visibleSentences(s).length, 0);
  assert.equal(turnCostText(s.done!), "0 크레딧(근거 없음, 차감 안 함)");
  // done 뒤 이벤트는 무시
  assert.equal(applyEvent(s, { event: "sentence", data: JSON.stringify({ index: 0, text: "x", source_ids: ["c1"] }) }), s);
});
