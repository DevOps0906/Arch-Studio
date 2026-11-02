// 받아쓰기 원장 포트의 Supabase 구현(service_role). 이유: core.consume_credits·refund_credits는 service_role 전용이다.
// 04_API.md:14의 STT 예외: start_ai_run 밖에서 동기 차감하는 유일한 경로. DB 오류는 SQLSTATE만 남긴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../ai/gateway/supabase-repo.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { VoiceLedger } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

function firstLedgerId(data: unknown): string {
  const row = Array.isArray(data) ? data[0] : data;
  const id = row !== null && typeof row === "object" ? (row as { ledger_id?: unknown }).ledger_id : undefined;
  if ((typeof id !== "number" && typeof id !== "string") || String(id) === "") throw new DbCodeError(null);
  return String(id);
}

export function supabaseVoiceLedger(service: Client, schemas: SchemaNames): VoiceLedger {
  return {
    async exists(key) {
      const { count, error } = await service.schema(schemas.core).from("credit_ledger").select("id", { count: "exact", head: true }).eq("idempotency_key", key);
      if (error) throw new DbCodeError(error);
      return (count ?? 0) > 0;
    },
    async consume(a) {
      const { data, error } = await service.schema(schemas.core).rpc("consume_credits", {
        p_org_id: a.orgId,
        p_amount: a.amount,
        p_app_id: "arch",
        p_reason: "voice_stt",
        p_ref_type: "voice_stt",
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
