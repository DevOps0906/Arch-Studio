// 라이선스 API 실제 배선(서버 전용). 환경 변수는 serverEnv()로만 읽는다(LICENSE_SIGNING_*·AI_TOKEN_*·RATE_LIMIT_IP_SALT).
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "../env.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { MemoryRateLimitStore, type TrustedProxyConfig } from "./rate-limit.ts";
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
 * 프록시 신뢰 범위. 전용 환경 변수가 아직 없어(env.ts 소유 밖) Vercel 배포(VERCEL=1, 플랫폼이 설정)면 XFF 1홉,
 * 그 밖(로컬·자체 호스팅)은 0홉 = 헤더 불신 → 공용 unknown 버킷. 환경 변수 TRUSTED_PROXY_HOPS 추가는 보고서 요청 줄 참고.
 */
function proxyConfig(): TrustedProxyConfig {
  return process.env.VERCEL === "1" ? { header: "x-forwarded-for", trustedHops: 1 } : { header: null, trustedHops: 0 };
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
