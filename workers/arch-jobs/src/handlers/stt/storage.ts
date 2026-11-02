// arch.stt 입출력(service_role). 입력 voice-audio(consult_audio), 전사본 org-files(<org>/arch/stt/<job_id>.json), 정산 환불 refund_credits.
// 클라이언트는 첫 사용 때 만든다. 오류 원문(경로·키)은 메시지에 넣지 않는다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SttStorage {
  download(bucket: "voice-audio", path: string): Promise<Uint8Array>;
  /** 재시도에서 같은 잡이 다시 쓸 수 있게 upsert=true(경로가 잡 id로 고정). content-type application/json. */
  uploadJson(bucket: "org-files", path: string, body: string): Promise<void>;
}

export interface SttCredits {
  /** refund_credits(원장, 금액, 멱등 키). 같은 키 두 번째 호출은 DB가 기존 행을 돌려준다. */
  refund(ledgerId: number, amount: number, idempotencyKey: string): Promise<void>;
}

type Env = Readonly<Record<string, string | undefined>>;

function lazyClient(env: Env): () => SupabaseClient {
  let client: SupabaseClient | undefined;
  return () => {
    const url = env["SUPABASE_URL"];
    const key = env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  };
}

export function supabaseSttStorage(env: Env): SttStorage {
  const get = lazyClient(env);
  return {
    async download(bucket, path) {
      const { data, error } = await get().storage.from(bucket).download(path);
      if (error || !data) throw new Error(`storage.download ${bucket} failed`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async uploadJson(bucket, path, body) {
      const { error } = await get().storage.from(bucket).upload(path, new TextEncoder().encode(body), { contentType: "application/json", upsert: true });
      if (error) throw new Error(`storage.upload ${bucket} failed`);
    },
  };
}

export function supabaseSttCredits(env: Env): SttCredits {
  const get = lazyClient(env);
  return {
    async refund(ledgerId, amount, idempotencyKey) {
      const { error } = await get().rpc("refund_credits", {
        p_consume_ledger_id: ledgerId,
        p_reason: "stt_settle",
        p_amount: amount,
        p_idempotency_key: idempotencyKey,
        p_actor_id: null,
      });
      if (error) throw new Error(`refund_credits failed${error.code ? ` ${error.code}` : ""}`);
    },
  };
}
