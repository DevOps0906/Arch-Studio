// POST /api/ai/chat 본체(04_API.md 2.2절 `/api/ai/chat` 행·6.4절, AR-06-054).
// 입력 `{ request_id: uuid v4, conversation_id?: uuid, message: 1..2000 }` → SSE(text/event-stream):
//   `delta {text}` → `citations {citations[]}` → (`no_source {message}`) → `done {conversation_id, request_id, credits, fallback}`.
// 순서: 실패 닫힘(Dify·HMAC·AI_SERVICE_URL 중 하나라도 설정 없음 503, 인증 전) → 인증 → 사용자 레이트 리밋(20회/60초) → member+ → 엔타이틀먼트
//   → 본문 → 일일 턴 상한(`ai_chat_turns_per_day`, 0이면 폴백 상태 포함 AI_DAILY_LIMIT) → 대화 확인(본인 것만)
//   → 선차감 1(`chat:<org_id>:<request_id>`, 새 원장만 통과·재사용은 409) → 새 대화면 core.ai_conversations 생성
//   → Dify(실패 시 answer-direct + 운영 알림 로그) → 확정/환불 → SSE.
// 크레딧: Dify 경로로 출처가 붙은 답만 1. 출처 없음·폴백·실패는 전액 환불(0). 차감은 credits.reserve 한 곳에서만.
// 상류 답은 출처 규칙을 다시 검사한 뒤에만 내보내므로(answer.ts) 전체를 받은 다음 SSE로 보낸다.
// 응답·로그에 질문·답변 원문·토큰·키·예외 원문을 넣지 않는다. 조직·행위자는 세션에서만.
// server-only를 import하지 않는다(node --test 대상).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import { errorResponse, GatewayError, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import type { ChatAnswer, Citation } from "./answer.ts";
import { CHAT_TURN_COST, chatChargeFor, type ChatRoute } from "./billing.ts";
import { difyUserOf, type ChatConfig } from "./config.ts";
import type { DifyClient, DirectClient } from "./upstream.ts";

export interface ChatReserveInput {
  orgId: string;
  actorId: string;
  requestId: string;
  conversationId: string;
  amount: number;
  /** 이번 호출만의 값(원장 metadata.nonce). 기존 원장이 돌아오면 다르다. */
  nonce: string;
}

/** 돌려받은 원장 행의 사실. 읽지 못한 칸은 null(→ 불일치로 본다). */
export interface ChatLedger {
  ledgerId: number;
  orgId: string | null;
  actorId: string | null;
  amount: number | null;
  conversationId: string | null;
  nonce: string | null;
}

// 원장 차감·환불(service_role RPC, 구현은 supabase-repo.ts). 멱등 키는 구현이 billing.ts 규칙으로 만든다.
export interface ChatCredits {
  /** 같은 키 원장이 이미 있으면 새로 차감하지 않고 기존 원장의 사실을 돌려준다(053 voice와 같은 계약). */
  reserve(input: ChatReserveInput): Promise<ChatLedger>;
  /** 전액 환불(키 `chat:<org_id>:<request_id>:refund`, 한 요청에 한 번). */
  refund(input: { ledgerId: number; orgId: string; requestId: string; amount: number; reason: string }): Promise<void>;
  /** 오늘(한국 시간 0시 이후) 이 조직의 채팅 턴 차감 원장 수. 환불된 턴도 센다. */
  turnsSince(orgId: string, sinceIso: string): Promise<number>;
}

export interface ChatConversation {
  id: string;
  difyUser: string;
  difyConversationId: string | null;
}

export interface ChatConversations {
  /** 본인·active 대화만(사용자 JWT, RLS). 없으면 null. */
  get(session: GatewaySession, id: string): Promise<ChatConversation | null>;
  /** core.ai_conversations INSERT(service_role: 사용자 쓰기 정책 없음). */
  create(input: { id: string; orgId: string; userId: string; difyUser: string }): Promise<void>;
  /** 첫 Dify 응답의 대화 id 기록(service_role). 실패해도 답은 전달한다. */
  setDifyConversation(input: { id: string; orgId: string; difyConversationId: string }): Promise<void>;
}

export interface ChatOrgRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
}

export interface ChatDeps {
  /** null = 설정 없음(503, 차감 0). 요청마다 읽는다. */
  config(): ChatConfig | null;
  dify(config: ChatConfig): DifyClient;
  direct(config: ChatConfig): DirectClient;
  session: GatewaySessionResolver;
  org(session: GatewaySession): ChatOrgRepo;
  credits(): ChatCredits;
  conversations(): ChatConversations;
  rateLimit: RateLimitStore;
  now(): number;
  nonce?: () => string;
  newId?: () => string;
}

export const CHAT_MAX_BODY = 8 * 1024;
/** 사용자 20회/60초(04_API.md `/api/ai/chat` 오류 열). */
export const CHAT_RATE = { limit: 20, windowS: 60 } as const;
const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type ChatOnlyCode = "AI_UNAVAILABLE" | "chat_request_done";

export const CHAT_ERRORS: Readonly<Record<ChatOnlyCode, { status: number; message: string }>> = {
  AI_UNAVAILABLE: { status: 503, message: "지금은 법규 질의에 답할 수 없습니다. 크레딧은 차감되지 않았습니다." },
  chat_request_done: { status: 409, message: "이미 처리한 요청입니다. 다시 질문해 주세요." },
};

class ChatReject extends Error {
  readonly code: ChatOnlyCode;
  constructor(code: ChatOnlyCode) {
    super(code);
    this.name = "ChatReject";
    this.code = code;
  }
}

function chatReject(code: ChatOnlyCode): Response {
  const spec = CHAT_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const chatRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    conversation_id: z.string().regex(UUID_RE).optional(),
    message: z.string().max(2000).refine((s) => s.trim().length > 0),
  })
  .strict();

function dbCode(error: unknown): string | undefined {
  const raw = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof raw === "string" ? raw : undefined;
}

/** 한국 시간 오늘 0시(UTC ISO). */
export function kstDayStartIso(nowMs: number): string {
  const kst = nowMs + KST_OFFSET_MS;
  const dayStart = kst - (((kst % 86_400_000) + 86_400_000) % 86_400_000);
  return new Date(dayStart - KST_OFFSET_MS).toISOString();
}

/**
 * 선차감 + 새 원장인지 확인. 이번 호출이 만든 원장(nonce 일치)이고 조직·행위자·금액·대화가 이번 요청과 같을 때만 통과.
 * 그 밖(재전송·환불된 원장 재사용·다른 사용자·다른 대화)은 상류 호출 전에 409(추가 차감 없음).
 */
async function reserveFresh(credits: ChatCredits, deps: ChatDeps, input: Omit<ChatReserveInput, "nonce">): Promise<number> {
  const nonce = (deps.nonce ?? randomUUID)();
  let got: ChatLedger;
  try {
    got = await credits.reserve({ ...input, nonce });
  } catch (error) {
    if (dbCode(error) === "CR001") throw new GatewayError("CR001", { required: input.amount });
    throw error;
  }
  const fresh =
    got.nonce === nonce &&
    got.orgId === input.orgId &&
    got.actorId === input.actorId &&
    got.amount === input.amount &&
    got.conversationId === input.conversationId;
  if (!fresh) throw new ChatReject("chat_request_done");
  return got.ledgerId;
}

async function checkDailyLimit(deps: ChatDeps, session: GatewaySession): Promise<void> {
  const features = await deps.org(session).orgFeatures(session.orgId);
  // 04_API.md 2.1절 `ai_chat`(폴백 false). seed에 키가 아직 없어 명시적 false만 막는다(키 도입은 DB 작업).
  if (features.ai_chat === false) throw new GatewayError("feature_unavailable", { can_download: true });
  const limit = features.ai_chat_turns_per_day;
  // 0·없음·이상한 값 = 상한 0(라이선스 폴백 상태 포함): 차감 없이 429.
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0) throw new GatewayError("AI_DAILY_LIMIT", { limit: 0 });
  const used = await deps.credits().turnsSince(session.orgId, kstDayStartIso(deps.now()));
  if (used >= limit) throw new GatewayError("AI_DAILY_LIMIT", { limit });
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseResponse(input: { answer: ChatAnswer; conversationId: string; requestId: string; credits: number; fallback: boolean }): Response {
  const citations: Citation[] = input.answer.citations;
  let body = sseEvent("delta", { text: input.answer.answer });
  body += sseEvent("citations", { citations });
  if (input.answer.noSource) body += sseEvent("no_source", { message: input.answer.answer });
  body += sseEvent("done", { conversation_id: input.conversationId, request_id: input.requestId, credits: input.credits, fallback: input.fallback });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

interface Answered {
  answer: ChatAnswer;
  route: ChatRoute;
  difyConversationId: string | null;
}

async function askUpstream(deps: ChatDeps, config: ChatConfig, session: GatewaySession, conv: ChatConversation, query: string): Promise<Answered> {
  try {
    const r = await deps.dify(config).ask({ query, platformConversationId: conv.id, difyUser: conv.difyUser, difyConversationId: conv.difyConversationId });
    return { answer: r, route: "dify", difyConversationId: r.difyConversationId };
  } catch (error) {
    // 런타임 장애만 여기로 온다(설정 누락은 앞에서 503). 운영 알림 대상(04_API.md 12장 Dify 행). 사유 코드만.
    const reason = error instanceof Error && "reason" in error && typeof error.reason === "string" ? error.reason : "unknown";
    logger.error("ai_chat.dify_unavailable", { route: "ai_chat", reason: /^[a-z0-9_]{1,40}$/.test(reason) ? reason : "unknown", alert: true });
  }
  const answer = await deps.direct(config).ask({ query, platformConversationId: conv.id, orgId: session.orgId, userId: session.userId });
  return { answer, route: "direct", difyConversationId: null };
}

function logReject(code: string): void {
  logger.warn("ai_chat.rejected", { route: "ai_chat", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  try {
    const config = deps.config();
    if (!config) throw new ChatReject("AI_UNAVAILABLE");

    const session = await deps.session.resolve(req);
    const hit = await deps.rateLimit.hit(`arch:ai_chat:${session.userId}`, CHAT_RATE.limit, CHAT_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const parsed = chatRequestSchema.safeParse(await readJsonLimited(req, CHAT_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    await checkDailyLimit(deps, session);

    const conversations = deps.conversations();
    let conv: ChatConversation;
    let isNew = false;
    if (input.conversation_id) {
      const found = await conversations.get(session, input.conversation_id);
      if (!found) throw new GatewayError("not_found");
      conv = found;
    } else {
      conv = { id: (deps.newId ?? randomUUID)(), difyUser: difyUserOf(config.hmacSecret, session.orgId, session.userId), difyConversationId: null };
      isNew = true;
    }

    const credits = deps.credits();
    const ledgerId = await reserveFresh(credits, deps, {
      orgId: session.orgId,
      actorId: session.userId,
      requestId: input.request_id,
      conversationId: conv.id,
      amount: CHAT_TURN_COST,
    });
    const refund = (reason: string) =>
      credits.refund({ ledgerId, orgId: session.orgId, requestId: input.request_id, amount: CHAT_TURN_COST, reason });

    let answered: Answered;
    try {
      if (isNew) await conversations.create({ id: conv.id, orgId: session.orgId, userId: session.userId, difyUser: conv.difyUser });
      answered = await askUpstream(deps, config, session, conv, input.message);
    } catch {
      await refund("chat_failed");
      throw new ChatReject("AI_UNAVAILABLE");
    }

    if (answered.difyConversationId && !conv.difyConversationId) {
      try {
        await conversations.setDifyConversation({ id: conv.id, orgId: session.orgId, difyConversationId: answered.difyConversationId });
      } catch {
        logger.warn("ai_chat.dify_conversation_not_saved", { route: "ai_chat" });
      }
    }

    const charged = chatChargeFor(answered.route, answered.answer.noSource);
    if (charged === 0) await refund(answered.answer.noSource ? "chat_no_source" : "chat_fallback");
    logger.info("ai_chat.done", { route: "ai_chat", upstream: answered.route, no_source: answered.answer.noSource, credits: charged });
    return sseResponse({ answer: answered.answer, conversationId: conv.id, requestId: input.request_id, credits: charged, fallback: answered.route === "direct" });
  } catch (error) {
    if (error instanceof ChatReject) {
      logReject(error.code);
      return chatReject(error.code);
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
