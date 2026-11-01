// 새 프로젝트 지도(검색·타일) 실제 배선(서버 전용). 스위치 ARCH_SITE_MAP_ENABLED는 serverEnv 스키마(소유 밖)에 아직 없어
// process.env에서 직접 읽는다(ai/render/deps.ts와 같음). 키는 serverEnv().VWORLD_API_KEY에서만 읽어 어댑터 클로저에 둔다.
import "server-only";
import { gatewaySessionResolver } from "../ai/gateway/user-client.ts";
import { serverEnv } from "../env.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { isSiteMapEnabled } from "./map-config.ts";
import { createVworldSearch, type SiteSearchDeps } from "./search.ts";
import { createVworldTiles, TileSessionCache, type SiteTileDeps } from "./tiles.ts";
import type { FetchImpl } from "./vworld.ts";

const noStoreFetch = ((url, init) => fetch(url, { ...init, cache: "no-store" })) as FetchImpl;

let searchDeps: SiteSearchDeps | undefined;
let tileDeps: SiteTileDeps | undefined;

export function siteSearchDeps(): SiteSearchDeps {
  if (searchDeps) return searchDeps;
  const env = serverEnv();
  const apiKey = env.VWORLD_API_KEY;
  searchDeps = {
    enabled: () => isSiteMapEnabled(process.env),
    session: gatewaySessionResolver(),
    provider: apiKey ? createVworldSearch({ apiKey, fetch: noStoreFetch, domain: new URL(env.APP_URL).host }) : null,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return searchDeps;
}

export function siteTileDeps(): SiteTileDeps {
  if (tileDeps) return tileDeps;
  const apiKey = serverEnv().VWORLD_API_KEY;
  tileDeps = {
    enabled: () => isSiteMapEnabled(process.env),
    session: gatewaySessionResolver(),
    sessionCache: new TileSessionCache(),
    provider: apiKey ? createVworldTiles({ apiKey, fetch: noStoreFetch }) : null,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return tileDeps;
}
