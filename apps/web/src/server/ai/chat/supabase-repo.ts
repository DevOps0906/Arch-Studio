// 채팅 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유):
//  1) ChatCredits: core.consume_credits·refund_credits는 EXECUTE가 service_role에만 있다. 돌려받은 원장 1행 다시 읽기,
//     오늘 턴 수(credit_ledger 이 조직·reason 'chat'·consume 건수)는 읽기 전용 SELECT.
//  2) ChatConversations.create·setDifyConversation: core.ai_conversations에 사용자 쓰기 정책이 없다(서버가 만든다, core_lite 4절).
// 대화 조회(get)는 사용자 JWT(RLS: 본인 대화만). DB 오류는 SQLSTATE만 남긴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../gateway/supabase-repo.ts";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import { chatIdempotencyKey, chatRefundKey } from "./billing.ts";
import type { ChatConversations, ChatCredits } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const APP_ID = "arch";
const REASON = "chat";

export function supabaseChatCredits(service: Client, schemas: SchemaNames): ChatCredits {
  return {
    async reserve({ orgId, actorId, requestId, conversationId, amount, nonce }) {
      const { data, error } = await service.schema(schemas.core).rpc("consume_credits", {
        p_org_id: orgId,
        p_amount: amount,
        p_app_id: APP_ID,
        p_reason: REASON,
        p_ref_type: "ai_conversation",
        p_ref_id: conversationId,
        p_idempotency_key: chatIdempotencyKey(orgId, requestId),
        // nonce: 새로 삽입했는지 판별용(기존 원장이 돌아오면 그 행의 이전 nonce가 남아 있다).
        p_metadata: { conversation_id: conversationId, nonce },
        p_actor_id: actorId,
      });
      if (error) throw new DbCodeError(error);
      const row = (Array.isArray(data) ? data[0] : data) as { ledger_id?: unknown } | null;
      const ledgerId = row?.ledger_id;
      if (typeof ledgerId !== "number" || !Number.isSafeInteger(ledgerId)) throw new Error("consume_credits without ledger_id");
      const got = await service
        .schema(schemas.core)
        .from("credit_ledger")
        .select("org_id, actor_id, amount, entry_type, metadata")
        .eq("id", ledgerId)
        .maybeSingle();
      if (got.error) throw new DbCodeError(got.error);
      const r = (got.data ?? {}) as { org_id?: unknown; actor_id?: unknown; amount?: unknown; entry_type?: unknown; metadata?: unknown };
      const meta = r.metadata !== null && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : {};
      return {
        ledgerId,
        orgId: typeof r.org_id === "string" ? r.org_id : null,
        actorId: typeof r.actor_id === "string" ? r.actor_id : null,
        amount: r.entry_type === "consume" && typeof r.amount === "number" ? -r.amount : null,
        conversationId: typeof meta["conversation_id"] === "string" ? meta["conversation_id"] : null,
        nonce: typeof meta["nonce"] === "string" ? meta["nonce"] : null,
      };
    },
    async refund({ ledgerId, orgId, requestId, amount, reason }) {
      const { error } = await service.schema(schemas.core).rpc("refund_credits", {
        p_consume_ledger_id: ledgerId,
        p_reason: reason,
        p_amount: amount,
        p_idempotency_key: chatRefundKey(orgId, requestId),
        p_actor_id: null,
      });
      if (error) throw new DbCodeError(error);
    },
    async turnsSince(orgId, sinceIso) {
      const { count, error } = await service
        .schema(schemas.core)
        .from("credit_ledger")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("app_id", APP_ID)
        .eq("entry_type", "consume")
        .eq("reason", REASON)
        .gte("created_at", sinceIso);
      if (error) throw new DbCodeError(error);
      return count ?? 0;
    },
  };
}

export function supabaseChatConversations(user: (accessToken: string) => Client, service: Client, schemas: SchemaNames): ChatConversations {
  return {
    async get(session, id) {
      const { data, error } = await user(session.accessToken)
        .schema(schemas.core)
        .from("ai_conversations")
        .select("id, org_id, user_id, app_id, dify_user, dify_conversation_id, status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new DbCodeError(error);
      const r = data as Record<string, unknown> | null;
      // RLS가 본인 것만 돌려주지만 조직·사용자·앱·상태를 한 번 더 본다.
      if (!r || r.org_id !== session.orgId || r.user_id !== session.userId || r.app_id !== APP_ID || r.status !== "active") return null;
      if (typeof r.dify_user !== "string") return null;
      return { id, difyUser: r.dify_user, difyConversationId: typeof r.dify_conversation_id === "string" ? r.dify_conversation_id : null };
    },
    async create({ id, orgId, userId, difyUser }) {
      const { error } = await service
        .schema(schemas.core)
        .from("ai_conversations")
        .insert({ id, org_id: orgId, app_id: APP_ID, user_id: userId, dify_user: difyUser, channel: "text" });
      if (error) throw new DbCodeError(error);
    },
    async setDifyConversation({ id, orgId, difyConversationId }) {
      const { error } = await service
        .schema(schemas.core)
        .from("ai_conversations")
        .update({ dify_conversation_id: difyConversationId, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId)
        .is("dify_conversation_id", null);
      if (error) throw new DbCodeError(error);
    },
  };
}
