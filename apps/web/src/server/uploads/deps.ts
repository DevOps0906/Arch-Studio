// 업로드 서명 실제 배선(서버 전용).
import "server-only";
import { randomUUID } from "node:crypto";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { UploadDeps } from "./service.ts";
import { supabaseUploadFeatures, supabaseUploadSigner } from "./supabase-storage.ts";

let deps: UploadDeps | undefined;

export function uploadDeps(): UploadDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    features: (session) => supabaseUploadFeatures(userClient(session.accessToken), gatewaySchemas()),
    signer: () => supabaseUploadSigner(createSupabaseServiceClient()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
    randomUUID: () => randomUUID(),
  };
  return deps;
}
