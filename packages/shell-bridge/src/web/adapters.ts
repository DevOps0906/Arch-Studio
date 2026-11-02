// 웹 어댑터 묶음(AR-06-072, ADR-001 2.1·3.1). `createPlatformAdapters({ web: () => createWebAdapters({...}) })`로 주입한다.
// 비밀은 메모리뿐(persistentSecrets=false, 인증은 Bearer): 토큰은 영속 웹 스토리지·읽기 캐시·쿠키 어디에도 저장하지 않는다.
// 로그아웃(clearSecrets)은 비밀과 IndexedDB 읽기 캐시를 함께 지운다. 한쪽이 실패해도 다른 쪽을 지운 뒤 첫 오류를 던진다.
import { WEB_CAPABILITIES } from "../adapters/capabilities.ts";
import type { PlatformAdapters } from "../adapters/index.ts";
import { clearAllSecrets, MemorySecureStore } from "../adapters/secure-store.ts";
import { WebEntitlementClient } from "./entitlement.ts";
import { createBrowserFileHost, WebFileGateway, type WebFileHost } from "./file-gateway.ts";
import { createGuardedCache, principalFromToken } from "./guarded-cache.ts";
import { WebApi, type WebApiOptions } from "./http.ts";
import { WebProjectStore } from "./project-store.ts";
import { createIndexedDbReadCache, type ReadCache } from "./read-cache.ts";

export interface CreateWebAdaptersOptions extends WebApiOptions {
  /** 파일 대화상자 경계. 기본 브라우저 구현. */
  readonly fileHost?: WebFileHost;
  /** 읽기 캐시. 기본 IndexedDB(없으면 캐시 없음). */
  readonly cache?: ReadCache;
  /**
   * 캐시 주체(sub+org). 기본은 access token(JWT) payload의 sub·org_id를 서명 검증 없이 읽는다(캐시 구분용).
   * null이면 캐시를 읽지도 쓰지도 않는다. 계정이 바뀌면 이전 사용자의 캐시는 폐기된다.
   */
  readonly getPrincipal?: () => Promise<string | null>;
}

export function createWebAdapters(options: CreateWebAdaptersOptions): PlatformAdapters {
  const api = new WebApi(options);
  const getPrincipal =
    options.getPrincipal ?? (async () => principalFromToken(await options.getAccessToken().catch(() => null)));
  const cache = createGuardedCache(options.cache ?? createIndexedDbReadCache(), getPrincipal);
  const secrets = new MemorySecureStore();
  const projects = new WebProjectStore({ api, cache });
  return Object.freeze({
    capabilities: WEB_CAPABILITIES,
    projects,
    files: new WebFileGateway(options.fileHost ?? createBrowserFileHost()),
    secrets,
    entitlement: new WebEntitlementClient(api),
    updater: null,
    async clearSecrets() {
      projects.reset();
      let first: unknown;
      try {
        await clearAllSecrets(secrets);
      } catch (e) {
        first = e;
      }
      try {
        await cache.clear();
      } catch (e) {
        first ??= e;
      }
      if (first !== undefined) throw first;
    },
  });
}
