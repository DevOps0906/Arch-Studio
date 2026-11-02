// 법규 채팅 패널(03장 3.12절). `/chat` 전체 화면과 셸 오른쪽 패널(variant="side")이 같은 컴포넌트를 쓴다.
// 스트리밍(fetch + ReadableStream) 답변, 답변마다 "AI 답변" 표시, 출처 칩(법령명·조항·시행일, 누르면 원문 요약), 턴 비용,
// 권리 ai_chat 잠금(폴백·만료), 상태(빈·로딩·오류·성공). 개별 사안 적법성은 단정하지 않는다(AR-F-009) — 고지 문구.
import { Badge, Banner, Button, Icon, Spinner, cn } from "@arch-studio/ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { DENY_TEXT, EmptyBlock, LockedState, useApi, useEntitlement, useOnline, useSession } from "../shell/index.ts";
import { ReadAloudButton, VoiceDictation } from "../voice/index.ts";
import {
  CHAT_MAX_MESSAGE,
  CHAT_TURN_COST,
  ChatFailure,
  EMPTY_ANSWER,
  classifyChatError,
  keepsRequestId,
  requestIdFor,
  sendChatTurn,
  turnCostText,
  visibleSentences,
  type AnswerState,
  type ChatSource,
} from "./model.ts";

interface Turn {
  readonly id: string;
  readonly question: string;
  answer: AnswerState;
  failure: ChatFailure | null;
  streaming: boolean;
}

const DISCLAIMER = "AI 답변은 법령·조례 근거를 요약한 참고 자료입니다. 개별 사안의 적법성을 판단하지 않습니다.";

function SourceChip({ source }: { source: ChatSource }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="focus-ring inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-sm border border-line bg-raised px-1.5 py-0.5 text-left text-caption text-fg-2 hover:text-fg"
      >
        <Icon name="book-open" className="size-3.5" />
        <span className="font-medium text-fg">{source.title}</span>
        <span>{source.article}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">시행 {source.effective_from}</span>
      </button>
      {open ? (
        <span id={id} className="rounded-sm border border-line bg-surface p-2 text-caption text-fg-2">
          {source.title} {source.article} (시행 {source.effective_from}). 원문은 국가법령정보에서 확인하세요.
        </span>
      ) : null}
    </span>
  );
}

function AnswerView({ answer, streaming }: { answer: AnswerState; streaming: boolean }) {
  const sentences = visibleSentences(answer);
  const text = sentences.map((s) => s.text).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge icon="sparkles">AI 답변</Badge>
        {answer.done && text ? <ReadAloudButton text={text} /> : null}
      </div>
      {sentences.length === 0 && streaming ? (
        <p role="status" className="flex items-center gap-2 text-caption text-fg-2">
          <Spinner />
          근거를 찾아 답변을 만드는 중
        </p>
      ) : null}
      {sentences.length > 0 ? (
        <ul className="flex flex-col gap-2 rounded-panel bg-raised px-3 py-2">
          {sentences.map((s, i) => (
            <li key={i} className="flex flex-col gap-1">
              <p className="text-body text-fg">{s.text}</p>
              {s.sources.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {s.sources.map((src) => (
                    <SourceChip key={src.chunk_id} source={src} />
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {answer.done?.noSource ? (
        <p className="flex items-center gap-1 text-caption text-warn">
          <Icon name="triangle-alert" className="size-3.5" />
          {answer.done.message ?? "근거를 찾지 못했습니다. 크레딧은 차감되지 않았습니다."}
        </p>
      ) : null}
      {answer.done ? (
        <p className="flex items-center gap-1 text-caption text-fg-3">
          <Icon name="coins" className="size-3.5" />
          {turnCostText(answer.done)}
        </p>
      ) : null}
    </div>
  );
}

export function ChatPanel({ variant = "page" }: { variant?: "page" | "side" }) {
  const api = useApi();
  const online = useOnline();
  const { state } = useSession();
  const decision = useEntitlement("ai_chat");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  // 결과를 모르는 마지막 시도(같은 질문을 다시 보내면 같은 request_id).
  const pending = useRef<{ message: string; requestId: string } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const inputId = useId();
  const hintId = useId();
  const logRef = useRef<HTMLOListElement>(null);
  const busy = turns.some((t) => t.streaming);
  const balance = state.kind === "ready" ? state.session.credit_balance : null;

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [turns]);

  if (decision && !decision.allowed) {
    return (
      <LockedState
        title="법규 채팅을 쓸 수 없습니다"
        reason={`${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 로컬 판정·도면은 그대로 됩니다. 라이선스 화면에서 상태를 확인하세요.`}
        action={
          <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
            라이선스 보기
          </Link>
        }
      />
    );
  }
  if (locked) {
    return (
      <LockedState
        title="법규 채팅을 쓸 수 없습니다"
        reason={locked}
        action={
          <Link to="/license" className="focus-ring rounded-sm text-body text-info underline">
            라이선스 보기
          </Link>
        }
      />
    );
  }

  const update = (id: string, patch: Partial<Turn>): void => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const send = async (message: string, fresh = false): Promise<void> => {
    const text = message.trim();
    if (!text || busy) return;
    if (fresh) pending.current = null;
    const requestId = requestIdFor(pending.current, text, () => api.newIdempotencyKey());
    pending.current = { message: text, requestId };
    const turnId = requestId;
    setTurns((ts) => [...ts.filter((t) => t.id !== turnId), { id: turnId, question: text, answer: EMPTY_ANSWER, failure: null, streaming: true }]);
    setDraft("");
    const ac = new AbortController();
    ctrl.current = ac;
    try {
      const answer = await sendChatTurn(api, { requestId, message: text, conversationId }, (a) => update(turnId, { answer: a }), ac.signal);
      pending.current = null;
      if (answer.done) setConversationId(answer.done.conversationId);
      update(turnId, { answer, streaming: false });
    } catch (error) {
      if (ac.signal.aborted) return;
      const failure = classifyChatError(error);
      if (!keepsRequestId(failure.kind)) pending.current = null;
      if (failure.kind === "locked") setLocked(failure.message);
      update(turnId, { failure, streaming: false });
    }
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <section aria-label="법규 채팅" className={cn("flex min-h-0 flex-col rounded-panel border border-line bg-surface", variant === "page" && "flex-1")}>
      <p className="flex items-start gap-1.5 border-b border-line p-pad text-caption text-fg-2">
        <Icon name="info" className="mt-0.5 size-3.5 shrink-0" />
        {DISCLAIMER}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto p-pad">
        {turns.length === 0 ? (
          <EmptyBlock icon="inbox" title="대화가 없습니다" description="조문 이름이나 지자체를 넣어 법규를 물어보세요. 답변마다 근거 조항을 함께 보여 줍니다." />
        ) : (
          <ol ref={logRef} role="log" aria-live="polite" aria-busy={busy} className="flex flex-col gap-gap">
            {turns.map((t) => (
              <li key={t.id} className="flex flex-col gap-2">
                <p className="max-w-(--chat-bubble-max) self-end rounded-panel bg-accent px-3 py-2 text-body text-accent-fg">{t.question}</p>
                <div className="max-w-(--chat-bubble-max) self-start">
                  {t.failure ? (
                    <Banner
                      tone={t.failure.kind === "final" ? "danger" : "warn"}
                      title="답변을 받지 못했습니다"
                      action={
                        t.failure.kind === "unknown" || t.failure.kind === "replay_conflict" ? (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" disabled={busy || !online} onClick={() => void send(t.question)}>
                              {t.failure.kind === "unknown" ? "다시 보내기" : "다시 확인"}
                            </Button>
                            {t.failure.kind === "replay_conflict" ? (
                              <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void send(t.question, true)}>
                                새 요청으로 보내기
                              </Button>
                            ) : null}
                          </div>
                        ) : undefined
                      }
                    >
                      {t.failure.message}
                    </Banner>
                  ) : (
                    <AnswerView answer={t.answer} streaming={t.streaming} />
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line p-pad">
        <label htmlFor={inputId} className="sr-only">
          질문
        </label>
        <textarea
          id={inputId}
          value={draft}
          maxLength={CHAT_MAX_MESSAGE}
          rows={variant === "page" ? 3 : 2}
          aria-describedby={hintId}
          placeholder="법규나 판정 결과를 물어보세요"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(draft);
            }
          }}
          className="focus-ring w-full resize-y rounded-control border border-input bg-surface p-3 text-body text-fg"
        />
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <VoiceDictation disabled={busy} onInsert={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} />
          <Button type="submit" variant="primary" icon="send" loading={busy} disabled={!online || draft.trim() === ""}>
            보내기
          </Button>
        </div>
        <p id={hintId} className="flex flex-wrap items-center gap-1 text-caption text-fg-2">
          <Icon name="coins" className="size-3.5" />
          1턴 {CHAT_TURN_COST} 크레딧
          {balance !== null ? <span className="tabular-nums">· 잔액 {balance}</span> : null}
          <span>· 오늘 남은 턴은 서버가 확인합니다(한도에 닿으면 차감 없이 알려 줍니다)</span>
          {!online ? <span className="text-warn">· 오프라인: 연결되면 보낼 수 있습니다</span> : null}
        </p>
      </form>
    </section>
  );
}
