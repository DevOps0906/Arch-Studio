// 채팅 원장·대화 저장·플랜 한도의 Supabase 구현(service_role). core.consume_credits·refund_credits는 service_role 전용이다.
// 04_API.md:14 예외와 같은 이유로 start_ai_run 밖에서 턴 단위로 차감한다(허용 목록 = 이 파일, start-run.test.ts). DB 오류는 SQLSTATE만 남긴다.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../gateway/supabase-repo.ts";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import type { ChatAnswer, ChatLedger, ChatSentence, ChatSource, ChatStore } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

function firstLedgerId(data: unknown): string {
  const row = Array.isArray(data) ? data[0] : data;
  const id = row !== null && typeof row === "object" ? (row as { ledger_id?: unknown }).ledger_id : undefined;
  if ((typeof id !== "number" && typeof id !== "string") || String(id) === "") throw new DbCodeError(null);
  return String(id);
}

export function supabaseChatLedger(service: Client, schemas: SchemaNames): ChatLedger {
  const ledger = () => service.schema(schemas.core).from("credit_ledger");
  return {
    async find(key) {
      const { data, error } = await ledger().select("id").eq("idempotency_key", key).maybeSingle();
      if (error) throw new DbCodeError(error);
      return data ? String((data as { id: unknown }).id) : null;
    },
    async countSince(orgId, sinceIso) {
      const count = async (type: "consume" | "refund") => {
        const { count: n, error } = await ledger()
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("entry_type", type)
          .eq("ref_type", "ai_chat")
          .gte("created_at", sinceIso);
        if (error) throw new DbCodeError(error);
        return n ?? 0;
      };
      // 환불 행도 ref_type이 같도록 refund_credits가 원 행을 따른다는 가정: 아니면 환불 건수가 0이라 상한이 안전 쪽(보수적)으로 기운다.
      const [consumed, refunded] = await Promise.all([count("consume"), count("refund")]);
      return Math.max(0, consumed - refunded);
    },
    async consume(a) {
      const { data, error } = await service.schema(schemas.core).rpc("consume_credits", {
        p_org_id: a.orgId,
        p_amount: a.amount,
        p_app_id: "arch",
        p_reason: "ai_chat",
        p_ref_type: "ai_chat",
        p_ref_id: a.requestId,
        p_idempotency_key: a.key,
        p_actor_id: a.actorId,
      });
      if (error) throw new DbCodeError(error);
      return firstLedgerId(data);
    },
    async refund(a) {
      const { error } = await service.schema(schemas.core).rpc("refund_credits", {
        p_consume_ledger_id: Number(a.ledgerId),
        p_reason: a.reason,
        p_amount: null,
        p_idempotency_key: a.key,
        p_actor_id: a.actorId,
      });
      if (error) throw new DbCodeError(error);
    },
  };
}

/** 플랜 features.ai_chat_turns_per_day. 이용권·플랜·값이 없으면 0(폴백, 실패 닫힘). DB 오류는 throw. */
export function supabaseChatTurnsPerDay(service: Client, schemas: SchemaNames): (orgId: string) => Promise<number> {
  return async (orgId) => {
    const core = service.schema(schemas.core);
    const { data: code, error: e1 } = await core.rpc("entitled_plan_code", { org: orgId, app: "arch" });
    if (e1) throw new DbCodeError(e1);
    if (typeof code !== "string" || code === "") return 0;
    const { data, error: e2 } = await core.from("plans").select("features").eq("app_id", "arch").eq("code", code).maybeSingle();
    if (e2) throw new DbCodeError(e2);
    const n = (data as { features?: { ai_chat_turns_per_day?: unknown } } | null)?.features?.ai_chat_turns_per_day;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
  };
}

interface SentencesCitation {
  type: "sentences";
  items: ChatSentence[];
}
interface ChunkCitation extends ChatSource {
  type: "chunk";
  id: string;
}

function parseCitations(value: unknown): ChatAnswer | null {
  if (!Array.isArray(value)) return null;
  const sentences = value.find((c): c is SentencesCitation => c?.type === "sentences" && Array.isArray(c.items));
  if (!sentences) return null;
  const sources: ChatSource[] = value
    .filter((c): c is ChunkCitation => c?.type === "chunk" && typeof c.id === "string")
    .map((c) => ({ chunk_id: c.id, title: String(c.title ?? ""), article: String(c.article ?? ""), effective_from: String(c.effective_from ?? "") }));
  return { sentences: sentences.items, sources };
}

export function supabaseChatStore(service: Client, schemas: SchemaNames): ChatStore {
  const core = () => service.schema(schemas.core);
  return {
    async ownsConversation(orgId, userId, conversationId) {
      const { data, error } = await core().from("ai_conversations").select("id").eq("id", conversationId).eq("org_id", orgId).eq("user_id", userId).eq("app_id", "arch").maybeSingle();
      if (error) throw new DbCodeError(error);
      return data !== null;
    },
    async findAnswer(orgId, ledgerId) {
      const { data, error } = await core()
        .from("ai_messages")
        .select("conversation_id, citations")
        .eq("org_id", orgId)
        .eq("role", "assistant")
        .eq("credit_ledger_id", Number(ledgerId))
        .maybeSingle();
      if (error) throw new DbCodeError(error);
      if (!data) return null;
      const row = data as { conversation_id: string; citations: unknown };
      const answer = parseCitations(row.citations);
      return answer ? { conversationId: row.conversation_id, answer } : null;
    },
    async saveTurn(a) {
      if (a.createConversation) {
        const opaque = createHash("sha256").update(`arch-chat-user:${a.orgId}:${a.userId}`).digest("hex");
        const { error } = await core()
          .from("ai_conversations")
          .upsert(
            { id: a.conversationId, org_id: a.orgId, app_id: "arch", user_id: a.userId, dify_user: opaque, channel: "text", title: a.userMessage.slice(0, 40) },
            { onConflict: "id", ignoreDuplicates: true },
          );
        if (error) throw new DbCodeError(error);
      }
      const citations: (SentencesCitation | ChunkCitation)[] = [
        { type: "sentences", items: a.answer.sentences },
        ...a.answer.sources.map((s): ChunkCitation => ({ type: "chunk", id: s.chunk_id, chunk_id: s.chunk_id, title: s.title, article: s.article, effective_from: s.effective_from })),
      ];
      const { error } = await core()
        .from("ai_messages")
        .insert([
          { conversation_id: a.conversationId, org_id: a.orgId, role: "user", content: a.userMessage },
          {
            conversation_id: a.conversationId,
            org_id: a.orgId,
            role: "assistant",
            content: a.answer.sentences.map((s) => s.text).join(" "),
            citations,
            credits: a.credits,
            credit_ledger_id: Number(a.ledgerId),
          },
        ]);
      if (error) throw new DbCodeError(error);
    },
  };
}
