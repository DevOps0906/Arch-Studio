// 클라우드 사본 Supabase 구현. 클라이언트는 deps.ts가 넘긴다(env 접근은 거기서만).
// 읽기(list·usage·find)는 사용자 JWT(RLS: 조직 멤버십). service_role 사용 지점(이유):
//  1) save/remove RPC: arch.save_cloud_project·delete_cloud_project는 EXECUTE가 service_role에만 있다(2402_arch_cloud_projects.sql).
//     조직·행위자는 route가 세션에서 정해 넘기고 함수가 멤버십을 다시 확인한다.
//  2) Storage 객체 검사·폴더 정리: arch-user 버킷에는 사용자 정책이 없다(2400_arch.sql 11절).
// DB 오류는 SQLSTATE와 안전한 숫자(DETAIL JSON의 current_version·max)만 남긴다. 메시지·경로·이름 원문은 버린다.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import { CloudDbError, mapCloudDbError } from "./errors.ts";
import type { CloudProjectRepo, CloudProjectRow, SnapshotInspector } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const BUCKET = "arch-user";
const COLUMNS = "org_id, project_uuid, local_id, name, version, blob_bytes, updated_at";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// 커서 안의 시각은 PostgREST or() 필터에 들어가므로 형식을 엄격히 고정한다(필터 주입 방지).
const CURSOR_PAYLOAD = new RegExp(`^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2}))\\|(${UUID})$`);

export function encodeCursor(updatedAt: string, projectUuid: string): string {
  return Buffer.from(`${updatedAt}|${projectUuid}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { updatedAt: string; projectUuid: string } | null {
  const m = CURSOR_PAYLOAD.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  return m ? { updatedAt: m[1] as string, projectUuid: m[2] as string } : null;
}

/** PostgREST 오류 → CloudDbError. AR041의 현재 버전·AR040의 상한은 DETAIL(JSON)에서만 읽는다. */
export function toCloudDbError(error: unknown): CloudDbError {
  const code = mapCloudDbError(error);
  const raw = error !== null && typeof error === "object" ? (error as { details?: unknown }).details : undefined;
  let detail: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = {};
    }
  }
  const extra: { currentVersion?: number; max?: number } = {};
  if (code === "AR041" && typeof detail.current_version === "number") extra.currentVersion = detail.current_version;
  if (code === "AR040" && typeof detail.max === "number") extra.max = detail.max;
  return new CloudDbError(code, extra);
}

export function supabaseCloudProjectRepo(user: Client, service: Client, schemas: SchemaNames): CloudProjectRepo {
  return {
    async list(orgId, opts) {
      let q = user
        .schema(schemas.arch)
        .from("cloud_projects")
        .select(COLUMNS)
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false })
        .order("project_uuid", { ascending: false })
        .limit(opts.limit + 1);
      if (opts.cursor !== null) {
        const c = decodeCursor(opts.cursor);
        if (!c) throw new CloudDbError("invalid_input");
        q = q.or(`updated_at.lt.${c.updatedAt},and(updated_at.eq.${c.updatedAt},project_uuid.lt.${c.projectUuid})`);
      }
      const { data, error } = await q;
      if (error) throw toCloudDbError(error);
      const all = (data ?? []) as Array<Record<string, unknown>>;
      const page = all.slice(0, opts.limit);
      const last = page[page.length - 1];
      const rows = page.map((r) => ({ ...r, bytes: r.blob_bytes })) as unknown as CloudProjectRow[];
      const next = all.length > opts.limit && last ? encodeCursor(String(last.updated_at), String(last.project_uuid)) : null;
      return { rows, next };
    },
    async usage(orgId) {
      const { count, error } = await user.schema(schemas.arch).from("cloud_projects").select("project_uuid", { count: "exact", head: true }).eq("org_id", orgId);
      if (error) throw toCloudDbError(error);
      const feat = await user.schema(schemas.arch).rpc("org_features", { p_org: orgId });
      if (feat.error) throw toCloudDbError(feat.error);
      const max = feat.data !== null && typeof feat.data === "object" ? (feat.data as Record<string, unknown>).cloud_projects_max : undefined;
      // retention_until: 보존 상태 테이블은 후속 작업(결정 6)이라 null.
      return { count: count ?? 0, max: typeof max === "number" ? max : 3, retentionUntil: null };
    },
    async find(orgId, projectUuid) {
      const { data, error } = await user.schema(schemas.arch).from("cloud_projects").select("version").eq("org_id", orgId).eq("project_uuid", projectUuid).maybeSingle();
      if (error) throw toCloudDbError(error);
      return data ? { version: Number((data as { version: unknown }).version) } : null;
    },
    async save(args) {
      const { data, error } = await service.schema(schemas.arch).rpc("save_cloud_project", {
        p_org: args.orgId,
        p_actor: args.actorId,
        p_project_uuid: args.projectUuid,
        p_name: args.name,
        p_storage_path: args.storagePath,
        p_expected_version: args.expectedVersion,
        p_blob_bytes: args.blobBytes,
        p_schema_version: args.schemaVersion,
        p_local_id: args.localId,
      });
      if (error) throw toCloudDbError(error);
      const row = (Array.isArray(data) ? data[0] : data) as { project_uuid?: unknown; version?: unknown } | null | undefined;
      if (!row || typeof row.project_uuid !== "string" || typeof row.version !== "number") throw new CloudDbError("internal");
      return { project_uuid: row.project_uuid, version: row.version };
    },
    async remove(orgId, actorId, projectUuid, expectedVersion) {
      const { data, error } = await service.schema(schemas.arch).rpc("delete_cloud_project", {
        p_org: orgId,
        p_actor: actorId,
        p_project_uuid: projectUuid,
        p_expected_version: expectedVersion,
      });
      if (error) throw toCloudDbError(error);
      const row = (Array.isArray(data) ? data[0] : data) as { version?: unknown } | null | undefined;
      if (!row || typeof row.version !== "number") throw new CloudDbError("internal");
      return { version: row.version };
    },
  };
}

const PURGE_PAGE = 1000;

export function supabaseSnapshotInspector(service: Client, schemas: SchemaNames): SnapshotInspector {
  return {
    async inspect(path) {
      const at = path.lastIndexOf("/");
      const dir = path.slice(0, at);
      const file = path.slice(at + 1);
      const { data, error } = await service.storage.from(BUCKET).list(dir, { limit: 100, search: file });
      if (error) throw new Error("storage list failed");
      const hit = (data ?? []).find((o: { name: string }) => o.name === file) as { metadata?: { size?: unknown } | null } | undefined;
      const size = hit?.metadata?.size;
      return typeof size === "number" ? { bytes: size } : null;
    },
    async purge(orgId, projectUuid) {
      const dir = `${orgId}/arch/project_snapshot/${projectUuid}`;
      // 삭제 직후 같은 project_uuid가 다시 저장됐을 수 있다: 살아 있는 행의 storage_path는 지우지 않는다.
      const live = await service.schema(schemas.arch).from("cloud_projects").select("storage_path").eq("org_id", orgId).eq("project_uuid", projectUuid).maybeSingle();
      if (live.error) throw new Error("db read failed");
      const keep = (live.data as { storage_path?: unknown } | null)?.storage_path;
      const names: string[] = [];
      for (let offset = 0; ; offset += PURGE_PAGE) {
        const { data, error } = await service.storage.from(BUCKET).list(dir, { limit: PURGE_PAGE, offset });
        if (error) throw new Error("storage list failed");
        const page = (data ?? []) as Array<{ name: string }>;
        for (const o of page) if (`${dir}/${o.name}` !== keep) names.push(`${dir}/${o.name}`);
        if (page.length < PURGE_PAGE) break;
      }
      for (let i = 0; i < names.length; i += PURGE_PAGE) {
        const removed = await service.storage.from(BUCKET).remove(names.slice(i, i + PURGE_PAGE));
        if (removed.error) throw new Error("storage remove failed");
      }
    },
  };
}
