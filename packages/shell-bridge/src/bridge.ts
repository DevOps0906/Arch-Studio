// NativeBridge: 화면 코드가 보는 플랫폼 경계. 같은 화면 코드가 설치형(Tauri)·웹 대체 양쪽에서 동작한다.
// 기능 코드는 `capabilities`로만 분기하고 플랫폼 이름을 직접 검사하지 않는다(ADR-001 2.1).
// 070이 어댑터 5종(ProjectStore·FileGateway·SecureStore·EntitlementClient·Updater)으로 넓힌다.
import { clearAllSecrets, MemorySecureStore, type SecureStore } from "./secure-store.ts";
import { isTauriRuntime, tauriInvoke, type InvokeFn } from "./tauri/invoke.ts";
import { TauriSecureStore } from "./tauri/secure-store.ts";

export interface Capabilities {
  /** 네트워크 없이 열기·편집(로컬 정본). */
  readonly offline: boolean;
  /** OS 파일 대화상자 경로 읽기·쓰기. */
  readonly localFiles: boolean;
  /** 서명된 앱 업데이트(updater 작업 전까지 false). */
  readonly autoUpdate: boolean;
  /** 비밀이 앱 재시작 후에도 남는가(키체인). false면 새로고침 = 재로그인. */
  readonly persistentSecrets: boolean;
}

export interface NativeBridge {
  readonly capabilities: Capabilities;
  readonly secrets: SecureStore;
  /** 로그아웃: 허용 키 전부 삭제. supabase `signOut` 성공 여부와 무관하게 부른다. */
  clearSecrets(): Promise<void>;
}

const TAURI_CAPABILITIES: Capabilities = Object.freeze({
  offline: true,
  localFiles: true,
  autoUpdate: false,
  persistentSecrets: true,
});

const WEB_CAPABILITIES: Capabilities = Object.freeze({
  offline: false,
  localFiles: false,
  autoUpdate: false,
  persistentSecrets: false,
});

function bridgeOf(capabilities: Capabilities, secrets: SecureStore): NativeBridge {
  return Object.freeze({
    capabilities,
    secrets,
    clearSecrets: () => clearAllSecrets(secrets),
  });
}

/** 설치형 브리지. invoke는 테스트에서만 주입한다. */
export function createTauriBridge(invoke: InvokeFn = tauriInvoke): NativeBridge {
  return bridgeOf(TAURI_CAPABILITIES, new TauriSecureStore(invoke));
}

/** 웹 대체 브리지: 비밀은 메모리만(영속 웹 스토리지 미사용). 웹 본 구현(httpOnly 쿠키)은 072. */
export function createWebBridge(): NativeBridge {
  return bridgeOf(WEB_CAPABILITIES, new MemorySecureStore());
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
