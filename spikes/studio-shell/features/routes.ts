// packages/features 의 라우트 정의(공유 정본). 프레임워크 비의존 메타 배열.
// path 문법: 세그먼트는 슬래시 구분, ":name" 파라미터, "*" 나머지. 03_SCREENS_UX 1.1절 데스크톱 경로와 같다.
import type { ComponentType } from "react";
import type { Params } from "./nav.tsx";

export interface ScreenModule {
  default: ComponentType;
  /** 셸이 화면 렌더 전에 호출한다(RR loader / Next 클라이언트 프리페치). */
  loader?: (params: Params, signal: AbortSignal) => Promise<unknown>;
}

export interface StudioRoute {
  id: string;
  path: string;
  load: () => Promise<ScreenModule>;
}

export const INDEX_REDIRECT = "/projects";

export const studioRoutes: readonly StudioRoute[] = [
  { id: "login", path: "login", load: () => import("./screens/login.tsx") },
  { id: "onboarding", path: "onboarding", load: () => import("./screens/onboarding.tsx") },
  { id: "projects", path: "projects", load: () => import("./screens/projects.tsx") },
  { id: "site", path: "projects/:id/site", load: () => import("./screens/site.tsx") },
  { id: "model", path: "projects/:id/model", load: () => import("./screens/model.tsx") },
  { id: "program", path: "projects/:id/program", load: () => import("./screens/program.tsx") },
  { id: "plans", path: "projects/:id/plans", load: () => import("./screens/plans.tsx") },
  { id: "sheets", path: "projects/:id/sheets", load: () => import("./screens/sheets.tsx") },
  { id: "render", path: "projects/:id/render", load: () => import("./screens/render.tsx") },
  { id: "proposal", path: "projects/:id/proposal", load: () => import("./screens/proposal.tsx") },
  { id: "review", path: "projects/:id/review", load: () => import("./screens/review.tsx") },
  { id: "chat", path: "chat", load: () => import("./screens/chat.tsx") },
  { id: "wiki", path: "wiki", load: () => import("./screens/wiki.tsx") },
  { id: "settings-drafting", path: "settings/drafting", load: () => import("./screens/settings-drafting.tsx") },
  { id: "settings-general", path: "settings/general", load: () => import("./screens/settings-general.tsx") },
  { id: "license", path: "license", load: () => import("./screens/license.tsx") },
  { id: "credits", path: "credits", load: () => import("./screens/credits.tsx") },
  { id: "not-found", path: "*", load: () => import("./screens/not-found.tsx") },
];

/** 셸 공용 매처(Next catch-all 방식에서 사용). React Router 셸은 자체 매처를 쓴다. */
export function matchRoute(appPath: string): { route: StudioRoute; params: Params } | null {
  const segs = appPath.split("/").filter(Boolean);
  for (const route of studioRoutes) {
    if (route.path === "*") return { route, params: { "*": segs.join("/") } };
    const pat = route.path.split("/");
    if (pat.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]!;
      const s = segs[i]!;
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(s);
      else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}
