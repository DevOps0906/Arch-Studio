// 클라우드 사본 API 실제 배선(서버 전용).
// DB 미연결(AR-06-073 후속): 지금 저장소(2400_arch.sql)는 local_id 정본 키 + save_cloud_project(p_local_id, …) 옛 시그니처라
// 04_API 2.1절 계약(project_uuid 정본, local_id nullable, (org_id, project_uuid) 업서트)과 맞지 않는다. 스키마·RPC 교체는 073 소유이므로
// 여기서는 저장소·업로드 재검사 포트를 "미구현"(501 not_implemented)으로 둔다. 073이 supabase 구현을 이 두 자리에 넣는다.
import "server-only";
import { gatewaySessionResolver } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { uploadDeps } from "../uploads/deps.ts";
import { handleUploadSign } from "../uploads/service.ts";
import { CloudApiError } from "./errors.ts";
import type { CloudDeps, CloudProjectRepo, SnapshotInspector } from "./service.ts";

const notConnected = (): never => {
  throw new CloudApiError("not_implemented");
};

/** 073 전 자리표시자: 호출하면 501. 조용히 빈 목록을 돌려주지 않는다(사본이 없다고 오해하지 않게). */
const UNCONNECTED_REPO: CloudProjectRepo = {
  list: async () => notConnected(),
  usage: async () => notConnected(),
  find: async () => notConnected(),
  save: async () => notConnected(),
};
const UNCONNECTED_SNAPSHOTS: SnapshotInspector = { inspect: async () => notConnected() };

let deps: CloudDeps | undefined;

export function cloudDeps(): CloudDeps {
  if (deps) return deps;
  deps = {
    session: gatewaySessionResolver(),
    repo: () => UNCONNECTED_REPO,
    snapshots: () => UNCONNECTED_SNAPSHOTS,
    signUpload: (req) => handleUploadSign(req, uploadDeps()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
