// 클라우드 사본 API 실제 배선(서버 전용). 읽기는 사용자 JWT, 저장·삭제 RPC와 Storage는 service_role(supabase-repo.ts 머리 참고).
import "server-only";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { uploadDeps } from "../uploads/deps.ts";
import { handleUploadSign } from "../uploads/service.ts";
import type { CloudDeps } from "./service.ts";
import { supabaseCloudProjectRepo, supabaseSnapshotInspector } from "./supabase-repo.ts";

let deps: CloudDeps | undefined;

export function cloudDeps(): CloudDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    repo: (session) => supabaseCloudProjectRepo(userClient(session.accessToken), createSupabaseServiceClient(), gatewaySchemas()),
    snapshots: () => supabaseSnapshotInspector(createSupabaseServiceClient()),
    signUpload: (req) => handleUploadSign(req, uploadDeps()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
