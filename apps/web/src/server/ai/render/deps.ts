// AI 렌더 실제 배선(서버 전용). 스위치 ARCH_AI_RENDER_ENABLED·ARCH_RENDER_PROVIDER·NODE_ENV는 serverEnv 스키마(소유 밖)에 아직 없어 process.env에서 직접 읽는다.
import "server-only";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../gateway/user-client.ts";
import { runStarter } from "../gateway/deps.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { isRenderEnabled } from "./config.ts";
import type { RenderDeps } from "./service.ts";
import { supabaseRenderInputs, supabaseRenderOrg } from "./supabase-repo.ts";

let deps: RenderDeps | undefined;

export function renderDeps(): RenderDeps {
  if (deps) return deps;
  deps = {
    enabled: () => isRenderEnabled(process.env),
    session: gatewaySessionResolver(),
    org: (session) => supabaseRenderOrg(userClient(session.accessToken), gatewaySchemas()),
    inputs: () => supabaseRenderInputs(createSupabaseServiceClient()),
    starter: runStarter,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
