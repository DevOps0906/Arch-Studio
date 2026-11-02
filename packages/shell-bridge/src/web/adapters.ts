// 웹 PlatformAdapters 조립(AR-06-072, ADR-001 2.1·3.1). Updater 없음(배포 즉시 반영), 라이선스 파일 없음(서버 판정), 래스터화 없음.
// SecureStore = 메모리(MemorySecureStore): 영속 웹 스토리지에 토큰을 두지 않는다. 서버 세션 쿠키는 httpOnly라 JS가 만지지 않는다.
// 로그아웃(clearSecrets) = 비밀 전부 + 읽기 캐시 전부 삭제 + 권한 판정 초기화. 하나가 실패해도 나머지를 한 뒤 첫 오류를 던진다.
import { WEB_CAPABILITIES } from "../adapters/capabilities.ts";
import type { PlatformAdapters } from "../adapters/index.ts";
import { clearAllSecrets, MemorySecureStore, type SecureStore } from "../adapters/secure-store.ts";
import { WebEntitlementClient } from "./entitlement.ts";
import { browserFileHost, WebFileGateway, type WebFileHost } from "./file-gateway.ts";
import { sessionAccessToken, WebHttp, type AccessTokenFn, type FetchFn } from "./http.ts";
import { IdbProjectCache, type ProjectReadCache } from "./project-cache.ts";
import { WebProjectStore } from "./project-store.ts";

export interface WebAdaptersOptions {
  /** 기본 globalThis.fetch. */
  readonly fetch?: FetchFn;
  /** API 출처. 기본 같은 출처. */
  readonly baseUrl?: string;
  /** 기본 메모리. */
  readonly secrets?: SecureStore;
  /** Bearer 토큰 공급. 기본: secrets의 supabase 세션 access_token. */
  readonly accessToken?: AccessTokenFn;
  /** 읽기 캐시용 IndexedDB 팩토리(앱 조립부가 브라우저 전역을 넘긴다). 없으면 캐시 없이 서버만. */
  readonly idb?: IDBFactory | null;
  /** 캐시 구현을 직접 줄 때(테스트). `idb`보다 우선. */
  readonly cache?: ProjectReadCache | null;
  /** 파일 대화상자. 기본 브라우저(File System Access API → `<input type=file>`·다운로드). */
  readonly files?: WebFileHost;
}

export function createWebAdapters(options: WebAdaptersOptions = {}): PlatformAdapters {
  const secrets = options.secrets ?? new MemorySecureStore();
  const http = new WebHttp({
    fetch: options.fetch,
    baseUrl: options.baseUrl,
    accessToken: options.accessToken ?? sessionAccessToken(secrets),
  });
  const cache = options.cache !== undefined ? options.cache : options.idb ? new IdbProjectCache(options.idb) : null;
  const entitlement = new WebEntitlementClient(http);

  async function clearSecrets(): Promise<void> {
    let first: unknown;
    entitlement.reset();
    for (const step of [() => clearAllSecrets(secrets), async () => cache?.clear()]) {
      try {
        await step();
      } catch (err) {
        first ??= err;
      }
    }
    if (first !== undefined) throw first;
  }

  return Object.freeze({
    capabilities: WEB_CAPABILITIES,
    projects: new WebProjectStore(http, cache),
    files: new WebFileGateway(options.files ?? browserFileHost()),
    secrets,
    entitlement,
    updater: null,
    clearSecrets,
  });
}
