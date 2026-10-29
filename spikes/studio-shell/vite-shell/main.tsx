import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { buildRRRoutes } from "../rr-adapter/routes.tsx";

const router = createBrowserRouter(buildRRRoutes());
const root = document.getElementById("root");
if (!root) throw new Error("#root 요소가 없다.");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
