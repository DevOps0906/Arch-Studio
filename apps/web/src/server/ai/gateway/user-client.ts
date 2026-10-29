// 사용자 JWT Supabase 클라이언트(anon 키 + Authorization: Bearer <access_token>, RLS 적용). 서버 전용.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../../env.ts";
import { schemaNames, type SchemaNames } from "../../licenses/supabase-repo.ts";
import { bearerGatewaySession, type GatewaySessionResolver } from "./session.ts";

export function userClient(token: string) {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function gatewaySchemas(): SchemaNames {
  return schemaNames(serverEnv().SUPABASE_DB_SCHEMA);
}

export function gatewaySessionResolver(): GatewaySessionResolver {
  return bearerGatewaySession(userClient, gatewaySchemas());
}
