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

/** 검사용 다운로드 서명 URL 수명(초). 서버가 바로 쓰고 버린다. */
const READ_CHECK_TTL_S = 60;

export function supabaseLogoStorage(service: Client, fetchImpl: typeof fetch = fetch): LogoStorage {
  return {
    async createSignedUploadUrl(path) {
      // upsert=false: 같은 경로 두 번째 업로드는 Storage가 거부한다(URL 재사용 덮어쓰기 차단).
      const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.signedUrl || !data.token) throw new Error("storage sign failed");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async createSignedReadUrl(path, ttlSeconds) {
      // download: Content-Disposition: attachment → 주소를 직접 열어도 브라우저가 문서로 렌더링하지 않는다(<img>는 영향 없음).
      const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, ttlSeconds, { download: true });
      if (error || !data?.signedUrl) throw new Error("storage sign failed");
      return data.signedUrl;
    },
    async read(path, maxBytes) {
      // 객체 전체를 메모리에 올리기 전에 응답 머리(Content-Type·Content-Length)를 먼저 보고, 본문은 상한 + 1바이트까지만 읽고 끊는다.
      // 반환 규약: 없음 null / 상한 초과 → maxBytes + 1바이트(검사기가 too_large) / PNG 아님 → 빈 배열(검사기가 거부).
      const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, READ_CHECK_TTL_S, { download: true });
      if (error || !data?.signedUrl) return null;
      const res = await fetchImpl(data.signedUrl, { redirect: "error" });
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "image/png") {
        await res.body.cancel().catch(() => undefined);
        return new Uint8Array(0);
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body.cancel().catch(() => undefined);
        return new Uint8Array(maxBytes + 1);
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return new Uint8Array(maxBytes + 1);
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    },
  };
}
