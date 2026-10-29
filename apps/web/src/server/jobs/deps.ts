// 잡 조회 실제 배선(서버 전용).
import "server-only";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { JobsDeps } from "./service.ts";
import { supabaseDownloadSigner, supabaseJobsRepo } from "./supabase-repo.ts";

let deps: JobsDeps | undefined;

export function jobsDeps(): JobsDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    repo: (session) => supabaseJobsRepo(userClient(session.accessToken), gatewaySchemas()),
    downloads: () => supabaseDownloadSigner(createSupabaseServiceClient()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
