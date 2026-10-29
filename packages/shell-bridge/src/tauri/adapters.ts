// 설치형 PlatformAdapters 조립. 모든 Rust 호출은 주입된 InvokeFn(기본 `tauriInvoke`) 하나를 거친다.
import { TAURI_CAPABILITIES } from "../adapters/capabilities.ts";
import type { PlatformAdapters } from "../adapters/index.ts";
import { clearAllSecrets } from "../adapters/secure-store.ts";
import { TauriEntitlementClient } from "./entitlement.ts";
import { TauriFileGateway } from "./file-gateway.ts";
import { tauriInvoke, type InvokeFn } from "./invoke.ts";
import { TauriProjectStore } from "./project-store.ts";
import { TauriSecureStore } from "./secure-store.ts";

/** 설치형 어댑터 5종. invoke는 테스트에서만 주입한다. */
export function createTauriAdapters(invoke: InvokeFn = tauriInvoke): PlatformAdapters {
  const secrets = new TauriSecureStore(invoke);
  return Object.freeze({
    capabilities: TAURI_CAPABILITIES,
    projects: new TauriProjectStore(invoke),
    files: new TauriFileGateway(invoke),
    secrets,
    entitlement: new TauriEntitlementClient(null),
    updater: null,
    clearSecrets: () => clearAllSecrets(secrets),
  });
}
