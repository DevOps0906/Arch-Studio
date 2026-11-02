// 클라우드 법규 검토 실제 배선(서버 전용). 스위치·공개키 env(ARCH_AI_REVIEW_ENABLED·ARCH_RULEPACK_PUBKEYS)는
// serverEnv 스키마(소유 밖)에 아직 없어 process.env에서 직접 읽는다. 공개키는 공개 값이다(개인키는 웹 서버에 없다).
import "server-only";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { supabaseReleasePrivilegedRepo, supabaseReleaseUserRepo } from "../../rule-packs/supabase-repo.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { runStarter } from "../gateway/deps.ts";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../gateway/user-client.ts";
import { isReviewEnabled } from "./config.ts";
import type { ReviewDeps } from "./service.ts";

let deps: ReviewDeps | undefined;

export function reviewDeps(): ReviewDeps {
  if (deps) return deps;
  deps = {
    enabled: () => isReviewEnabled(process.env),
    session: gatewaySessionResolver(),
    userRepo: (session) => supabaseReleaseUserRepo(userClient(session.accessToken), gatewaySchemas()),
    privilegedRepo: () => supabaseReleasePrivilegedRepo(createSupabaseServiceClient(), gatewaySchemas()),
    pubKeys: () => process.env["ARCH_RULEPACK_PUBKEYS"],
    starter: runStarter,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
