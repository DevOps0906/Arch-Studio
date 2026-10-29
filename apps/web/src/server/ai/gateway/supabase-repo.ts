// AI 게이트 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유):
//  1) AiTokenRepo 조회 3개(core.jobs·실행 행·core.org_members): 워커 경로에는 사용자 세션이 없고 잡은 여러 조직에 걸친다.
//     읽기 전용 SELECT만 하며, 결과는 running 잡 1건의 토큰 발급 판단에만 쓴다.
//  2) RunStarter.startAiRun: arch.start_ai_run은 EXECUTE가 service_role에만 있다(차감·enqueue, 2401_arch_fixes.sql:249).
// DB 오류는 SQLSTATE만 남긴다(메시지 원문은 버린다).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import type { AiTokenRepo, JobRow, RunRow, RunTable } from "./ai-token.ts";
import type { RunStarter } from "./start-run.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

/** SQLSTATE만 담은 오류. message에는 코드만. */
export class DbCodeError extends Error {
  readonly code: string;
  constructor(error: unknown) {
    const raw = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    const code = typeof raw === "string" && /^[0-9A-Z]{5}$/.test(raw) ? raw : "internal";
    super(`db error ${code}`);
    this.name = "DbCodeError";
    this.code = code;
  }
}

const RUN_COLUMNS: Readonly<Record<RunTable, string>> = {
  reviews: "id, org_id, status, created_by",
  intake_runs: "id, org_id, status, created_by, source",
  proposals: "id, org_id, status, created_by, variant",
};

export function supabaseAiTokenRepo(service: Client, schemas: SchemaNames): AiTokenRepo {
  return {
    async getJob(jobId) {
      const { data, error } = await service
        .schema(schemas.core)
        .from("jobs")
        .select("id, org_id, app_id, job_type, status, created_by")
        .eq("id", jobId)
        .maybeSingle();
      if (error) throw new DbCodeError(error);
      return (data as JobRow | null) ?? null;
    },
    async getRunByJob(table, jobId) {
      const { data, error } = await service.schema(schemas.arch).from(table).select(RUN_COLUMNS[table]).eq("job_id", jobId).maybeSingle();
      if (error) throw new DbCodeError(error);
      return (data as RunRow | null) ?? null;
    },
    async isActiveMember(orgId, userId) {
      const { count, error } = await service
        .schema(schemas.core)
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("status", "active")
        .in("role", ["owner", "admin", "member"]);
      if (error) throw new DbCodeError(error);
      return (count ?? 0) > 0;
    },
  };
}

export function supabaseRunStarter(service: Client, schemas: SchemaNames): RunStarter {
  return {
    async startAiRun(args) {
      const { data, error } = await service.schema(schemas.arch).rpc("start_ai_run", args);
      if (error) throw new DbCodeError(error);
      return data;
    },
    async runExists(requestId) {
      // 멱등 재전송 판별(로그 분류용 읽기 전용). start_ai_run이 보는 4개 실행 테이블과 같다(2400_arch.sql 1124행 부근).
      const tables = ["renders", "reviews", "intake_runs", "proposals"] as const;
      const counts = await Promise.all(
        tables.map(async (table) => {
          const { count, error } = await service.schema(schemas.arch).from(table).select("id", { count: "exact", head: true }).eq("request_id", requestId);
          if (error) throw new DbCodeError(error);
          return count ?? 0;
        }),
      );
      return counts.some((n) => n > 0);
    },
  };
}
