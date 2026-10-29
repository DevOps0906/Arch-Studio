// @arch-studio/features/shell — 앱 셸·Provider·공용 훅·공용 상태 컴포넌트(AR-06-004b). 화면 작성 규약은 packages/features/README.md.
export { AppProviders, useAdapters, useApi, useCapabilities, useDemoMode, useDisplayPrefs, useEngine, useEntitlement, useEntitlementStatus, useOnline, useSession } from "./context.tsx";
export type { CapabilitiesValue, SessionValue } from "./context.tsx";
export { AppShell, AuthGate, useShellStatus } from "./AppShell.tsx";
export { ProjectShell } from "./ProjectShell.tsx";
export { ProjectProvider, useProject, type ProjectLoad, type ProjectValue } from "./project.tsx";
export {
  EmptyBlock,
  ErrorState,
  FullScreenLoading,
  LoadingState,
  LockedState,
  PageHeader,
  PlaceholderScreen,
  usePreviewState,
  type PlaceholderSpec,
  type PreviewState,
} from "./states.tsx";
export { ShellIcon, type ShellIconName } from "./icons.tsx";
export { bridgeErrorCode, bridgeErrorText, type BridgeErrorCode } from "./errors.ts";
export { byCap, hasCap, type CapabilityKey, type PlatformCapabilities } from "./capabilities.ts";
export { decideRoute, type GuardDecision } from "./guard.ts";
export { DENY_TEXT, NAV_ITEMS, PROJECT_TABS, lockOf, projectIdOf, type LockState, type NavItem, type ProjectTab } from "./nav.ts";
export { DEFAULT_PREFS, type DensityPref, type DisplayPrefs, type ThemePref } from "./prefs.ts";
export type { ApiConfig, AuthPort, EngineHost, EngineRequestLike, EngineResponseLike, ShellAdapters, ShellRuntime, SignInOutcome } from "./types.ts";
