// 음성 STT Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유):
//  1) VoiceCredits: core.consume_credits·refund_credits는 EXECUTE가 service_role에만 있다(04_API.md 1장: STT는 Route Handler가 직접 차감).
//     환불 합 조회(credit_ledger.refund_of)는 같은 원장 1건의 읽기 전용 SELECT.
//  2) ConsultAudioStore: voice-audio 버킷 쓰기·읽기에 사용자 정책이 없다(작업 주인 읽기만). 경로는 service.ts가 모양 검사한 값만.
//  3) ConsultQueue: core.voice_jobs INSERT(사용자 쓰기 정책 없음) + core.enqueue_job(service_role 전용).
// 기능 판정은 사용자 JWT(RLS). DB 오류는 SQLSTATE만 남긴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../ai/gateway/supabase-repo.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import { voiceIdempotencyKey, voiceSettleKey } from "./billing.ts";
import type { ConsultAudioStore, ConsultQueue, VoiceCredits, VoiceOrgRepo } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const APP_ID = "arch";
const VOICE_BUCKET = "voice-audio";
/** 상담 녹음 원본 보관 시간(04_API.md 4.5절 "처리 후 24시간 안에 삭제"). 삭제는 core.expire_voice_audio 크론. */
const CONSULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const raw = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

export function supabaseVoiceCredits(service: Client, schemas: SchemaNames): VoiceCredits {
  return {
    async reserve({ orgId, actorId, requestId, amount, mode, nonce }) {
      const { data, error } = await service.schema(schemas.core).rpc("consume_credits", {
        p_org_id: orgId,
        p_amount: amount,
        p_app_id: APP_ID,
        p_reason: "stt",
        p_ref_type: "voice",
        p_ref_id: requestId,
        p_idempotency_key: voiceIdempotencyKey(orgId, requestId),
        // nonce: 새로 삽입했는지 판별용(기존 원장이 돌아오면 그 행의 이전 nonce가 남아 있다).
        p_metadata: { mode, nonce },
        p_actor_id: actorId,
      });
      if (error) throw new DbCodeError(error);
      const row = (Array.isArray(data) ? data[0] : data) as { ledger_id?: unknown } | null;
      const ledgerId = row?.ledger_id;
      if (typeof ledgerId !== "number" || !Number.isSafeInteger(ledgerId)) throw new Error("consume_credits without ledger_id");
      // 돌려받은 원장 행 다시 읽기(읽기 전용 1행). 칸을 못 읽으면 null → 서비스가 불일치(409)로 본다.
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
        mode: typeof meta["mode"] === "string" ? meta["mode"] : null,
        nonce: typeof meta["nonce"] === "string" ? meta["nonce"] : null,
      };
    },
    async refund({ ledgerId, orgId, requestId, amount, reason }) {
      const { error } = await service.schema(schemas.core).rpc("refund_credits", {
        p_consume_ledger_id: ledgerId,
        p_reason: reason,
        p_amount: amount,
        p_idempotency_key: voiceSettleKey(orgId, requestId),
        p_actor_id: null,
      });
      if (error) throw new DbCodeError(error);
    },
  };
}

export function supabaseConsultAudio(service: Client): ConsultAudioStore {
  return {
    async size(path) {
      const { data, error } = await service.storage.from(VOICE_BUCKET).info(path);
      if (error) {
        const status = statusOf(error);
        if (status === 400 || status === 404) return null;
        throw new Error("storage info failed");
      }
      const size = (data as { size?: unknown } | null)?.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error("storage info without size");
      return size;
    },
    async head(path, n) {
      // 크기 검사(≤50MB)를 통과한 뒤에만 부른다.
      const { data, error } = await service.storage.from(VOICE_BUCKET).download(path);
      if (error || !data) throw new Error("storage download failed");
      return new Uint8Array(await data.slice(0, n).arrayBuffer());
    },
  };
}

export function supabaseConsultQueue(service: Client, schemas: SchemaNames): ConsultQueue {
  return {
    async enqueue(i) {
      const nowMs = Date.now();
      // voice_jobs.id = request_id: 재전송은 같은 행(무시). store_audio=true는 동의 기록이 있어야 DB가 받는다(voice_jobs_consent_check).
      const vj = await service
        .schema(schemas.core)
        .from("voice_jobs")
        .upsert(
          {
            id: i.requestId,
            org_id: i.orgId,
            app_id: APP_ID,
            user_id: i.actorId,
            feature: "consult_recording",
            kind: "stt",
            provider_id: "oss-voice",
            status: "queued",
            store_audio: true,
            consent_at: new Date(nowMs).toISOString(),
            consent_kind: "third_party_notice",
            notice_version: i.noticeVersion,
            storage_path: i.audioPath,
            expires_at: new Date(nowMs + CONSULT_RETENTION_MS).toISOString(),
            credits: i.credits,
            credit_ledger_id: i.ledgerId,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );
      if (vj.error) throw new DbCodeError(vj.error);
      const { data, error } = await service.schema(schemas.core).rpc("enqueue_job", {
        p_org_id: i.orgId,
        p_app_id: APP_ID,
        p_queue: "arch.stt",
        p_job_type: "arch.stt",
        // 04_API.md 4장 arch.stt payload: id·경로·열거값만(전사문·비밀 없음).
        p_payload: {
          voice_ref: i.requestId,
          audio_path: i.audioPath,
          notice_version: i.noticeVersion,
          language: "ko",
          declared_duration_s: i.declaredSeconds,
        },
        p_max_attempts: 2, // 대체 없이 1회 재시도(02_ARCHITECTURE.md 4장 arch.stt 행)
        p_credit_ledger_id: i.ledgerId,
        p_idempotency_key: `job:arch:${voiceIdempotencyKey(i.orgId, i.requestId)}`,
        p_created_by: i.actorId,
        p_refund_on_failure: true,
      });
      if (error) throw new DbCodeError(error);
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== "string") throw new Error("enqueue_job without id");
      return { jobId: id };
    },
  };
}

export function supabaseVoiceOrg(user: Client, schemas: SchemaNames): VoiceOrgRepo {
  return {
    async orgFeatures(orgId) {
      const { data, error } = await user.schema(schemas.arch).rpc("org_features", { p_org: orgId });
      if (error) throw new DbCodeError(error);
      return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    },
  };
}
