// 제안서 실제 배선(서버 전용). 스위치 ARCH_AI_PROPOSAL_ENABLED·ARCH_PROPOSAL_PROVIDER·ARCH_PROPOSAL_NARRATIVE_ROUTE·NODE_ENV는
// serverEnv 스키마(소유 밖)에 아직 없어 process.env에서 직접 읽는다(render와 같음).
import "server-only";
import { randomUUID } from "node:crypto";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../gateway/user-client.ts";
import { runStarter } from "../gateway/deps.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { isNarrativeCrossBorder, isProposalEnabled } from "./config.ts";
import type { ProposalDeps } from "./service.ts";
import { supabaseRenderOrg } from "../render/supabase-repo.ts";
import { supabaseProposalStore } from "./supabase-repo.ts";

let deps: ProposalDeps | undefined;

export function proposalDeps(): ProposalDeps {
  if (deps) return deps;
  deps = {
    enabled: () => isProposalEnabled(process.env),
    narrativeCrossBorder: () => isNarrativeCrossBorder(process.env),
    session: gatewaySessionResolver(),
    org: (session) => supabaseRenderOrg(userClient(session.accessToken), gatewaySchemas()),
    store: () => supabaseProposalStore(createSupabaseServiceClient()),
    starter: runStarter,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
    randomUUID: () => randomUUID(),
  };
  return deps;
}
