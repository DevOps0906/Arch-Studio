// service_role 클라이언트: RLS를 우회하므로 src/server/** 밖 import는 ESLint가 막는다.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/server/env";

function makeClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: env.SUPABASE_DB_SCHEMA },
  });
}

let client: ReturnType<typeof makeClient> | undefined;

export function createSupabaseServiceClient() {
  client ??= makeClient();
  return client;
}
