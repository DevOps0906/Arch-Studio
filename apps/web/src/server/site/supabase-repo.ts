// 대지 조회 상한 기록(service_role). 사용 지점은 이 함수 하나: arch.record_site_lookup은 core.is_privileged_session()을 요구하고
// arch.site_lookups에는 사용자 GRANT가 없다(2400_arch.sql 7-6, 1794행). 인자는 세션 org와 HMAC 해시뿐(주소·PNU 원문 없음).
// DB 오류는 SQLSTATE만 남긴다(메시지 원문은 버린다). 클라이언트는 deps.ts가 넘긴다(env 접근은 거기서만).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { SiteLookupRecorder } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

export class SiteDbError extends Error {
  readonly code: string;
  constructor(error: unknown) {
    const raw = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    const code = typeof raw === "string" && /^[0-9A-Z]{5}$/.test(raw) ? raw : "internal";
    super(`db error ${code}`);
    this.name = "SiteDbError";
    this.code = code;
  }
}

export function supabaseSiteRecorder(service: Client, schemas: SchemaNames): SiteLookupRecorder {
  return {
    async record(orgId, pnuHash) {
      const { data, error } = await service.schema(schemas.arch).rpc("record_site_lookup", { p_org: orgId, p_pnu_hash: pnuHash });
      if (error) throw new SiteDbError(error);
      if (typeof data !== "number" || !Number.isSafeInteger(data)) throw new SiteDbError(null);
      return data;
    },
  };
}
