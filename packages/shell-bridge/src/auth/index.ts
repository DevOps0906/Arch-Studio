// shell-bridge 인증 경계(AR-06-008 Stage A). 루트 index에는 아직 내보내지 않는다(패키지 exports `./auth` 추가는 요청 줄).
// dev-mock.ts는 여기서 정적으로 내보내지 않는다(릴리스 번들 제거를 위해 loadDevMockAuth의 동적 import로만 도달).
export { desktopAuthMode, loadDevMockAuth, type DesktopAuthMode, type DevMockOptions } from "./mode.ts";
export type { DevMockAuth, DevPersonaKey, DevSignInResult } from "./dev-mock.ts";
export { createDesktopAuthSession, type DesktopAuthSession } from "./session.ts";
