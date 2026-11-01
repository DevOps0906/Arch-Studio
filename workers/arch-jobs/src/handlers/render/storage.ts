// 렌더 입력 읽기·결과 쓰기(service_role). 입력은 arch-user(render_input), 결과는 org-files(<org>/arch/render/<uuid>.png).
// 클라이언트는 첫 사용 때 만든다(스위치가 꺼진 워커는 만들지 않음). 오류 원문(경로·키)은 메시지에 넣지 않는다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface RenderStorage {
  download(bucket: "arch-user", path: string): Promise<Uint8Array>;
  /** 덮어쓰기 금지(upsert=false), content-type image/png. */
  uploadPng(bucket: "org-files", path: string, bytes: Uint8Array): Promise<void>;
}

export function supabaseRenderStorage(env: Readonly<Record<string, string | undefined>>): RenderStorage {
  let client: SupabaseClient | undefined;
  const get = (): SupabaseClient => {
    const url = env["SUPABASE_URL"];
    const key = env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  };
  return {
    async download(bucket, path) {
      const { data, error } = await get().storage.from(bucket).download(path);
      if (error || !data) throw new Error(`storage.download ${bucket} failed`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async uploadPng(bucket, path, bytes) {
      const { error } = await get().storage.from(bucket).upload(path, bytes, { contentType: "image/png", upsert: false });
      if (error) throw new Error(`storage.upload ${bucket} failed`);
    },
  };
}
