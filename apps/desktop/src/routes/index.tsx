// 03_SCREENS_UX.md 1.1절 데스크톱 경로. 화면은 모두 지연 로드한다.
import { Navigate, createBrowserRouter } from "react-router";

// 첫 화면 지연 로드 동안은 빈 화면(HydrateFallback)을 둔다.
export const router = createBrowserRouter([
  {
    path: "/",
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: "login", lazy: () => import("./screens/login.tsx") },
      { path: "onboarding", lazy: () => import("./screens/onboarding.tsx") },
      { path: "projects", lazy: () => import("./screens/projects.tsx") },
      {
        path: "projects/:id",
        children: [
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
      { path: "settings/drafting", lazy: () => import("./screens/settings-drafting.tsx") },
      { path: "settings/general", lazy: () => import("./screens/settings-general.tsx") },
      { path: "license", lazy: () => import("./screens/license.tsx") },
      { path: "credits", lazy: () => import("./screens/credits.tsx") },
      { path: "*", lazy: () => import("./screens/not-found.tsx") },
    ],
  },
]);
