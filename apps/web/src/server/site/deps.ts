// 대지 조회 실제 배선(서버 전용). 환경 변수는 serverEnv()로만 읽는다(VWORLD_API_KEY·SITE_LOOKUP_HASH_KEY·APP_URL).
// 조회 켜짐 조건: VWORLD_API_KEY가 있고 SITE_LOOKUP_PROVIDER_ENABLED가 true. 키가 없으면(기본 배포) AR021 not_configured →
// 화면은 직접 그리기로 이어 간다(02장 445행, D-14 "원문 확인 전 직접 그리기가 기본").
import "server-only";
import { gatewaySchemas, gatewaySessionResolver } from "../ai/gateway/user-client.ts";
import { serverEnv } from "../env.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { SiteLookupDeps } from "./service.ts";
import { supabaseSiteRecorder } from "./supabase-repo.ts";
import { createVworldProvider, type FetchImpl } from "./vworld.ts";

/**
 * 운영 스위치(코드 상수). 이용 조건(D-14) 문제로 키가 있어도 끄려면 false로 배포한다.
 * env로 옮기려면 env 스키마에 `SITE_LOOKUP_ENABLED`(제안)를 추가해야 한다(이 작업 소유 밖, 로그 "미해결").
 */
export const SITE_LOOKUP_PROVIDER_ENABLED = true;

let deps: SiteLookupDeps | undefined;

export function siteLookupDeps(): SiteLookupDeps {
  if (deps) return deps;
  const env = serverEnv();
  const apiKey = env.VWORLD_API_KEY;
  const provider =
    SITE_LOOKUP_PROVIDER_ENABLED && apiKey
      ? createVworldProvider({
          apiKey,
          fetch: ((url, init) => fetch(url, { ...init, cache: "no-store" })) as FetchImpl,
          now: () => Date.now(),
          domain: new URL(env.APP_URL).host,
        })
      : null;
  deps = {
    session: gatewaySessionResolver(),
    provider,
    recorder: () => supabaseSiteRecorder(createSupabaseServiceClient(), gatewaySchemas()),
    hashKey: () => serverEnv().SITE_LOOKUP_HASH_KEY,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
