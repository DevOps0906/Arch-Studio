// 클라우드 사본 저장소·업로드 객체 Supabase 구현(AR-06-073). 클라이언트는 deps.ts가 넘긴다. server-only를 import하지 않는다.
// 사용자 JWT(RLS): list·usage·find·save. SELECT 정책은 조직 구성원(엔타이틀먼트 무관, 2402), save는 arch.save_cloud_project(2402 시그니처).
// service_role 사용 지점(이유): 업로드 객체 메타 조회·이전 객체 삭제 2곳. arch-user 버킷에는 사용자 정책이 없다(2400_arch.sql 11절).
// 오류 원문은 보관·로그하지 않는다: SQLSTATE와 detail의 숫자(current_version·max)만 꺼낸다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_RE } from "../ai/gateway/http.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import { CloudApiError, CloudDbError, mapCloudDbError } from "./errors.ts";
import type { CloudProjectRepo, CloudProjectRow, SnapshotInspector } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

export const SNAPSHOT_BUCKET = "arch-user";
const COLUMNS = "id, org_id, project_uuid, local_id, name, version, bytes, updated_at";
const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

/** 커서 = base64url(JSON [updated_at, id]) — 목록 정렬(updated_at desc, id desc)의 마지막 행. */
export function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify([updatedAt, id]), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new CloudApiError("invalid_input");
  }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "string" || typeof v[1] !== "string" || !TS.test(v[0]) || !UUID_RE.test(v[1])) {
    throw new CloudApiError("invalid_input");
  }
  return { updatedAt: v[0], id: v[1] };
}

/** RAISE ... detail = jsonb 텍스트(2402)에서 정수 하나만 꺼낸다. 형식이 다르면 undefined. */
function detailInt(error: unknown, key: string): number | undefined {
  const details = error !== null && typeof error === "object" ? (error as { details?: unknown }).details : undefined;
  if (typeof details !== "string") return undefined;
  try {
    const v = (JSON.parse(details) as Record<string, unknown>)[key];
    return Number.isSafeInteger(v) ? (v as number) : undefined;
  } catch {
    return undefined;
  }
}

/** PostgREST 오류 → CloudDbError. AR041은 current_version, AR040은 max를 detail에서. */
export function toCloudDbError(error: unknown): CloudDbError {
  const code = mapCloudDbError(error);
  if (code === "AR041") return new CloudDbError(code, { currentVersion: detailInt(error, "current_version") });
  if (code === "AR040") return new CloudDbError(code, { max: detailInt(error, "max") });
  return new CloudDbError(code);
}

export function supabaseCloudRepo(user: Client, schemas: SchemaNames): CloudProjectRepo {
  const arch = () => user.schema(schemas.arch);
  return {
    async list(orgId, { cursor, limit }) {
      let q = arch().from("cloud_projects").select(COLUMNS).eq("org_id", orgId);
      if (cursor !== null) {
        const c = decodeCursor(cursor);
        q = q.or(`updated_at.lt."${c.updatedAt}",and(updated_at.eq."${c.updatedAt}",id.lt.${c.id})`);
      }
      const { data, error } = await q.order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
      if (error) throw toCloudDbError(error);
      const all = (data ?? []) as Array<CloudProjectRow & { id: string }>;
      const page = all.slice(0, limit);
      const last = page[page.length - 1];
      const next = all.length > limit && last ? encodeCursor(last.updated_at, last.id) : null;
      return {
        rows: page.map((r) => ({
          org_id: r.org_id,
          project_uuid: r.project_uuid,
          local_id: r.local_id,
          name: r.name,
          version: r.version,
          bytes: r.bytes,
          updated_at: r.updated_at,
        })),
        next,
      };
    },
    async usage(orgId) {
      const [{ count, error }, feat] = await Promise.all([
        arch().from("cloud_projects").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        arch().rpc("org_features", { p_org: orgId }),
      ]);
      if (error) throw toCloudDbError(error);
      if (feat.error) throw toCloudDbError(feat.error);
      const f = feat.data !== null && typeof feat.data === "object" ? (feat.data as Record<string, unknown>) : {};
      const max = f.cloud_projects_max;
      // retention_until: 보존 시계(cloud_retention)는 AR-06-074 몫이라 아직 null.
      return { count: count ?? 0, max: Number.isSafeInteger(max) ? (max as number) : Number.NaN, retentionUntil: null };
    },
    async find(orgId, projectUuid) {
      const { data, error } = await arch()
        .from("cloud_projects")
        .select("version")
        .eq("org_id", orgId)
        .eq("project_uuid", projectUuid)
        .maybeSingle();
      if (error) throw toCloudDbError(error);
      return data ? { version: (data as { version: number }).version } : null;
    },
    async save(args) {
      const { data, error } = await arch().rpc("save_cloud_project", {
        p_project_uuid: args.projectUuid,
        p_local_id: args.localId,
        p_name: args.name,
        p_storage_path: args.storagePath,
        p_expected_version: args.expectedVersion,
      });
      if (error) throw toCloudDbError(error);
      const r = (Array.isArray(data) ? data[0] : data) as { project_uuid?: unknown; version?: unknown; previous_path?: unknown } | undefined;
      if (!r || typeof r.project_uuid !== "string" || !Number.isSafeInteger(r.version)) throw new CloudDbError("internal");
      return {
        project_uuid: r.project_uuid,
        version: r.version as number,
        previous_path: typeof r.previous_path === "string" ? r.previous_path : null,
      };
    },
  };
}

/** service_role Storage. inspect = 객체 메타 크기(없으면 null), remove = 교체된 이전 객체 삭제. */
export function supabaseSnapshotInspector(service: Client): SnapshotInspector {
  const bucket = () => service.storage.from(SNAPSHOT_BUCKET);
  return {
    async inspect(path) {
      const cut = path.lastIndexOf("/");
      const dir = path.slice(0, cut);
      const name = path.slice(cut + 1);
      const { data, error } = await bucket().list(dir, { search: name, limit: 10 });
      if (error) throw new Error("storage list failed");
      const hit = (data ?? []).find((o) => o.name === name);
      if (!hit) return null;
      const size = (hit.metadata as { size?: unknown } | null)?.size;
      return { bytes: Number.isSafeInteger(size) ? (size as number) : -1 };
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error("storage remove failed");
    },
  };
}
