// 규칙 팩·단가표·업데이트 배포 API 실제 배선(서버 전용). 환경 변수는 serverEnv()로만 읽는다.
// 팩 서명 키는 웹 서버에 없다(계획 공격 P3): 서버는 미리 서명된 매니페스트를 대조해 내줄 뿐이다.
// 운영 전 차단(040과 같음): 레이트 리밋·서명 URL 캐시가 인스턴스 메모리. core.rate_limit_hit 또는 Redis로 교체 전 운영 배포 금지.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { bearerSessionResolver, schemaNames } from "../licenses/supabase-repo.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { SignedUrlCache, type DownloadDeps } from "./service.ts";
import { supabaseReleasePrivilegedRepo, supabaseReleaseUserRepo } from "./supabase-repo.ts";

let deps: DownloadDeps | undefined;

export function releaseDeps(): DownloadDeps {
  if (deps) return deps;
  const env = serverEnv();
  const schemas = schemaNames(env.SUPABASE_DB_SCHEMA);
  const userClient = (token: string) =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  deps = {
    session: bearerSessionResolver(userClient, schemas),
    userRepo: (session) => supabaseReleaseUserRepo(userClient(session.accessToken), schemas),
    privilegedRepo: () => supabaseReleasePrivilegedRepo(createSupabaseServiceClient(), schemas),
    rateLimit: new MemoryRateLimitStore(),
    urlCache: new SignedUrlCache(),
    now: () => Date.now(),
  };
  return deps;
}
