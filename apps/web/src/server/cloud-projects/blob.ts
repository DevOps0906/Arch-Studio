// GET /api/cloud-projects/{project_uuid}/blob (04_API.md 2.1절, 작업 AR-06-072): 클라우드 사본 스냅숏의 서명 다운로드 URL.
// 조직 구성원(member+)이면 entitled=false여도 허용(1장 402 예외: 만료·미배정·회수 후 열람·내려받기). 같은 조직 행만(RLS + 서버 대조),
// 다른 조직·없는 행·경로 불일치는 모두 404(존재 여부를 드러내지 않음). 응답 = { url(https, 10분), org_id, version, bytes, sha256: null }.
// sha256은 DB에 열이 없어 null(객체를 읽어 해시하지 않는다. 저장 때 sha256 열 추가는 tasks/README.md 발견한 문제). 클라이언트는 길이와
// 스냅숏 내부 sha 자기 일관성으로 검증한다. 행은 있는데 Storage 객체가 없으면(동시 저장 중 이전 객체 삭제) 503 재시도 가능.
// org_id는 클라이언트 읽기 캐시 범위 키(세션 조직 그대로, 다른 조직 값 아님). 보존 기한 404는 AR-06-074(retention) 몫.
// 로그: 경로·서명 URL·이름 0(log.ts 허용 목록). server-only를 import하지 않는다(node --test 대상).
import { UUID_RE } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { CloudApiError, cloudOk, codeOf, toCloudResponse } from "./errors.ts";
import { cloudLog } from "./log.ts";
import { isOwnSnapshotPath, SNAPSHOT_MAX_BYTES } from "./service.ts";

export interface CloudBlobRow {
  org_id: string;
  version: number;
  storage_path: string;
}

/** 사용자 JWT 저장소(RLS: 조직 구성원 SELECT, 엔타이틀먼트 무관). (org, project_uuid) 1행. */
export interface CloudBlobRepo {
  findSnapshot(orgId: string, projectUuid: string): Promise<CloudBlobRow | null>;
}

/** service_role Storage(arch-user). stat = 객체 크기(메타데이터만, 없으면 null), signDownload = 서명 다운로드 URL. */
export interface SnapshotReader {
  stat(path: string): Promise<{ bytes: number } | null>;
  signDownload(path: string, ttlS: number): Promise<string>;
}

export interface CloudBlobDeps {
  session: GatewaySessionResolver;
  repo(session: GatewaySession): CloudBlobRepo;
  reader(): SnapshotReader;
  rateLimit: RateLimitStore;
  now(): number;
}

/** 목록과 같은 창(조직당 120회/분). 내려받기는 Storage 읽기를 동반하므로 따로 센다. */
export const BLOB_RATE = { limit: 120, windowS: 60 } as const;
/** 서명 다운로드 URL 수명(04_API "서명 10분"). */
export const BLOB_URL_TTL_S = 600;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

export async function handleGetCloudBlob(req: Request, id: string, deps: CloudBlobDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    if (!UUID_RE.test(id)) throw new CloudApiError("invalid_input");
    if ([...new URL(req.url).searchParams.keys()].length > 0) throw new CloudApiError("invalid_input");
    const hit = await deps.rateLimit.hit(`arch:cloud_projects_blob:${session.orgId}`, BLOB_RATE.limit, BLOB_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new CloudApiError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new CloudApiError("42501");
    // entitled=false는 거절하지 않는다(데이터 회수 경로).

    let row: CloudBlobRow | null;
    try {
      row = await deps.repo(session).findSnapshot(session.orgId, id);
    } catch {
      throw new CloudApiError("internal");
    }
    if (!row) throw new CloudApiError("not_found");
    if (row.org_id !== session.orgId || !isOwnSnapshotPath(session.orgId, id, row.storage_path)) {
      cloudLog.warn("cloud_projects.blob_row_dropped", { route: "cloud_projects_blob", project_uuid: id, reason: "org_or_path" });
      throw new CloudApiError("not_found");
    }
    if (!Number.isSafeInteger(row.version) || row.version < 1) throw new CloudApiError("internal");

    let stat: { bytes: number } | null;
    let url: string;
    try {
      stat = await deps.reader().stat(row.storage_path);
      // 행은 있는데 객체가 없음 = 동시 저장이 이전 객체를 지운 직후. 행 기준 최신을 다시 읽으면 되므로 재시도 가능 503.
      if (!stat) throw new CloudApiError("storage_unavailable", { retryable: true }, { "retry-after": "1" });
      url = await deps.reader().signDownload(row.storage_path, BLOB_URL_TTL_S);
    } catch (e) {
      if (e instanceof CloudApiError) throw e;
      throw new CloudApiError("storage_unavailable");
    }
    if (!Number.isSafeInteger(stat.bytes) || stat.bytes <= 0 || stat.bytes > SNAPSHOT_MAX_BYTES) throw new CloudApiError("internal");
    if (typeof url !== "string" || !url.startsWith("https://")) throw new CloudApiError("internal");

    cloudLog.info("cloud_projects.blob", { route: "cloud_projects_blob", project_uuid: id, version: row.version });
    return cloudOk({ url, org_id: session.orgId, version: row.version, bytes: stat.bytes, sha256: null });
  } catch (error) {
    cloudLog.warn("cloud_projects.blob_rejected", { route: "cloud_projects_blob", code: codeOf(error) });
    return toCloudResponse(error);
  }
}
