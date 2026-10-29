// 라이선스 API 실제 배선(서버 전용). 환경 변수는 serverEnv()로만 읽는다(LICENSE_SIGNING_*·AI_TOKEN_*·RATE_LIMIT_IP_SALT·TRUSTED_PROXY_HOPS).
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { MemoryRateLimitStore, proxyConfigFromHops, type TrustedProxyConfig } from "./rate-limit.ts";
import { createLicenseSigner, type LicenseSigner } from "./signing.ts";
import { bearerSessionResolver, schemaNames, supabasePrivilegedRepo, supabaseUserRepo } from "./supabase-repo.ts";
import type { LicenseDeps } from "./types.ts";

let signer: LicenseSigner | undefined;
let deps: LicenseDeps | undefined;

function loadSigner(): LicenseSigner {
  if (signer) return signer;
  const env = serverEnv();
  signer = createLicenseSigner({
    privateKey: env.LICENSE_SIGNING_PRIVATE_KEY,
    kid: env.LICENSE_SIGNING_KID,
    aiTokenPrivateKey: env.AI_TOKEN_PRIVATE_KEY,
    aiTokenKid: env.AI_TOKEN_KID,
  });
  return signer;
}

/**
 * 프록시 신뢰 범위: serverEnv().TRUSTED_PROXY_HOPS(기본 0)만 따른다(플랫폼 감지 특례 없음, 명시 설정 우선).
 * 0 = 헤더 불신 → IP 버킷을 끄고 사용자 버킷만. Vercel 배포는 TRUSTED_PROXY_HOPS=1을 설정해야 IP 버킷이 켜진다.
 */
function proxyConfig(): TrustedProxyConfig {
  return proxyConfigFromHops(serverEnv().TRUSTED_PROXY_HOPS);
}

export function licenseDeps(): LicenseDeps {
  if (deps) return deps;
  const env = serverEnv();
  const schemas = schemaNames(env.SUPABASE_DB_SCHEMA);
  const userClient = (token: string) =>
    createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  const rateLimit = new MemoryRateLimitStore();
  deps = {
    session: bearerSessionResolver(userClient, schemas),
    userRepo: (session) => supabaseUserRepo(userClient(session.accessToken), schemas),
    privilegedRepo: () => supabasePrivilegedRepo(createSupabaseServiceClient(), schemas),
    signer: loadSigner,
    rateLimit,
    ipSalt: () => serverEnv().RATE_LIMIT_IP_SALT,
    proxy: proxyConfig(),
    now: () => Date.now(),
  };
  return deps;
}
