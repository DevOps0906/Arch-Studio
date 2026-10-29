// features/auth 공개 API(AR-06-008). 패키지 루트 index 재수출은 요청 줄(소유 밖).
export { parseFinishData, requestFinishLogin, type FinishProvider, type FinishResult, type FinishSession, type OrgRole } from "./finish.ts";
export {
  aiCallsAllowed,
  aiRouteHint,
  authReducer,
  canSetCrossBorder,
  INITIAL_AUTH_STATE,
  LOGIN_ERROR_TEXT,
  loginErrorFromApi,
  type AuthEvent,
  type AuthState,
  type LoginErrorCode,
  type OnboardingProgress,
  type OnboardingStep,
} from "./machine.ts";
