// 로그인·온보딩 상태기계(순수 TS, React 없음). 데스크톱 /login·/onboarding과 웹 /login?step=…이 같은 규칙을 쓴다.
// 근거: 03_SCREENS_UX.md 2.1절(5~7단계)·3.1절(오류 표)·3.2절(온보딩 3단계). 권한 판정은 서버(session_context)이고,
// 이 상태기계는 화면 진행만 정한다(클라이언트 게이트는 보안 경계가 아니다 — 약관 DB 강제는 tasks/logs/AR-06-008.md 참고).
import type { FinishResult, FinishSession } from "./finish.ts";

export type OnboardingStep = "terms" | "ai" | "start";

/** 03장 3.1절 오류 코드 + finish 응답 코드. */
export type LoginErrorCode = "callback" | "state" | "provider" | "email_in_use" | "no_return" | "email_unconfirmed" | "no_profile" | "suspended" | "login_failed" | "network";

export const LOGIN_ERROR_TEXT: Readonly<Record<LoginErrorCode, string>> = {
  callback: "로그인을 끝내지 못했습니다. 다시 시도하세요.",
  state: "로그인 요청이 만료되었습니다. 처음부터 다시 시작하세요.",
  provider: "이 앱에서 쓰지 않는 로그인 방법입니다. Google 또는 이메일로 로그인하세요.",
  email_in_use: "이 이메일은 다른 로그인 방법으로 가입되어 있습니다. 그 방법으로 로그인한 뒤 연결하세요.",
  no_return: "앱으로 돌아오지 못했습니다. 브라우저 주소창의 앱 열기 허용을 확인하거나 다시 시도하세요.",
  email_unconfirmed: "가입 확인 메일의 링크를 누른 뒤 로그인하세요.",
  no_profile: "계정 정보를 만들지 못했습니다. 다시 로그인하세요.",
  suspended: "사용할 수 없는 계정 상태입니다.",
  login_failed: "로그인하지 못했습니다. 다시 시도하세요.",
  network: "서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.",
};

export interface OnboardingProgress {
  readonly step: OnboardingStep;
  readonly termsAccepted: boolean;
  /** null = 아직 선택 안 함(또는 역할상 건너뜀). */
  readonly crossBorderAck: boolean | null;
}

export type AuthState =
  | { readonly kind: "signed_out"; readonly error: LoginErrorCode | null }
  | { readonly kind: "signing_in" }
  | { readonly kind: "finishing" }
  | { readonly kind: "onboarding"; readonly session: FinishSession; readonly progress: OnboardingProgress }
  | { readonly kind: "ready"; readonly session: FinishSession; readonly next: string }
  | { readonly kind: "signing_out" };

export type AuthEvent =
  | { readonly type: "SIGN_IN_START" }
  | { readonly type: "SIGN_IN_OK" }
  | { readonly type: "SIGN_IN_FAILED"; readonly code: LoginErrorCode }
  | { readonly type: "FINISH_OK"; readonly result: FinishResult }
  | { readonly type: "FINISH_FAILED"; readonly code: LoginErrorCode }
  | { readonly type: "ACCEPT_TERMS"; readonly allChecked: boolean }
  | { readonly type: "SET_CROSS_BORDER"; readonly ack: boolean }
  | { readonly type: "SKIP_CROSS_BORDER" }
  | { readonly type: "START" }
  | { readonly type: "SIGN_OUT" }
  | { readonly type: "SIGNED_OUT" };

export const INITIAL_AUTH_STATE: AuthState = { kind: "signed_out", error: null };

/** 국외 이전 동의는 owner·admin만 설정한다(03장 2.1 6단계). 나머지는 이 단계를 건너뛴다. */
export function canSetCrossBorder(session: FinishSession): boolean {
  return session.org?.role === "owner" || session.org?.role === "admin";
}

/** 클라이언트 AI 호출 전 확인(서버가 다시 판정한다): 약관 동의 전에는 어떤 AI 호출도 시작하지 않는다. */
export function aiCallsAllowed(state: AuthState): boolean {
  return state.kind === "ready";
}

/** 국외 이전 동의 여부에 따른 AI 경로 표시(서버 resolve_ai_route가 실제로 고른다). */
export function aiRouteHint(progress: OnboardingProgress): "commercial_allowed" | "open_source_only" {
  return progress.crossBorderAck === true ? "commercial_allowed" : "open_source_only";
}

function afterFinish(result: FinishResult): AuthState {
  if (result.needsOnboarding) {
    return { kind: "onboarding", session: result.session, progress: { step: "terms", termsAccepted: false, crossBorderAck: null } };
  }
  return { kind: "ready", session: result.session, next: result.next };
}

/** 전이 함수. 허용되지 않은 이벤트는 상태를 바꾸지 않는다(같은 객체 반환). */
export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  if (event.type === "SIGN_OUT") return state.kind === "signing_out" ? state : { kind: "signing_out" };
  if (event.type === "SIGNED_OUT") return state.kind === "signing_out" ? INITIAL_AUTH_STATE : state;

  switch (state.kind) {
    case "signed_out":
      return event.type === "SIGN_IN_START" ? { kind: "signing_in" } : state;
    case "signing_in":
      if (event.type === "SIGN_IN_OK") return { kind: "finishing" };
      if (event.type === "SIGN_IN_FAILED") return { kind: "signed_out", error: event.code };
      return state;
    case "finishing":
      if (event.type === "FINISH_OK") return afterFinish(event.result);
      // finish 실패(no_profile 등)는 로그인 실패로 되돌린다. 호출자는 이 전이 뒤 반드시 signOut(clearSecrets)을 부른다.
      if (event.type === "FINISH_FAILED") return { kind: "signed_out", error: event.code };
      return state;
    case "onboarding": {
      const { progress, session } = state;
      if (progress.step === "terms") {
        if (event.type !== "ACCEPT_TERMS" || !event.allChecked) return state;
        const step: OnboardingStep = canSetCrossBorder(session) ? "ai" : "start";
        return { ...state, progress: { ...progress, step, termsAccepted: true } };
      }
      if (progress.step === "ai") {
        if (!progress.termsAccepted) return state;
        if (event.type === "SET_CROSS_BORDER" && canSetCrossBorder(session)) {
          return { ...state, progress: { ...progress, step: "start", crossBorderAck: event.ack } };
        }
        if (event.type === "SKIP_CROSS_BORDER") return { ...state, progress: { ...progress, step: "start" } };
        return state;
      }
      if (event.type === "START" && progress.termsAccepted) return { kind: "ready", session, next: "/projects" };
      return state;
    }
    case "ready":
    case "signing_out":
      return state;
  }
}

/** finish 응답 오류 코드(api-client ApiError.code) → 화면 오류 코드. */
export function loginErrorFromApi(code: string): LoginErrorCode {
  switch (code) {
    case "provider":
    case "no_profile":
    case "suspended":
      return code;
    case "inactive":
    case "pending":
      return "suspended";
    case "network_offline":
    case "server_error":
    case "queue_expired":
      return "network";
    default:
      return "login_failed";
  }
}
