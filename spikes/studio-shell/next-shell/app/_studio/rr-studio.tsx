"use client";
// Next 방식 B: catch-all 안에서 React Router를 그대로 구동(SSR 끔). Vite 셸과 같은 RouteObject를 쓴다.
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { buildRRRoutes } from "../../../rr-adapter/routes.tsx";

const router = createBrowserRouter(buildRRRoutes(), { basename: "/b" });

export default function RRStudio() {
  return <RouterProvider router={router} />;
}
