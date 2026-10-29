// 잡 조회 Supabase 구현. 잡·실행 행은 사용자 JWT(RLS)로만 읽는다(service_role 아님).
// service_role 사용 지점(이유): 결과 내려받기 createSignedUrl 1곳(org-files·exports는 서버 서명 URL로만 제공). 경로는 service.ts가
// 세션 조직 폴더 정규식으로 검사한 값만 들어온다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../ai/gateway/supabase-repo.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { DownloadSigner, JobsRepo, JobView, RunTable, RunView } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const RUN_COLUMNS: Readonly<Record<RunTable, string>> = {
  renders: "id, status, error, output_path, width, height, expires_at, purged_at",
  reviews: "id, status, error, result",
  intake_runs: "id, status, error, result",
  proposals: "id, status, error, pdf_path",
};

export function supabaseJobsRepo(user: Client, schemas: SchemaNames): JobsRepo {
  return {
    async getJob(orgId, jobId) {
      const { data, error } = await user
        .schema(schemas.core)
        .from("jobs")
        .select("id, org_id, app_id, job_type, status, progress, progress_message")
        .eq("id", jobId)
        .eq("org_id", orgId)
        .eq("app_id", "arch")
        .maybeSingle();
      if (error) throw new DbCodeError(error);
      return (data as JobView | null) ?? null;
    },
    async getRunByJob(table, orgId, jobId) {
      const { data, error } = await user
        .schema(schemas.arch)
        .from(table)
        .select(RUN_COLUMNS[table])
        .eq("job_id", jobId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new DbCodeError(error);
      return (data as RunView | null) ?? null;
    },
  };
}

export function supabaseDownloadSigner(service: Client): DownloadSigner {
  return {
    async createSignedUrl(bucket, path, ttlS) {
      const { data, error } = await service.storage.from(bucket).createSignedUrl(path, ttlS);
      if (error || !data?.signedUrl) throw new Error("storage sign failed");
      return data.signedUrl;
    },
  };
}
