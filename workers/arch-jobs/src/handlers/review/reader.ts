// arch.reviews 읽기(service_role). judgment는 start_ai_run 때 서버가 재계산해 저장한 값이다(데스크톱 판정 아님).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DbError, JobError } from "../../core/errors.ts";

export interface ReviewRow {
  id: string;
  org_id: string;
  status: string;
  application_date: string;
  judgment: Record<string, unknown>;
  /** 요청 시각(ms). 전체 10분의 기준. */
  created_at_ms: number;
}

export interface ReviewReader {
  get(runId: string): Promise<ReviewRow | null>;
}

interface RawRow {
  id: string;
  org_id: string;
  status: string;
  application_date: string;
  judgment: Record<string, unknown>;
  created_at: string;
}

export function supabaseReviewReader(env: Readonly<Record<string, string | undefined>>): ReviewReader {
  let client: SupabaseClient | undefined;
  const get = (): SupabaseClient => {
    const url = env["SUPABASE_URL"];
    const key = env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  };
  return {
    async get(runId) {
      const { data, error } = await get()
        .from("reviews")
        .select("id, org_id, status, application_date, judgment, created_at")
        .eq("id", runId)
        .maybeSingle<RawRow>();
      if (error) {
        if (!error.code && /fetch failed|network|ECONN/i.test(error.message)) {
          throw new JobError("select reviews: network", { retryable: true, code: "network" });
        }
        throw new DbError("select reviews", error.message, error.code ?? "unknown");
      }
      if (!data) return null;
      return {
        id: data.id,
        org_id: data.org_id,
        status: data.status,
        application_date: data.application_date,
        judgment: data.judgment,
        created_at_ms: Date.parse(data.created_at),
      };
    },
  };
}
