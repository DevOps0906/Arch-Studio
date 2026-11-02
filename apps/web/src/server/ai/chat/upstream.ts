// 채팅 상류 2개: Dify `arch-chat`(주 경로)와 FastAPI `/tools/answer-direct`(Dify 장애 시). 04_API.md 6.4절·12장.
// Dify 요청에는 질문·platform_conversation_id·dify_user(HMAC)·dify 대화 id만 넣는다. 토큰·org·사용자 id·프로젝트·주소는 넣지 않는다.
// Dify 앱의 Answer 노드는 `/tools/answer` 응답 본문(JSON 봉투)을 그대로 내보낸다(infra/dify/arch-chat/README.md). 웹은 message 조각을
// 모아 message_end에서 한 번에 파싱하고 출처 규칙을 다시 검사한다(answer.ts). Dify API 필드는 공개 문서 기준이며 설치 버전 확인 전(미확인).
// 장애 판정: 연결 실패·비 2xx·10초 무응답(조각 사이 간격)·error 이벤트·계약 위반 → DifyUnavailable(호출자가 answer-direct로 폴백).
// 오류 원문(URL·키·토큰·본문)은 예외 메시지에 넣지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { toChatAnswer, type ChatAnswer } from "./answer.ts";

export const DIFY_IDLE_TIMEOUT_MS = 10_000;
export const DIFY_TOTAL_TIMEOUT_MS = 60_000;
export const DIRECT_TIMEOUT_MS = 30_000;
const MAX_STREAM_BYTES = 256 * 1024;

type Fetch = typeof globalThis.fetch;

export class UpstreamError extends Error {
  readonly reason: string;
  constructor(upstream: "dify" | "direct", reason: string) {
    super(`${upstream} unavailable: ${reason}`);
    this.name = "UpstreamError";
    this.reason = reason;
  }
}

export interface DifyTurn {
  query: string;
  platformConversationId: string;
  difyUser: string;
  difyConversationId: string | null;
}

export interface DifyResult extends ChatAnswer {
  difyConversationId: string | null;
}

export interface DifyClient {
  ask(turn: DifyTurn): Promise<DifyResult>;
}

export interface DirectTurn {
  query: string;
  platformConversationId: string;
  orgId: string;
  userId: string;
}

export interface DirectClient {
  ask(turn: DirectTurn): Promise<ChatAnswer>;
}

function sseData(block: string): string | null {
  const lines = block.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (lines.length === 0) return null;
  return lines.map((l) => l.slice(5).replace(/^ /, "")).join("\n");
}

const DIFY_CONV_RE = /^[A-Za-z0-9-]{1,64}$/;

export function difyClient(opts: { baseUrl: string; appKey: string; fetch: Fetch; idleMs?: number; totalMs?: number }): DifyClient {
  return {
    async ask(turn) {
      const ctrl = new AbortController();
      const total = setTimeout(() => ctrl.abort(), opts.totalMs ?? DIFY_TOTAL_TIMEOUT_MS);
      let idle = setTimeout(() => ctrl.abort(), opts.idleMs ?? DIFY_IDLE_TIMEOUT_MS);
      const bump = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), opts.idleMs ?? DIFY_IDLE_TIMEOUT_MS);
      };
      try {
        let res: Response;
        try {
          res = await opts.fetch(`${opts.baseUrl}/chat-messages`, {
            method: "POST",
            headers: { authorization: `Bearer ${opts.appKey}`, "content-type": "application/json", accept: "text/event-stream" },
            body: JSON.stringify({
              inputs: { platform_conversation_id: turn.platformConversationId },
              query: turn.query,
              response_mode: "streaming",
              user: turn.difyUser,
              conversation_id: turn.difyConversationId ?? "",
            }),
            signal: ctrl.signal,
          });
        } catch {
          throw new UpstreamError("dify", "network");
        }
        if (!res.ok || !res.body) throw new UpstreamError("dify", `status_${res.status}`);
        bump();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let size = 0;
        let text = "";
        let conv: string | null = null;
        let ended = false;
        try {
          while (!ended) {
            const { done, value } = await reader.read();
            if (done) break;
            bump();
            size += value.byteLength;
            if (size > MAX_STREAM_BYTES) throw new UpstreamError("dify", "too_large");
            buf += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
              const block = buf.slice(0, cut);
              buf = buf.slice(buf.slice(cut).startsWith("\r\n\r\n") ? cut + 4 : cut + 2);
              const data = sseData(block);
              if (data === null) continue;
              let ev: { event?: unknown; answer?: unknown; conversation_id?: unknown };
              try {
                ev = JSON.parse(data) as typeof ev;
              } catch {
                throw new UpstreamError("dify", "bad_event");
              }
              if (typeof ev.conversation_id === "string" && DIFY_CONV_RE.test(ev.conversation_id)) conv = ev.conversation_id;
              if ((ev.event === "message" || ev.event === "agent_message") && typeof ev.answer === "string") text += ev.answer;
              else if (ev.event === "error") throw new UpstreamError("dify", "error_event");
              else if (ev.event === "message_end") ended = true;
            }
          }
        } catch (error) {
          if (error instanceof UpstreamError) throw error;
          throw new UpstreamError("dify", "stream");
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        if (!ended) throw new UpstreamError("dify", "no_end");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new UpstreamError("dify", "bad_answer");
        }
        try {
          return { ...toChatAnswer(raw), difyConversationId: conv };
        } catch {
          throw new UpstreamError("dify", "contract");
        }
      } finally {
        clearTimeout(total);
        clearTimeout(idle);
      }
    },
  };
}

/** FastAPI `/tools/answer-direct`. 토큰은 요청마다 새로(scope chat, conv = 플랫폼 대화 id, jti 1회). */
export function directClient(opts: {
  baseUrl: string;
  issueToken: (turn: DirectTurn) => string;
  fetch: Fetch;
  timeoutMs?: number;
}): DirectClient {
  return {
    async ask(turn) {
      let token: string;
      try {
        token = opts.issueToken(turn);
      } catch {
        throw new UpstreamError("direct", "token");
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DIRECT_TIMEOUT_MS);
      try {
        let res: Response;
        try {
          res = await opts.fetch(`${opts.baseUrl}/tools/answer-direct`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ platform_conversation_id: turn.platformConversationId, query: turn.query }),
            signal: ctrl.signal,
          });
        } catch {
          throw new UpstreamError("direct", "network");
        }
        if (!res.ok) throw new UpstreamError("direct", `status_${res.status}`);
        let raw: unknown;
        try {
          raw = await res.json();
        } catch {
          throw new UpstreamError("direct", "bad_answer");
        }
        try {
          return toChatAnswer(raw);
        } catch {
          throw new UpstreamError("direct", "contract");
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
