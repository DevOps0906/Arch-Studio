// @arch-studio/shell-bridge 공개 API(AR-06-005). 테스트 더블은 `./testing` 하위 경로에만 있다.
export {
  createNativeBridge,
  createTauriBridge,
  createWebBridge,
  type Capabilities,
  type CreateBridgeOptions,
  type NativeBridge,
} from "./bridge.ts";
export {
  BridgeError,
  type BridgeErrorCode,
  type ExportErrorCode,
  type LicenseErrorCode,
  type SecretErrorCode,
} from "./errors.ts";
export { EXPORT_FORMATS, EXPORT_MAX_BYTES, type ExportFormat, type ExportResult, type Exporter } from "./exporter.ts";
export type { LicenseClient, LicenseState, LicenseStatus } from "./license-client.ts";
export {
  AUTH_PKCE_KEY,
  AUTH_STORAGE_KEY,
  MAX_SECRET_BYTES,
  MemorySecureStore,
  SECRET_KEYS,
  clearAllSecrets,
  isSecretKey,
  type SecretKey,
  type SecureStore,
} from "./secure-store.ts";
export {
  createArchSupabaseClient,
  createAuthStorage,
  MAX_PKCE_FLOWS,
  type ArchSupabaseOptions,
  type AuthStorageAdapter,
} from "./supabase/client.ts";
export type { InvokeFn } from "./tauri/invoke.ts";
