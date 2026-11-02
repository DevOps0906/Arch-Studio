// 법규 채팅 순수 로직(AR-06-055). 계약: POST /api/ai/chat(04_API.md 2.1절, AR-06-054) — SSE `sentence`… → `sources` → `done`.
// - request_id: 결과를 모르는 실패(연결 끊김·스트림 중단·409 처리 중)는 같은 id로 다시 보낸다 → 서버가 저장 답을 재송출(추가 차감 0).
//   결과가 확정된 실패(환불된 거절·실패, 크레딧 부족 등)는 같은 id가 409가 되므로 새 id로 보낸다.
// - 화면은 서버가 출처 재검사한 문장만 받는다. 출처가 비어 있거나 모르는 출처를 단 문장은 여기서도 버린다(이중 방어).
import { isApiError, type ApiClient, type StreamBodyLike } from "../api-client/index.ts";
import { readSse, type SseEvent } from "./sse.ts";

export const CHAT_PATH = "/api/ai/chat";
/** 1턴 1크레딧(서버 상수 CHAT_TURN_CREDITS, 표시용). 차감액은 서버가 정한다. */
export const CHAT_TURN_COST = 1;
export const CHAT_MAX_MESSAGE = 2000;

export interface ChatSource {
  readonly chunk_id: string;
  readonly title: string;
  readonly article: string;
  readonly effective_from: string;
}
export interface ChatSentenceView {
  readonly index: number;
  readonly text: string;
  readonly sourceIds: readonly string[];
}
export interface ChatDone {
  readonly conversationId: string;
  readonly noSource: boolean;
  /** 이번 턴 실제 차감(0 = 재전송·환불). */
  readonly credits: number;
  readonly refunded?: boolean;
  readonly replay?: boolean;
  readonly message?: string;
}

/** 답변 하나의 화면 상태. 스트림 이벤트를 applyEvent로 쌓는다. */
export interface AnswerState {
  readonly sentences: readonly ChatSentenceView[];
  readonly sources: readonly ChatSource[];
  readonly done: ChatDone | null;
}
export const EMPTY_ANSWER: AnswerState = { sentences: [], sources: [], done: null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/** 이벤트 하나를 반영. 모양이 틀린 이벤트는 무시한다(화면에 그리지 않음). done 뒤 이벤트는 무시. */
export function applyEvent(state: AnswerState, e: SseEvent): AnswerState {
  if (state.done) return state;
  const v = parseJson(e.data);
  if (e.event === "sentence" && isObj(v) && typeof v["index"] === "number" && isStr(v["text"]) && Array.isArray(v["source_ids"])) {
    const ids = v["source_ids"].filter(isStr);
    if (v["text"].trim() === "" || ids.length === 0) return state;
    return { ...state, sentences: [...state.sentences, { index: v["index"], text: v["text"], sourceIds: ids }] };
  }
  if (e.event === "sources" && Array.isArray(v)) {
    const sources = v.filter(
      (s): s is ChatSource => isObj(s) && isStr(s["chunk_id"]) && isStr(s["title"]) && isStr(s["article"]) && isStr(s["effective_from"]),
    );
    return { ...state, sources };
  }
  if (e.event === "done" && isObj(v) && isStr(v["conversation_id"])) {
    const done: ChatDone = {
      conversationId: v["conversation_id"],
      noSource: v["no_source"] === true,
      credits: typeof v["credits"] === "number" && Number.isInteger(v["credits"]) ? v["credits"] : 0,
      ...(typeof v["refunded"] === "boolean" ? { refunded: v["refunded"] } : {}),
      ...(v["replay"] === true ? { replay: true } : {}),
      ...(isStr(v["message"]) ? { message: v["message"] } : {}),
    };
    return { ...state, done };
  }
  return state;
}

/** 화면에 그릴 문장: 알려진 출처가 하나 이상인 문장만, 출처 칩과 함께. sources 이벤트 전에는 칩 없이 글만(스트리밍 중). */
export function visibleSentences(state: AnswerState): Array<{ text: string; sources: ChatSource[] }> {
  const byId = new Map(state.sources.map((s) => [s.chunk_id, s]));
  const complete = state.done !== null || state.sources.length > 0;
  return [...state.sentences]
    .sort((a, b) => a.index - b.index)
    .flatMap((s) => {
      const sources = s.sourceIds.map((id) => byId.get(id)).filter((x): x is ChatSource => x !== undefined);
      if (complete && sources.length === 0) return [];
      return [{ text: s.text, sources }];
    });
}

/** 턴 비용 문구(done 기준). */
export function turnCostText(done: ChatDone): string {
  if (done.replay) return "이전 답변 다시 받기 · 0 크레딧";
  if (done.noSource) return done.refunded === false ? "크레딧 환불 처리 중" : "0 크레딧(근거 없음, 차감 안 함)";
  return `이번 답변 ${done.credits} 크레딧`;
}

/* ---------- 오류 분류 ---------- */
export type ChatFailureKind =
  /** 결과를 모름(연결·스트림 중단): 같은 request_id로 다시 보낸다. */
  | "unknown"
  /** 409 처리 중·완료 안 됨: 같은 id로 다시 확인하거나, 새 요청으로 보낸다. */
  | "replay_conflict"
  /** 이용권 폴백·만료: 잠금 안내. */
  | "locked"
  /** 확정된 실패: 다음 전송은 새 id. */
  | "final";

export class ChatFailure extends Error {
  readonly kind: ChatFailureKind;
  readonly code: string;
  constructor(kind: ChatFailureKind, code: string, message: string) {
    super(message);
    this.name = "ChatFailure";
    this.kind = kind;
    this.code = code;
  }
}

/** 서버 오류 코드 → 문구(03장 5.2절 원칙: 원인 + 다음 행동 + 환불 여부). 서버 문구와 같은 뜻. */
const CHAT_TEXT: Readonly<Record<string, string>> = {
  chat_disabled: "지금은 법규 질의를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다.",
  ai_chat_unavailable: "현재 이용권에서는 법규 질의 채팅을 쓸 수 없습니다. 라이선스 화면에서 상태를 확인하세요.",
  IDEMPOTENT_REPLAY: "이미 처리 중이거나 완료되지 않은 요청입니다. 잠시 뒤 다시 확인하거나 새 요청으로 보내 주세요.",
  chat_rejected: "질문을 처리할 수 없습니다. 내용을 고쳐 다시 보내 주세요. 크레딧은 환불되었습니다.",
  chat_failed: "답변을 만들지 못했습니다. 크레딧은 환불되었습니다.",
  chat_timeout: "답변 시간이 초과되었습니다. 크레딧은 환불되었습니다.",
  AI_DAILY_LIMIT: "오늘 채팅 턴을 모두 썼습니다. 크레딧은 차감되지 않았습니다. 내일 다시 시도하세요.",
  stream_interrupted: "답변을 받는 중 연결이 끊겼습니다. 다시 보내면 같은 요청으로 확인합니다(추가 차감 없음).",
};
const REFUND_PENDING: ReadonlySet<string> = new Set(["chat_rejected", "chat_failed", "chat_timeout"]);
const UNKNOWN_CODES: ReadonlySet<string> = new Set(["network_offline", "queue_expired", "server_error", "invalid_response", "stream_interrupted"]);

export function classifyChatError(error: unknown): ChatFailure {
  if (error instanceof ChatFailure) return error;
  if (!isApiError(error)) return new ChatFailure("unknown", "stream_interrupted", CHAT_TEXT.stream_interrupted!);
  const code = error.code;
  let message = CHAT_TEXT[code] ?? error.userMessage;
  if (REFUND_PENDING.has(code) && error.details?.refunded === false) message = message.replace("환불되었습니다", "환불 처리됩니다");
  if (code === "IDEMPOTENT_REPLAY") return new ChatFailure("replay_conflict", code, message);
  if (code === "ai_chat_unavailable" || code === "entitlement_expired" || code === "entitled_false") return new ChatFailure("locked", code, message);
  if (UNKNOWN_CODES.has(code)) return new ChatFailure("unknown", code, code === "network_offline" ? `${message} 다시 보내면 같은 요청으로 확인합니다.` : message);
  return new ChatFailure("final", code, message);
}

/* ---------- request_id 정책 ---------- */
/** 결과를 모르는 실패(재전송 버튼을 보일 실패)인가. 그 밖의 실패는 같은 id가 409가 되므로 재전송 버튼이 없다. */
export function keepsRequestId(kind: ChatFailureKind | "ok"): boolean {
  return kind === "unknown" || kind === "replay_conflict";
}

/** 턴의 화면 id = 그 턴의 request_id. */
export interface TurnLike {
  readonly id: string;
  readonly question: string;
}

/**
 * 재전송 id: "다시 보내기"·"다시 확인"(same)은 그 턴의 id 그대로(서버가 같은 키로 재송출 → 이중 차감 없음),
 * "새 요청으로 보내기"(fresh)만 새 id. 입력창 전송은 항상 새 id(newId 직접).
 */
export function resendId(turn: TurnLike, mode: "same" | "fresh", newId: () => string): string {
  return mode === "same" ? turn.id : newId();
}

/** 턴 배치: replaceId 턴이 있으면 그 자리를 바꾸고(같은 질문이 두 번 보이지 않게), 없으면 뒤에 붙인다. */
export function placeTurn<T extends TurnLike>(turns: readonly T[], next: T, replaceId: string | null): T[] {
  const i = replaceId === null ? -1 : turns.findIndex((t) => t.id === replaceId);
  if (i < 0) return [...turns.filter((t) => t.id !== next.id), next];
  return turns.flatMap((t, k) => (k === i ? [next] : t.id === next.id ? [] : [t]));
}

/* ---------- 전송 ---------- */
export interface ChatTurnInput {
  readonly requestId: string;
  readonly message: string;
  readonly conversationId: string | null;
}

/** 요청 본문(서버 zod strict: request_id·conversation_id?·message만). */
export function chatBody(input: ChatTurnInput): { request_id: string; message: string; conversation_id?: string } {
  return {
    request_id: input.requestId,
    message: input.message,
    ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
  };
}

/**
 * 한 턴 보내기: fetch POST(stream) → ReadableStream을 읽으며 onUpdate. done 없이 끝나면 stream_interrupted(결과 모름).
 * 오류는 classifyChatError로 분류한 ChatFailure를 던진다.
 */
export async function sendChatTurn(
  api: ApiClient,
  input: ChatTurnInput,
  onUpdate: (state: AnswerState) => void,
  signal?: AbortSignal,
): Promise<AnswerState> {
  let state = EMPTY_ANSWER;
  try {
    const body = await api.request<StreamBodyLike>({
      method: "POST",
      path: CHAT_PATH,
      body: chatBody(input),
      idempotencyKey: input.requestId,
      idempotencyHeader: false,
      stream: true,
      ...(signal ? { signal } : {}),
    });
    await readSse(
      body,
      (e) => {
        const next = applyEvent(state, e);
        if (next !== state) {
          state = next;
          onUpdate(state);
        }
      },
      signal,
    );
  } catch (error) {
    throw classifyChatError(error);
  }
  if (!state.done) throw classifyChatError(new Error("stream_interrupted"));
  return state;
}
