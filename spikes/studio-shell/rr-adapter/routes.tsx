// React Router 어댑터: 공유 라우트 메타 -> RouteObject[]. Vite 셸과 Next 방식 B가 같이 쓴다.
import { useMemo, type ReactNode } from "react";
import { Link, Navigate, useLoaderData, useLocation, useNavigate, useParams, type RouteObject } from "react-router";
import { NavContext, type StudioNav } from "../features/nav.tsx";
import { INDEX_REDIRECT, studioRoutes } from "../features/routes.ts";

const RRLink: StudioNav["Link"] = ({ to, children, id }) => (
  <Link to={to} id={id}>
    {children}
  </Link>
);

function RRNavProvider({ children }: { children: ReactNode }) {
  // useParams()는 내비게이션 상태가 바뀔 때마다 새 객체를 준다 → 값 기준으로 고정(안 하면 화면 effect가 반복 실행).
  const rawParams = useParams();
  const pkey = JSON.stringify(rawParams);
  const params = useMemo(() => rawParams, [pkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const loc = useLocation();
  const navigate = useNavigate();
  const data = useLoaderData();
  const value = useMemo<StudioNav>(
    () => ({
      params,
      pathname: loc.pathname,
      search: new URLSearchParams(loc.search),
      navigate: (to, o) => void navigate(to, { replace: o?.replace }),
      Link: RRLink,
      data,
    }),
    [params, loc.pathname, loc.search, navigate, data],
  );
  return <NavContext value={value}>{children}</NavContext>;
}

export function buildRRRoutes(): RouteObject[] {
  return [
    {
      path: "/",
      HydrateFallback: () => null,
      children: [
        { index: true, element: <Navigate to={INDEX_REDIRECT} replace /> },
        ...studioRoutes.map<RouteObject>((r) => ({
          path: r.path,
          lazy: async () => {
            const m = await r.load();
            const Screen = m.default;
            const loader = m.loader;
            return {
              Component: () => (
                <RRNavProvider>
                  <Screen />
                </RRNavProvider>
              ),
              loader: loader ? ({ params, request }) => loader(params, request.signal) : undefined,
            };
          },
        })),
      ],
    },
  ];
}
