// POST /api/ai/chat 본체(04_API.md 2.1절 chat, AR-06-054 [DECISION] 1~7). 턴당 1크레딧, FastAPI /tools/answer를 서명 토큰(scope=chat)으로 직접 호출.
// 순서: 실패 닫힘 스위치(503, 인증 전·차감 0) → 인증 → 역할 member+(403) → 엔타이틀먼트(402) → 라이선스 폴백(ai_chat 0턴/일 → 403)
// → 레이트 리밋(429) → 본문(zod strict) → 멱등(중복 완료면 저장 답변 재전송, 처리 중·환불 후는 409) → 일일 턴 상한(원장 근사, 429)
// → 대화 소유 확인 → 토큰 발급 → 선차감 → FastAPI 호출(전체 60초) → 출처 재검사(문장별 source_ids ⊂ sources, 없는 문장 제거)
// → 대화·메시지 저장 → SSE 송출(문장 단위). 송출 시작 전 실패·타임아웃·0문장(no_source)은 전액 환불. 송출 뒤 클라이언트 중단은 차감 유지.
// 과금 표(로컬 리뷰 🔴 "폴백 무료 유도" 반영): 출처 있는 답을 전달하면 경로와 무관하게 1크레딧. 무료(환불)는 no_source·상류 실패/타임아웃·
// FastAPI 4xx 거절(폴백 없음)·저장 실패·확정 직전 클라이언트 중단뿐이고, 모두 답을 저장·전달하지 않는다(환불된 원장으로 재전송 불가).
// 선차감은 원장 nonce·조직·행위자·금액·대화를 대조해 이번 호출이 만든 행일 때만 통과(인스턴스 간 경합·키 재사용 → 409, 상류 호출 0).
// 환불 실패는 alert 로그를 남기고 응답의 credits·refunded에 실제 상태를 적는다.
// 응답·로그에 본문·토큰·예외 원문을 넣지 않는다. server-only를 import하지 않는다(node --test 대상).
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { errorResponse, GatewayError, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE, type GatewayErrorCode } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import { CHAT_TURN_CREDITS } from "../pricing.ts";

export const CHAT_CREDITS = CHAT_TURN_CREDITS.credits;
/** 환불·재전송 응답의 과금 표시. */
const NO_CHARGE = CHAT_CREDITS - CHAT_CREDITS;
export const NO_SOURCE_MESSAGE = "근거를 찾지 못했습니다. 크레딧은 차감되지 않았습니다.";
/** no_source 환불이 실패했을 때(정산 대기). */
export const NO_SOURCE_PENDING_MESSAGE = "근거를 찾지 못했습니다. 크레딧은 환불 처리됩니다.";
/** 클라이언트가 끊은 요청의 상태(nginx 관례). 본문 없음. */
const CLIENT_CLOSED = 499;
export const CHAT_MAX_BODY = 16 * 1024;
export const CHAT_MAX_MESSAGE = 2000;
/** 조직·사용자별 20회/분. */
export const CHAT_RATE = { limit: 20, windowS: 60 } as const;
/** 전체(FastAPI 호출 포함) 제한 시간. */
export const CHAT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_CHARS = 512 * 1024;
const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

export interface ChatSentence {
  text: string;
  source_ids: string[];
}
export interface ChatSource {
  chunk_id: string;
  title: string;
  article: string;
  effective_from: string;
}
export interface ChatAnswer {
  sentences: ChatSentence[];
  sources: ChatSource[];
}

/** 차감 RPC가 돌려준 원장 행의 사실. 읽지 못한 칸은 null(→ 불일치로 본다). */
export interface ChatLedgerRow {
  ledgerId: string;
  orgId: string | null;
  actorId: string | null;
  /** 차감 금액(양수). consume 행이 아니면 null. */
  amount: number | null;
  conversationId: string | null;
  /** 원장 metadata.nonce. 기존 행이 돌아오면 이번 호출의 nonce와 다르다. */
  nonce: string | null;
}

export interface ChatLedger {
  /** 이 멱등 키의 차감 원장 행 id(없으면 null). */
  find(key: string): Promise<string | null>;
  /** 오늘(KST 0시 = sinceIso 이후) 이 조직의 채팅 순차감 건수(차감 − 환불). */
  countSince(orgId: string, sinceIso: string): Promise<number>;
  /** 같은 키 원장이 이미 있으면 새로 차감하지 않고 그 행의 사실을 돌려준다(차감 RPC 멱등 키). */
  consume(args: { orgId: string; actorId: string; amount: number; key: string; requestId: string; conversationId: string; nonce: string }): Promise<ChatLedgerRow>;
  refund(args: { ledgerId: string; reason: string; key: string; actorId: string }): Promise<void>;
}

export interface ChatStore {
  /** 이 사용자의 이 조직 대화인가. */
  ownsConversation(orgId: string, userId: string, conversationId: string): Promise<boolean>;
  /** 원장 id로 저장된 답변(재전송용). 없으면 null. */
  findAnswer(orgId: string, ledgerId: string): Promise<{ conversationId: string; answer: ChatAnswer } | null>;
  saveTurn(args: {
    orgId: string;
    userId: string;
    conversationId: string;
    createConversation: boolean;
    userMessage: string;
    credits: number;
    answer: ChatAnswer;
    ledgerId: string;
  }): Promise<void>;
}

export interface ChatDeps {
  enabled(): boolean;
  session: GatewaySessionResolver;
  /** 플랜의 일일 채팅 턴 상한. 0 = 라이선스 폴백(ai_chat=false). */
  turnsPerDay(session: GatewaySession): Promise<number>;
  ledger: ChatLedger;
  store: ChatStore;
  /** FastAPI 기준 URL(ARCH_API_URL). 없으면 undefined. */
  apiUrl(): string | undefined;
  issueToken(args: { userId: string; orgId: string; conversationId: string; requestId: string }): string;
  fetch: typeof fetch;
  rateLimit: RateLimitStore;
  now(): number;
  /** 테스트용 재정의. 기본 CHAT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** 테스트용 재정의. 기본 randomUUID. */
  nonce?: () => string;
}

type ChatCode = "chat_disabled" | "ai_chat_unavailable" | "IDEMPOTENT_REPLAY" | "chat_rejected" | "chat_failed" | "chat_timeout";

const CHAT_ERRORS: Readonly<Record<ChatCode, { status: number; message: string }>> = {
  chat_disabled: { status: 503, message: "지금은 법규 질의를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다." },
  ai_chat_unavailable: { status: 403, message: "현재 이용권에서는 법규 질의 채팅을 쓸 수 없습니다." },
  IDEMPOTENT_REPLAY: { status: 409, message: "이미 처리 중이거나 완료되지 않은 요청입니다. 잠시 후 다시 확인하거나 새 요청으로 다시 보내 주세요." },
  chat_rejected: { status: 422, message: "질문을 처리할 수 없습니다. 내용을 고쳐 다시 보내 주세요. 크레딧은 환불되었습니다." },
  chat_failed: { status: 502, message: "답변을 만들지 못했습니다. 크레딧은 환불되었습니다." },
  chat_timeout: { status: 504, message: "답변 시간이 초과되었습니다. 크레딧은 환불되었습니다." },
};

class ChatReject extends Error {
  readonly code: ChatCode;
  /** 차감 뒤 실패에서만 값이 있다: 환불이 확정됐는가. */
  readonly refunded: boolean | undefined;
  constructor(code: ChatCode, refunded?: boolean) {
    super(code);
    this.name = "ChatReject";
    this.code = code;
    this.refunded = refunded;
  }
}

function chatReject(code: ChatCode, refunded?: boolean): Response {
  const spec = CHAT_ERRORS[code];
  const message = refunded === false ? spec.message.replace("환불되었습니다", "환불 처리됩니다") : spec.message;
  const error: Record<string, unknown> = { code, message };
  if (refunded !== undefined) error["details"] = { refunded };
  return new Response(JSON.stringify({ ok: false, error }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function logReject(code: string): void {
  logger.warn("ai_chat.rejected", { route: "ai_chat", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

export const chatRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    conversation_id: z.string().regex(UUID_RE).optional(),
    message: z.string().trim().min(1).max(CHAT_MAX_MESSAGE),
    application_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

// 같은 프로세스 안의 동시 중복을 막는다. has·add는 await 없이 동기로 처리한다(인스턴스 사이 경합은 DB 멱등 키가 추가 차감만 막는다).
const inflight = new Set<string>();

/** request_id로 정한 대화 id(UUID v4 모양). 첫 턴 재시도가 대화를 하나만 만들게 한다. */
export function conversationIdFor(orgId: string, requestId: string): string {
  const h = createHash("sha256").update(`arch-chat-conv:${orgId}:${requestId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** KST 오늘 0시(UTC ISO). */
export function kstDayStartIso(nowMs: number): string {
  const kstMs = nowMs + 9 * 3600_000;
  return new Date(kstMs - (kstMs % 86_400_000) - 9 * 3600_000).toISOString();
}

function kstDate(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}

// FastAPI 봉투 {ok:true,data:{…}}에서 data만 쓴다.
const upstreamSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    answer: z.object({ sentences: z.array(z.object({ text: z.string(), source_ids: z.array(z.string()) })) }),
    sources: z.array(z.object({ chunk_id: z.string(), title: z.string(), article: z.string(), effective_from: z.string() })),
    no_source: z.boolean(),
  }),
});

/** 출처 재검사: 알려진 출처 id만 남기고, 남은 출처가 없는 문장은 제거. 쓰인 출처만 반환. 봉투가 깨졌으면 null(no_source와 같이 환불). */
export function verifyAnswer(envelope: unknown): ChatAnswer | null {
  const env = upstreamSchema.safeParse(envelope);
  const parsed = env.success ? { success: true as const, data: env.data.data } : { success: false as const };
  if (!parsed.success || parsed.data.no_source) return null;
  const known = new Map(parsed.data.sources.map((s) => [s.chunk_id, s]));
  const sentences: ChatSentence[] = [];
  const used = new Set<string>();
  for (const s of parsed.data.answer.sentences) {
    const ids = [...new Set(s.source_ids)];
    if (s.text.trim() === "" || ids.length === 0 || !ids.every((id) => known.has(id))) continue;
    sentences.push({ text: s.text, source_ids: ids });
    for (const id of ids) used.add(id);
  }
  if (sentences.length === 0) return null;
  return { sentences, sources: [...known.values()].filter((s) => used.has(s.chunk_id)) };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(conversationId: string, answer: ChatAnswer | null, extra: Record<string, unknown>): Response {
  const parts: string[] = [];
  if (answer) {
    answer.sentences.forEach((s, index) => parts.push(sse("sentence", { index, text: s.text, source_ids: s.source_ids })));
    parts.push(sse("sources", answer.sources));
  }
  parts.push(sse("done", { conversation_id: conversationId, no_source: answer === null, ...extra }));
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-conversation-id": conversationId },
  });
}

async function refundSafe(deps: ChatDeps, session: GatewaySession, ledgerId: string, key: string, reason: string): Promise<boolean> {
  try {
    await deps.ledger.refund({ ledgerId, reason, key: `${key}:refund`, actorId: session.userId });
    return true;
  } catch {
    logger.error("ai_chat.refund_failed", { route: "ai_chat", reason, ledger_id: ledgerId, org_id: session.orgId, alert: true });
    return false;
  }
}

/** FastAPI가 4xx로 거절(입력·토큰 문제). 다시 보내도 같으므로 재시도·폴백 없이 환불한다. */
class UpstreamRejected extends Error {
  readonly status: number;
  constructor(status: number) {
    super("upstream_rejected");
    this.name = "UpstreamRejected";
    this.status = status;
  }
}

async function callUpstream(deps: ChatDeps, base: string, token: string, body: Record<string, unknown>, client: AbortSignal): Promise<unknown> {
  const signal = AbortSignal.any([AbortSignal.timeout(deps.timeoutMs ?? CHAT_TIMEOUT_MS), client]);
  const res = await deps.fetch(`${base.replace(/\/+$/, "")}/tools/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status >= 400 && res.status < 500) throw new UpstreamRejected(res.status);
  if (!res.ok) throw new Error("upstream_status");
  const text = await res.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error("upstream_size");
  return JSON.parse(text);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  let claimed: string | undefined;
  try {
    if (!deps.enabled()) throw new ChatReject("chat_disabled");

    const session = await deps.session.resolve(req);
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });
    const perDay = await deps.turnsPerDay(session);
    if (!(perDay > 0)) throw new ChatReject("ai_chat_unavailable");

    const hit = await deps.rateLimit.hit(`arch:ai_chat:${session.orgId}:${session.userId}`, CHAT_RATE.limit, CHAT_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }

    const parsed = chatRequestSchema.safeParse(await readJsonLimited(req, CHAT_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    const key = `chat:${session.orgId}:${input.request_id}`;
    if (inflight.has(key)) throw new ChatReject("IDEMPOTENT_REPLAY");
    inflight.add(key); // has와 add 사이에 await 없음
    claimed = key;

    const existing = await deps.ledger.find(key);
    if (existing !== null) {
      const stored = await deps.store.findAnswer(session.orgId, existing);
      if (stored) return sseResponse(stored.conversationId, stored.answer, { credits: NO_CHARGE, replay: true });
      throw new ChatReject("IDEMPOTENT_REPLAY");
    }

    const used = await deps.ledger.countSince(session.orgId, kstDayStartIso(deps.now()));
    if (used >= perDay) throw new GatewayError("AI_DAILY_LIMIT");

    let conversationId: string;
    let createConversation = false;
    if (input.conversation_id) {
      if (!(await deps.store.ownsConversation(session.orgId, session.userId, input.conversation_id))) throw new GatewayError("not_found");
      conversationId = input.conversation_id;
    } else {
      conversationId = conversationIdFor(session.orgId, input.request_id);
      createConversation = true;
    }

    const base = deps.apiUrl();
    if (!base) throw new ChatReject("chat_disabled");
    let token: string;
    try {
      token = deps.issueToken({ userId: session.userId, orgId: session.orgId, conversationId, requestId: input.request_id });
    } catch {
      throw new GatewayError("token_signing_unavailable");
    }

    const nonce = (deps.nonce ?? randomUUID)();
    let row: ChatLedgerRow;
    try {
      row = await deps.ledger.consume({ orgId: session.orgId, actorId: session.userId, amount: CHAT_CREDITS, key, requestId: input.request_id, conversationId, nonce });
    } catch (error) {
      const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
      throw new GatewayError(code === "CR001" ? "CR001" : "internal");
    }
    // 이번 호출이 새로 만든 행이 아니면(다른 인스턴스가 먼저 차감·환불된 키 재사용·다른 사용자·다른 대화) 상류 호출 전에 409.
    const fresh =
      row.nonce === nonce &&
      row.orgId === session.orgId &&
      row.actorId === session.userId &&
      row.amount === CHAT_CREDITS &&
      row.conversationId === conversationId;
    if (!fresh) throw new ChatReject("IDEMPOTENT_REPLAY");
    const ledgerId = row.ledgerId;

    let raw: unknown;
    try {
      raw = await callUpstream(deps, base, token, {
        request_id: input.request_id,
        message: input.message,
        application_date: input.application_date ?? kstDate(deps.now()),
      }, req.signal);
    } catch (error) {
      if (req.signal.aborted) {
        await refundSafe(deps, session, ledgerId, key, "chat_aborted");
        return new Response(null, { status: CLIENT_CLOSED });
      }
      if (error instanceof UpstreamRejected) {
        logger.warn("ai_chat.upstream_rejected", { route: "ai_chat", status: error.status });
        const refunded = await refundSafe(deps, session, ledgerId, key, "chat_rejected");
        throw new ChatReject(error.status === 422 ? "chat_rejected" : "chat_failed", refunded);
      }
      const timeout = isAbort(error);
      throw new ChatReject(timeout ? "chat_timeout" : "chat_failed", await refundSafe(deps, session, ledgerId, key, timeout ? "chat_timeout" : "chat_upstream_failed"));
    }

    const answer = verifyAnswer(raw);
    if (!answer) {
      const refunded = await refundSafe(deps, session, ledgerId, key, "chat_no_source");
      return sseResponse(conversationId, null, refunded ? { credits: NO_CHARGE, refunded, message: NO_SOURCE_MESSAGE } : { credits: CHAT_CREDITS, refunded, message: NO_SOURCE_PENDING_MESSAGE });
    }

    // 확정 직전 클라이언트가 끊었으면 답을 전달할 수 없으므로 저장하지 않고 환불(저장하면 같은 request_id 재전송이 무료 답이 된다).
    if (req.signal.aborted) {
      await refundSafe(deps, session, ledgerId, key, "chat_aborted");
      return new Response(null, { status: CLIENT_CLOSED });
    }

    try {
      await deps.store.saveTurn({
        orgId: session.orgId,
        userId: session.userId,
        conversationId,
        createConversation,
        userMessage: input.message,
        credits: CHAT_CREDITS,
        answer,
        ledgerId,
      });
    } catch {
      throw new ChatReject("chat_failed", await refundSafe(deps, session, ledgerId, key, "chat_save_failed"));
    }
    return sseResponse(conversationId, answer, { credits: CHAT_CREDITS });
  } catch (error) {
    if (error instanceof ChatReject) {
      logReject(error.code);
      return chatReject(error.code, error.refunded);
    }
    const code: GatewayErrorCode = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  } finally {
    if (claimed) inflight.delete(claimed);
  }
}
