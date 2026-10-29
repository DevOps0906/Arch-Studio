// 표제란 설정 Supabase 구현. 클라이언트는 deps.ts가 넘긴다(env 접근은 거기서만).
// 프로필 읽기·저장은 사용자 JWT(RLS + RPC 안 역할 검사). service_role 사용 지점(이유): 로고 Storage 3곳
// (서명 업로드 URL·서명 읽기 URL·검사용 다운로드) — arch-user 버킷에는 사용자 정책이 없어 서버만 다룬다(2400_arch.sql 11절).
// 경로는 png.ts가 만든·검사한 값만 들어온다. DB 오류는 SQLSTATE만 남긴다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../ai/gateway/supabase-repo.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { DraftingProfileRepo, LogoStorage } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const COLUMNS = "office_name, architect_name, contact, logo_storage_path, layer_map, default_paper, default_text_height_mm, font_family, updated_at";
const BUCKET = "arch-user";

export function supabaseDraftingProfileRepo(user: Client, schemas: SchemaNames): DraftingProfileRepo {
  return {
    async get(orgId) {
      const { data, error } = await user.schema(schemas.arch).from("drafting_profiles").select(COLUMNS).eq("org_id", orgId).maybeSingle();
      if (error) throw new DbCodeError(error);
      return data ?? null;
    },
    async upsert(payload, orgId) {
      const { data, error } = await user.schema(schemas.arch).rpc("upsert_drafting_profile", { p: payload, p_org: orgId });
      if (error) throw new DbCodeError(error);
      return data;
    },
  };
}

export function supabaseLogoStorage(service: Client): LogoStorage {
  return {
    async createSignedUploadUrl(path) {
      // upsert=false: 같은 경로 두 번째 업로드는 Storage가 거부한다(URL 재사용 덮어쓰기 차단).
      const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.signedUrl || !data.token) throw new Error("storage sign failed");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async createSignedReadUrl(path, ttlSeconds) {
      const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, ttlSeconds);
      if (error || !data?.signedUrl) throw new Error("storage sign failed");
      return data.signedUrl;
    },
    async read(path, maxBytes) {
      const { data, error } = await service.storage.from(BUCKET).download(path);
      if (error || !data) return null;
      // 크기를 먼저 본다(상한 + 1까지만 읽어 넘으면 검사기가 too_large로 거부).
      if (data.size > maxBytes) return new Uint8Array(maxBytes + 1);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
