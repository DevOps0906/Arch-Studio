// 클라우드 사본 API 실제 배선(서버 전용). 저장소 = 사용자 JWT(RLS) + arch.save_cloud_project(2402_cloud_projects.sql),
// 업로드 객체 재검사·이전 객체 삭제 = service_role Storage(arch-user). web_edit 재검사는 AR-06-074가 webEdit으로 주입한다.
import "server-only";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { uploadDeps } from "../uploads/deps.ts";
import { handleUploadSign } from "../uploads/service.ts";
import type { CloudBlobDeps } from "./blob.ts";
import type { CloudDeps } from "./service.ts";
import { supabaseCloudBlobRepo, supabaseCloudRepo, supabaseSnapshotInspector, supabaseSnapshotReader } from "./supabase-repo.ts";

let deps: CloudDeps | undefined;

export function cloudDeps(): CloudDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    repo: (session) => supabaseCloudRepo(userClient(session.accessToken), gatewaySchemas()),
    snapshots: () => supabaseSnapshotInspector(createSupabaseServiceClient()),
    signUpload: (req) => handleUploadSign(req, uploadDeps()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}

let blobDeps: CloudBlobDeps | undefined;

/** GET /api/cloud-projects/{id}/blob(AR-06-072). 레이트 리밋 저장소는 클라우드 API와 같은 것을 쓴다. */
export function cloudBlobDeps(): CloudBlobDeps {
  if (blobDeps) return blobDeps;
  const base = cloudDeps();
  blobDeps = {
    session: base.session,
    repo: (session) => supabaseCloudBlobRepo(userClient(session.accessToken), gatewaySchemas()),
    reader: () => supabaseSnapshotReader(createSupabaseServiceClient()),
    rateLimit: base.rateLimit,
    now: base.now,
  };
  return blobDeps;
}
