// 업로드 서명·기능 판정 Supabase 구현. 클라이언트는 deps.ts가 넘긴다.
// service_role 사용 지점(이유): createSignedUploadUrl 1곳. arch-user·voice-audio 버킷에는 사용자 정책이 없어(2400_arch.sql 11절)
// 서버 서명 URL로만 올린다. 경로는 policy.ts가 만든 값만 들어온다. 기능 판정은 사용자 JWT(RLS)로 arch.org_features.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbCodeError } from "../ai/gateway/supabase-repo.ts";
import type { SchemaNames } from "../licenses/supabase-repo.ts";
import type { UploadFeatureRepo, UploadSigner } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

export function supabaseUploadSigner(service: Client): UploadSigner {
  return {
    async createSignedUploadUrl(bucket, path) {
      // upsert=false: 같은 경로 두 번째 업로드는 Storage가 거부한다(URL 재사용 덮어쓰기 차단).
      const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.signedUrl || !data.token) throw new Error("storage sign failed");
      return { signedUrl: data.signedUrl, token: data.token };
    },
  };
}

export function supabaseUploadFeatures(user: Client, schemas: SchemaNames): UploadFeatureRepo {
  return {
    async orgFeatures(orgId) {
      const { data, error } = await user.schema(schemas.arch).rpc("org_features", { p_org: orgId });
      if (error) throw new DbCodeError(error);
      return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    },
  };
}
