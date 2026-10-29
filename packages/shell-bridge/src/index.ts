// @arch-studio/shell-bridge 공개 API(AR-06-005, 070에서 어댑터 5종 추가). 테스트 더블·계약 하네스는 `./testing` 하위 경로에만 있다.
// 080에서 Rasterizer 추가(SVG→PNG). 005 이름은 그대로 유지한다(008이 import). 새 이름은 추가만 한다.
export {
  createNativeBridge,
  createPlatformAdapters,
  createTauriBridge,
  createWebBridge,
  type Capabilities,
  type CreateBridgeOptions,
  type CreatePlatformAdaptersOptions,
  type NativeBridge,
} from "./bridge.ts";
export type { PlatformAdapters } from "./adapters/index.ts";
export {
  BridgeError,
  isBridgeError,
  type BridgeErrorCode,
  type ConfigErrorCode,
  type ExportErrorCode,
  type FileErrorCode,
  type LicenseErrorCode,
  type ProjectErrorCode,
  type RasterErrorCode,
  type SecretErrorCode,
  type UpdaterErrorCode,
} from "./adapters/errors.ts";
export {
  byCapability,
  CAPABILITY_KEYS,
  hasCapability,
  requireCapability,
  TAURI_CAPABILITIES,
  WEB_CAPABILITIES,
  type CapabilityKey,
  type PlatformCapabilities,
} from "./adapters/capabilities.ts";
export {
  EXPORT_FORMATS,
  EXPORT_MAX_BYTES,
  type ExportFormat,
  type ExportResult,
  type Exporter,
} from "./adapters/exporter.ts";
export {
  assertExportBody,
  assertImportSize,
  extensionOf,
  IMPORT_KINDS,
  IMPORT_MAX_BYTES,
  isExportFormat,
  isImportKind,
  type FileGateway,
  type ImportKind,
} from "./adapters/file-gateway.ts";
export {
  assertSaveProjectInput,
  isProjectId,
  PROJECT_LIMITS,
  type ProjectRecord,
  type ProjectStore,
  type ProjectSummary,
  type SaveProjectInput,
  type SaveProjectResult,
} from "./adapters/project-store.ts";
export {
  DENY_REASONS,
  ENTITLEMENT_FEATURES,
  type DenyReason,
  type EntitlementClient,
  type EntitlementDecision,
  type EntitlementFeature,
  type EntitlementStatus,
} from "./adapters/entitlement.ts";
export {
  assertRasterizeOptions,
  assertRasterSvg,
  RASTER_LIMITS,
  rasterizerOf,
  UNSUPPORTED_RASTERIZER,
  type RasterizeOptions,
  type Rasterizer,
} from "./adapters/rasterizer.ts";
export {
  assertRulePackUrl,
  downloadAndInstallRulePack,
  fetchRulePackText,
  RULE_PACK_INSTALL_STATES,
  RULE_PACK_LIMITS,
  RULE_PACK_LOAD_STATES,
  RulePackDownloadFailure,
  rulePacksOf,
  type LoadedRulePack,
  type RulePackDownloadError,
  type RulePackDownloadTicket,
  type RulePackFetch,
  type RulePackInstallResult,
  type RulePackInstallState,
  type RulePackLoadResult,
  type RulePackLoadState,
  type RulePackStore,
} from "./adapters/rule-packs.ts";
export type { UpdateInfo, Updater } from "./adapters/updater.ts";
export type { LicenseClient, LicenseState, LicenseStatus } from "./adapters/license-client.ts";
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
} from "./adapters/secure-store.ts";
export {
  createArchSupabaseClient,
  createAuthStorage,
  MAX_PKCE_FLOWS,
  type ArchSupabaseOptions,
  type AuthStorageAdapter,
} from "./supabase/client.ts";
export type { InvokeFn } from "./tauri/invoke.ts";
