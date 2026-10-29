// 라우트 가드 판정(순수). 03장 2.1절 3~7단계: 비로그인 → /login, 첫 로그인(온보딩 미완료) → /onboarding.
// 입력은 008 상태기계(AuthState)와 세션 복구 중 여부. 클라이언트 가드는 보안 경계가 아니다(권한은 서버·Rust가 판정, 008 주석).
// 미해결(후속): 영구 라이선스를 활성화한 PC의 "로그인 없이 로컬 화면"(03장 1.1절 :37)은 041 라이선스 판정이 셸에 연결될 때 여기서 분기한다.
import type { AuthState } from "../auth/index.ts";

export type GuardDecision =
  | { readonly kind: "render" }
  | { readonly kind: "loading" }
  | { readonly kind: "redirect"; readonly to: string };

const RENDER: GuardDecision = { kind: "render" };
const LOADING: GuardDecision = { kind: "loading" };
const to = (path: string): GuardDecision => ({ kind: "redirect", to: path });

/** 셸 밖(전체 화면) 경로. */
export const PUBLIC_PATHS = ["/login", "/onboarding"] as const;

/** ready 뒤 이동할 곳: finish의 next(같은 출처 경로만, 008 parseFinishData가 검사), 셸 밖 경로면 /projects. */
function home(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") && !PUBLIC_PATHS.some((p) => next.startsWith(p)) ? next : "/projects";
}

export function decideRoute(state: AuthState, pathname: string, booting: boolean): GuardDecision {
  if (booting) return LOADING;
  const onLogin = pathname === "/login";
  const onOnboarding = pathname === "/onboarding";
  switch (state.kind) {
    case "signed_out":
      return onLogin ? RENDER : to("/login");
    case "signing_in":
    case "finishing":
      // 로그인 화면은 대기 표시를 직접 그린다. 다른 경로는 끝날 때까지 로딩.
      return onLogin ? RENDER : LOADING;
    case "onboarding":
      return onOnboarding ? RENDER : to("/onboarding");
    case "ready":
      return onLogin || onOnboarding ? to(home(state.next)) : RENDER;
    case "signing_out":
      return LOADING;
  }
}
