// 클라우드 검토 실제 배선(서버 전용). 스위치 ARCH_AI_REVIEW_ENABLED·ARCH_AI_API_URL은 serverEnv 스키마(소유 밖)에 아직 없어 process.env에서 직접 읽는다.
import "server-only";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../gateway/user-client.ts";
import { runStarter } from "../gateway/deps.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { isReviewEnabled } from "./config.ts";
import type { ReviewDeps, RulePackSource } from "./service.ts";
import { supabaseReviewOrg, supabaseRulePackSource } from "./supabase-repo.ts";

let deps: ReviewDeps | undefined;
let packs: RulePackSource | undefined;

export function reviewDeps(): ReviewDeps {
  if (deps) return deps;
  deps = {
    enabled: () => isReviewEnabled(process.env),
    session: gatewaySessionResolver(),
    org: (session) => supabaseReviewOrg(userClient(session.accessToken), gatewaySchemas()),
    packs: () => (packs ??= supabaseRulePackSource(createSupabaseServiceClient(), gatewaySchemas())),
    starter: runStarter,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
