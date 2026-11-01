// 제안서 Supabase 구현. 클라이언트는 deps.ts가 만들어 넘긴다(env 접근은 거기서만).
// service_role 사용 지점(이유): ProposalStore 1곳. arch-user 버킷에는 사용자 정책이 없어(2400_arch.sql 11절) 서버만 읽고 쓸 수 있다.
// 읽는 경로는 service.ts가 자기 조직 proposal_sheet 모양 검사를 통과시킨 값, 쓰는 경로는 서버가 만든 proposal_content 경로만.
// 기능 판정·동의 조회는 사용자 JWT(RLS) — render의 supabaseRenderOrg를 그대로 쓴다(deps.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposalStore } from "./service.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 생성 타입(Database) 도입 전
type Client = SupabaseClient<any, any, any>;

const BUCKET = "arch-user";

function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const raw = (error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

export function supabaseProposalStore(service: Client): ProposalStore {
  return {
    async size(path) {
      const { data, error } = await service.storage.from(BUCKET).info(path);
      if (error) {
        const status = statusOf(error);
        if (status === 400 || status === 404) return null; // 없는 객체
        throw new Error("storage info failed");
      }
      const size = (data as { size?: unknown } | null)?.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error("storage info without size");
      return size;
    },
    async read(path) {
      const { data, error } = await service.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error("storage download failed");
      return new Uint8Array(await data.arrayBuffer());
    },
    async putContent(path, bytes) {
      const { error } = await service.storage.from(BUCKET).upload(path, bytes, { contentType: "application/json", upsert: false });
      if (error) throw new Error("storage upload failed");
    },
  };
}
