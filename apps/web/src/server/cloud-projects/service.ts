// 클라우드 사본 API 본체(04_API.md 2.1절 `GET|POST /api/cloud-projects`, `POST /api/cloud-projects/{id}/upload-url`, ADR-001 3장).
// 조직은 세션에서만(본문·쿼리에 org_id 없음, strict). DB 접근은 주입한 저장소(CloudProjectRepo)로만: 스키마(project_uuid 정본 키,
// local_id nullable, (org_id, project_uuid) 업서트)와 arch.save_cloud_project 새 시그니처는 2402_cloud_projects.sql(AR-06-073),
// Supabase 구현은 supabase-repo.ts. 업로드 폴더 키는 항상 project_uuid. 저장 성공 뒤 교체된 이전 객체를 지운다(최신 1개 보존, 실패는 로그만).
// 동시성: POST는 expected_version을 그대로 RPC에 넘기고, 불일치는 DB가 AR041로 거절한다(저장 안 됨). 서버는 응답 version이
// expected_version+1이 아니면 성공으로 보지 않는다(조용한 덮어쓰기 방어). 새 사본은 expected_version=0, 조직 상한 초과는 AR040.
// 다른 조직: RLS는 DB 몫이지만 서버도 세션 조직과 행 org_id·업로드 경로 첫 폴더를 대조한다(맞지 않는 행은 버리고 개수만 로그).
// 로그: 이름·경로·커서·본문 0(log.ts 허용 목록). server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { readJsonLimited, UUID_RE } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { isServerUploadPath, PURPOSE_POLICIES } from "../uploads/policy.ts";
import { CloudApiError, CloudDbError, cloudOk, codeOf, toCloudResponse } from "./errors.ts";
import { cloudLog } from "./log.ts";

/** 목록 행(저장소가 돌려주는 모양). org_id는 서버 대조용이고 응답에는 넣지 않는다. */
export interface CloudProjectRow {
  org_id: string;
  project_uuid: string;
  local_id: string | null;
  name: string;
  version: number;
  bytes: number;
  updated_at: string;
}

export interface SaveCloudProjectArgs {
  orgId: string;
  projectUuid: string;
  localId: string | null;
  name: string;
  storagePath: string;
  expectedVersion: number;
}

/**
 * 사용자 JWT 저장소(RLS, supabase-repo.ts): list = SELECT arch.cloud_projects(조직 updated_at desc, 커서),
 * usage = count + cloud_projects_max + retention_until, find = (org, project_uuid) 1행, save = arch.save_cloud_project(...).
 * save의 DB 오류는 CloudDbError(코드: AR031·AR040·AR041·AR044·23505·23514·42501·22023, AR041은 currentVersion, AR040은 max)로 던진다.
 * save의 previous_path = 교체된 이전 객체 경로(새 사본·같은 경로면 null).
 */
export interface CloudProjectRepo {
  list(orgId: string, opts: { cursor: string | null; limit: number }): Promise<{ rows: CloudProjectRow[]; next: string | null }>;
  usage(orgId: string): Promise<{ count: number; max: number; retentionUntil: string | null }>;
  find(orgId: string, projectUuid: string): Promise<{ version: number } | null>;
  save(args: SaveCloudProjectArgs): Promise<{ project_uuid: string; version: number; previous_path?: string | null }>;
}

/** 업로드 객체(service_role Storage). inspect = 재검사(04_API 2.1, 없으면 null), remove = 교체된 이전 객체 삭제. */
export interface SnapshotInspector {
  inspect(path: string): Promise<{ bytes: number } | null>;
  remove(path: string): Promise<void>;
}

export type WebEditDecision = "allowed" | "fallback" | "denied";

export interface CloudDeps {
  session: GatewaySessionResolver;
  repo(session: GatewaySession): CloudProjectRepo;
  snapshots(): SnapshotInspector;
  /** 074 연결 지점(uploads/service.ts와 같은 규칙): rights.web_edit. 주입하지 않으면 entitled만 본다. */
  webEdit?(session: GatewaySession): Promise<WebEditDecision>;
  /** upload-url 별칭: uploads/sign(project_snapshot)으로 넘긴다. */
  signUpload(req: Request): Promise<Response>;
  rateLimit: RateLimitStore;
  now(): number;
}

/** 저장 본문은 메타데이터뿐(blob은 Storage 서명 업로드). 4KB면 이름 120자·경로·uuid를 넉넉히 담는다. */
export const SAVE_MAX_BODY = 4096;
export const UPLOAD_URL_MAX_BODY = 1024;
export const LIST_LIMIT = 50;
/** "그 밖의 생성 API 조직당 60회/분"(04_API.md 1장). 목록은 같은 창에 120회. */
export const SAVE_RATE = { limit: 60, windowS: 60 } as const;
export const LIST_RATE = { limit: 120, windowS: 60 } as const;
export const SNAPSHOT_MAX_BYTES = PURPOSE_POLICIES.project_snapshot.maxBytes;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const uuid = z.string().regex(UUID_RE);
// 제어 문자 금지(목록 한 줄 표시·로그 주입 방지). DB CHECK는 btrim 길이 1..120.
const NAME = z.string().trim().min(1).max(120).refine((s) => !/[\u0000-\u001f\u007f]/.test(s));

export const saveSchema = z
  .object({
    project_uuid: uuid,
    local_id: uuid.optional(),
    name: NAME,
    storage_path: z.string().min(1).max(300),
    expected_version: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();

export const uploadUrlSchema = z
  .object({
    ext: z.literal("arch"),
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;

async function limit(deps: CloudDeps, key: string, rate: { limit: number; windowS: number }) {
  const hit = await deps.rateLimit.hit(key, rate.limit, rate.windowS, deps.now());
  if (!hit.allowed) {
    throw new CloudApiError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
  }
}

/** 쓰기 권리: member+ → entitled(402) → web_edit(074, fallback 사유 구분). */
async function requireWrite(deps: CloudDeps, session: GatewaySession) {
  if (!MEMBER_PLUS.has(session.role)) throw new CloudApiError("42501");
  if (!session.entitled) throw new CloudApiError("entitlement_expired", { can_download: true });
  if (deps.webEdit) {
    const d = await deps.webEdit(session);
    if (d === "fallback") throw new CloudApiError("entitlement_expired", { reason: "fallback", can_download: true });
    if (d !== "allowed") throw new CloudApiError("entitlement_expired", { can_download: true });
  }
}

/** 저장소 호출 감싸기: CloudDbError는 그대로, 그 밖 예외는 internal(원문 버림). */
async function db<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CloudDbError || e instanceof CloudApiError) throw e;
    throw new CloudDbError("internal");
  }
}

function isRow(r: unknown): r is CloudProjectRow {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.org_id === "string" &&
    typeof x.project_uuid === "string" &&
    UUID_RE.test(x.project_uuid) &&
    (x.local_id === null || (typeof x.local_id === "string" && UUID_RE.test(x.local_id))) &&
    typeof x.name === "string" &&
    Number.isSafeInteger(x.version) &&
    (x.version as number) >= 1 &&
    Number.isSafeInteger(x.bytes) &&
    (x.bytes as number) >= 0 &&
    typeof x.updated_at === "string"
  );
}

/** GET /api/cloud-projects. entitled=false여도 허용(04_API 1장 402 예외: 데이터 회수 경로). */
export async function handleListCloudProjects(req: Request, deps: CloudDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    const url = new URL(req.url);
    for (const key of url.searchParams.keys()) if (key !== "cursor") throw new CloudApiError("invalid_input");
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && !CURSOR.test(cursor)) throw new CloudApiError("invalid_input");
    await limit(deps, `arch:cloud_projects_list:${session.orgId}`, LIST_RATE);
    if (!MEMBER_PLUS.has(session.role)) throw new CloudApiError("42501");

    const repo = deps.repo(session);
    const [page, usage] = await Promise.all([db(() => repo.list(session.orgId, { cursor, limit: LIST_LIMIT })), db(() => repo.usage(session.orgId))]);
    const rows = page.rows.slice(0, LIST_LIMIT);
    const mine = rows.filter((r) => isRow(r) && r.org_id === session.orgId);
    if (mine.length !== rows.length) cloudLog.warn("cloud_projects.rows_dropped", { route: "cloud_projects_list", count: rows.length - mine.length, reason: "org_or_shape" });
    const next = page.next !== null && CURSOR.test(page.next) ? page.next : null;
    return cloudOk({
      items: mine.map((r) => ({ project_uuid: r.project_uuid, local_id: r.local_id, name: r.name, version: r.version, bytes: r.bytes, updated_at: r.updated_at })),
      next,
      max: Number.isSafeInteger(usage.max) ? usage.max : null,
      retention_until: typeof usage.retentionUntil === "string" ? usage.retentionUntil : null,
    });
  } catch (error) {
    cloudLog.warn("cloud_projects.list_rejected", { route: "cloud_projects_list", code: codeOf(error) });
    return toCloudResponse(error);
  }
}

/** 업로드 경로의 프로젝트 폴더: 항상 project_uuid(DB 경로 CHECK와 같은 키, upload-url의 project_ref). */
export function snapshotFolder(input: { project_uuid: string }): string {
  return input.project_uuid;
}

/** 경로 검사: 서버 형식(uploads/policy) + 첫 폴더 = 세션 조직 + 프로젝트 폴더 일치. */
export function isOwnSnapshotPath(orgId: string, folder: string, path: string): boolean {
  return isServerUploadPath(orgId, "project_snapshot", path) && path.startsWith(`${orgId}/arch/project_snapshot/${folder}/`);
}

/** POST /api/cloud-projects(업서트). 순서: 인증 → 본문 strict → 레이트 → 쓰기 권리 → 경로 → 업로드 객체 재검사 → RPC. */
export async function handleSaveCloudProject(req: Request, deps: CloudDeps): Promise<Response> {
  let projectUuid: string | undefined;
  try {
    const session = await deps.session.resolve(req);
    const parsed = saveSchema.safeParse(await readJsonLimited(req, SAVE_MAX_BODY));
    if (!parsed.success) throw new CloudApiError("invalid_input");
    const input = parsed.data;
    projectUuid = input.project_uuid;

    await limit(deps, `arch:cloud_projects_save:${session.orgId}`, SAVE_RATE);
    await requireWrite(deps, session);
    if (!isOwnSnapshotPath(session.orgId, snapshotFolder(input), input.storage_path)) throw new CloudApiError("23514");

    let object: { bytes: number } | null;
    try {
      object = await deps.snapshots().inspect(input.storage_path);
    } catch (e) {
      if (e instanceof CloudApiError) throw e;
      throw new CloudApiError("storage_unavailable");
    }
    if (!object) throw new CloudApiError("23514");
    if (!Number.isSafeInteger(object.bytes) || object.bytes <= 0) throw new CloudApiError("23514");
    if (object.bytes > SNAPSHOT_MAX_BYTES) throw new CloudApiError("AR031", { max_bytes: SNAPSHOT_MAX_BYTES });

    const repo = deps.repo(session);
    let saved: { project_uuid: string; version: number; previous_path?: string | null };
    try {
      saved = await db(() =>
        repo.save({
          orgId: session.orgId,
          projectUuid: input.project_uuid,
          localId: input.local_id ?? null,
          name: input.name,
          storagePath: input.storage_path,
          expectedVersion: input.expected_version,
        }),
      );
    } catch (e) {
      if (e instanceof CloudDbError && e.code === "AR041") {
        throw new CloudApiError("AR041", e.currentVersion !== undefined ? { current_version: e.currentVersion } : undefined);
      }
      if (e instanceof CloudDbError && e.code === "AR040") throw new CloudApiError("AR040", e.max !== undefined ? { max: e.max } : undefined);
      if (e instanceof CloudDbError && e.code === "AR031") throw new CloudApiError("AR031", { max_bytes: SNAPSHOT_MAX_BYTES });
      // DB 권리 검사 실패(AR044)는 402(04_API 1장): 서버 검사와 같은 본문.
      if (e instanceof CloudDbError && e.code === "AR044") throw new CloudApiError("entitlement_expired", { can_download: true });
      throw e;
    }
    if (saved.project_uuid !== input.project_uuid || saved.version !== input.expected_version + 1) {
      // 저장소가 다른 행을 쓰거나 버전을 건너뛰었다: 성공으로 알리지 않는다(조용한 덮어쓰기 방어).
      cloudLog.error("cloud_projects.save_mismatch", { route: "cloud_projects_save", project_uuid: input.project_uuid });
      throw new CloudApiError("internal");
    }
    cloudLog.info("cloud_projects.saved", { route: "cloud_projects_save", project_uuid: saved.project_uuid, version: saved.version });
    // 이전 버전은 보존하지 않는다(최신 1개). 같은 조직·같은 프로젝트 폴더 경로만 지우고, 실패해도 저장은 성공(경로는 로그 0).
    const prev = saved.previous_path;
    if (typeof prev === "string" && prev !== input.storage_path && isOwnSnapshotPath(session.orgId, snapshotFolder(input), prev)) {
      try {
        await deps.snapshots().remove(prev);
      } catch {
        cloudLog.warn("cloud_projects.previous_remove_failed", { route: "cloud_projects_save", project_uuid: saved.project_uuid, version: saved.version, reason: "storage" });
      }
    }
    return cloudOk({ project_uuid: saved.project_uuid, version: saved.version });
  } catch (error) {
    cloudLog.warn("cloud_projects.save_rejected", { route: "cloud_projects_save", code: codeOf(error), ...(projectUuid ? { project_uuid: projectUuid } : {}) });
    return toCloudResponse(error);
  }
}

/**
 * POST /api/cloud-projects/{id}/upload-url: `POST /api/uploads/sign`(project_snapshot, project_ref = id)의 별칭(04_API 2.1절).
 * 새 사본(이 조직에 id 행 없음)이고 조직 상한에 닿았으면 서명하지 않고 AR040(403). 나머지 검사(크기 AR031·확장자·엔타이틀먼트)는 uploads가 한다.
 */
export async function handleCloudUploadUrl(req: Request, id: string, deps: CloudDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    if (!UUID_RE.test(id)) throw new CloudApiError("invalid_input");
    const parsed = uploadUrlSchema.safeParse(await readJsonLimited(req, UPLOAD_URL_MAX_BODY));
    if (!parsed.success) throw new CloudApiError("invalid_input");
    await limit(deps, `arch:cloud_projects_save:${session.orgId}`, SAVE_RATE);
    await requireWrite(deps, session);

    const repo = deps.repo(session);
    const existing = await db(() => repo.find(session.orgId, id));
    if (!existing) {
      const usage = await db(() => repo.usage(session.orgId));
      if (!Number.isSafeInteger(usage.max) || !Number.isSafeInteger(usage.count)) throw new CloudApiError("internal");
      if (usage.count >= usage.max) throw new CloudApiError("AR040", { max: usage.max });
    }
    const headers = new Headers({ "content-type": "application/json" });
    const auth = req.headers.get("authorization");
    if (auth) headers.set("authorization", auth);
    const forwarded = new Request(new URL("/api/uploads/sign", req.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ purpose: "project_snapshot", project_ref: id, ...parsed.data }),
    });
    cloudLog.info("cloud_projects.upload_url", { route: "cloud_projects_upload_url", project_uuid: id, reason: existing ? "existing" : "new" });
    return await deps.signUpload(forwarded);
  } catch (error) {
    cloudLog.warn("cloud_projects.upload_url_rejected", { route: "cloud_projects_upload_url", code: codeOf(error) });
    return toCloudResponse(error);
  }
}
