// 03_SCREENS_UX.md 1.1절 데스크톱 경로. 화면은 모두 지연 로드하고, 각 screens/*.tsx는 features 진입점의 얇은 래퍼다
// (화면 작성 규약: packages/features/README.md). 셸(AuthGate·AppShell·ProjectShell)은 첫 화면이라 바로 불러온다.
import { AppShell, AuthGate, ProjectShell } from "@arch-studio/features/shell";
import { Navigate, createBrowserRouter, type RouteObject } from "react-router";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AuthGate />,
    // 첫 화면 지연 로드 동안은 빈 화면(HydrateFallback)을 둔다.
    HydrateFallback: () => null,
    children: [
      // 셸 밖(전체 화면, 8.7절 표)
      { path: "login", lazy: () => import("./screens/login.tsx") },
      { path: "onboarding", lazy: () => import("./screens/onboarding.tsx") },
      ...(import.meta.env.DEV ? [{ path: "dev/judgment", lazy: () => import("../../../../packages/features/src/judgment/preview.tsx") }] : []), // 개발 전용(AR-06-037), 릴리스 번들 제외
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          { path: "projects", lazy: () => import("./screens/projects.tsx") },
          {
            path: "projects/:id",
            element: <ProjectShell />,
            children: [
              // 탭 없이 열면 모델·판정(2.1절 KPI: 첫 판정까지). 마지막 탭 기억은 AR-06-034.
              { index: true, element: <Navigate to="model" replace /> },
              { path: "site", lazy: () => import("./screens/site.tsx") },
              { path: "model", lazy: () => import("./screens/model.tsx") },
              { path: "program", lazy: () => import("./screens/program.tsx") },
              { path: "plans", lazy: () => import("./screens/plans.tsx") },
              { path: "sheets", lazy: () => import("./screens/sheets.tsx") },
              { path: "render", lazy: () => import("./screens/render.tsx") },
              { path: "proposal", lazy: () => import("./screens/proposal.tsx") },
              { path: "review", lazy: () => import("./screens/review.tsx") },
            ],
          },
          { path: "chat", lazy: () => import("./screens/chat.tsx") },
          { path: "wiki", lazy: () => import("./screens/wiki.tsx") },
          { path: "settings", element: <Navigate to="/settings/general" replace /> },
          { path: "settings/drafting", lazy: () => import("./screens/settings-drafting.tsx") },
          { path: "settings/general", lazy: () => import("./screens/settings-general.tsx") },
          { path: "license", lazy: () => import("./screens/license.tsx") },
          { path: "credits", lazy: () => import("./screens/credits.tsx") },
          { path: "*", lazy: () => import("./screens/not-found.tsx") },
        ],
      },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
