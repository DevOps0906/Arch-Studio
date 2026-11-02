// NativeBridge(005): 화면 코드가 보는 플랫폼 경계의 최소형(capabilities·secrets·clearSecrets). 008 로그인이 쓴다.
// 070부터 전체 경계는 `PlatformAdapters`(어댑터 5종, adapters/index.ts)이며 NativeBridge를 넓힌 것이다.
// 기능 코드는 `capabilities`로만 분기하고 플랫폼 이름을 직접 검사하지 않는다(ADR-001 2.1, eslint `platform` 묶음).
import {
  bridgeCapabilities,
  TAURI_CAPABILITIES,
  WEB_CAPABILITIES,
  type Capabilities,
} from "./adapters/capabilities.ts";
import { BridgeError } from "./adapters/errors.ts";
import type { PlatformAdapters } from "./adapters/index.ts";
import { clearAllSecrets, MemorySecureStore, type SecureStore } from "./adapters/secure-store.ts";
import { createTauriAdapters } from "./tauri/adapters.ts";
import { isTauriRuntime, tauriInvoke, type InvokeFn } from "./tauri/invoke.ts";
import { TauriSecureStore } from "./tauri/secure-store.ts";

export type { Capabilities };

export interface NativeBridge {
  readonly capabilities: Capabilities;
  readonly secrets: SecureStore;
  /** 로그아웃: 허용 키 전부 삭제. supabase `signOut` 성공 여부와 무관하게 부른다. */
  clearSecrets(): Promise<void>;
}

// 005와 같은 4키 값(키 집합을 바꾸지 않는다).
const TAURI_BRIDGE_CAPABILITIES = bridgeCapabilities(TAURI_CAPABILITIES);
const WEB_BRIDGE_CAPABILITIES = bridgeCapabilities(WEB_CAPABILITIES);

function bridgeOf(capabilities: Capabilities, secrets: SecureStore): NativeBridge {
  return Object.freeze({
    capabilities,
    secrets,
    clearSecrets: () => clearAllSecrets(secrets),
  });
}

/** 설치형 브리지. invoke는 테스트에서만 주입한다. */
export function createTauriBridge(invoke: InvokeFn = tauriInvoke): NativeBridge {
  return bridgeOf(TAURI_BRIDGE_CAPABILITIES, new TauriSecureStore(invoke));
}

/** 웹 대체 브리지: 비밀은 메모리만(영속 웹 스토리지 미사용). 웹 본 구현(072 `web/`)도 메모리 보관 + Bearer(D-071a, 쿠키·localStorage·sessionStorage 없음). */
export function createWebBridge(): NativeBridge {
  return bridgeOf(WEB_BRIDGE_CAPABILITIES, new MemorySecureStore());
}

export interface CreateBridgeOptions {
  /** 런타임 판정 대상(테스트용). 기본 globalThis. */
  scope?: object;
  /** Tauri invoke(테스트용). */
  invoke?: InvokeFn;
}

/**
 * 런타임에 맞는 브리지. Tauri 웹뷰 안이면 항상 키체인 구현이고 메모리 구현으로 조용히 떨어지지 않는다.
 */
export function createNativeBridge(options: CreateBridgeOptions = {}): NativeBridge {
  return isTauriRuntime(options.scope) ? createTauriBridge(options.invoke) : createWebBridge();
}

export interface CreatePlatformAdaptersOptions extends CreateBridgeOptions {
  /** 웹 어댑터 팩토리(072 `createWebAdapters`가 들어올 자리). 없으면 웹에서 NOT_SUPPORTED. */
  web?: () => PlatformAdapters;
}

/**
 * 런타임에 맞는 어댑터 5종. 플랫폼 판정은 이 함수와 createNativeBridge 두 곳뿐이다.
 * Tauri 웹뷰 안이면 항상 설치형 구현(웹·메모리 구현으로 떨어지지 않음).
 */
export function createPlatformAdapters(options: CreatePlatformAdaptersOptions = {}): PlatformAdapters {
  if (isTauriRuntime(options.scope)) return createTauriAdapters(options.invoke);
  if (!options.web) throw new BridgeError("NOT_SUPPORTED");
  return options.web();
}
