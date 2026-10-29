// 표제란 설정 실제 배선(서버 전용).
import "server-only";
import { randomUUID } from "node:crypto";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { DraftingProfileDeps } from "./service.ts";
import { supabaseDraftingProfileRepo, supabaseLogoStorage } from "./supabase-repo.ts";

let deps: DraftingProfileDeps | undefined;

export function draftingProfileDeps(): DraftingProfileDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    repo: (session) => supabaseDraftingProfileRepo(userClient(session.accessToken), gatewaySchemas()),
    logos: () => supabaseLogoStorage(createSupabaseServiceClient()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
    randomUUID: () => randomUUID(),
  };
  return deps;
}
