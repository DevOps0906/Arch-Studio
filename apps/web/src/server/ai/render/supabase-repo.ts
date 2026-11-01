// AI 렌더 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유): RenderInputStore 1곳. arch-user 버킷에는 사용자 정책이 없어(2400_arch.sql 11절) 서버만 읽을 수 있다.
// 읽는 경로는 service.ts가 자기 조직 render_input 모양 검사를 통과시킨 값만. 기능 판정·동의 조회는 사용자 JWT(RLS).
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../gateway/supabase-repo.ts";
import type { SchemaNames } from "../../licenses/supabase-repo.ts";
import type { RenderInputStore, RenderOrgRepo } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const INPUT_BUCKET = "arch-user";

function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const raw = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

export function supabaseRenderInputs(service: Client): RenderInputStore {
  return {
    async size(path) {
      const { data, error } = await service.storage.from(INPUT_BUCKET).info(path);
      if (error) {
        const status = statusOf(error);
        if (status === 400 || status === 404) return null; // 없는 객체
        throw new Error("storage info failed");
      }
      const size = (data as { size?: unknown } | null)?.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error("storage info without size");
      return size;
    },
    async head(path, n) {
      // 크기 검사(≤10MB)를 통과한 뒤에만 부른다.
      const { data, error } = await service.storage.from(INPUT_BUCKET).download(path);
      if (error || !data) throw new Error("storage download failed");
      return new Uint8Array(await data.slice(0, n).arrayBuffer());
    },
  };
}

export function supabaseRenderOrg(user: Client, schemas: SchemaNames): RenderOrgRepo {
  return {
    async orgFeatures(orgId) {
      const { data, error } = await user.schema(schemas.arch).rpc("org_features", { p_org: orgId });
      if (error) throw new DbCodeError(error);
      return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    },
    async hasCrossBorderAck(orgId) {
      // RLS ai_org_settings_select(조직 구성원 읽기, 20261013000001_core_lite.sql:3000). 행이 없거나 값이 null이면 미동의.
      const { data, error } = await user.schema(schemas.core).from("ai_org_settings").select("cross_border_ack_at").eq("org_id", orgId).maybeSingle();
      if (error) throw new DbCodeError(error);
      const at = (data as { cross_border_ack_at?: unknown } | null)?.cross_border_ack_at;
      return typeof at === "string" && at.length > 0;
    },
  };
}
