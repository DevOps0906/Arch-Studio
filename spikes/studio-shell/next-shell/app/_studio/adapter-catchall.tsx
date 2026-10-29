"use client";
// Next 방식 A 어댑터: optional catch-all 하나 + 공유 매처 + 동적 import. 이동은 history.pushState
// (Next 14.1+ 가 usePathname과 동기화, 서버 RSC 왕복 없음).
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { NavContext, type Params, type StudioNav } from "../../../features/nav.tsx";
import { INDEX_REDIRECT, matchRoute, type ScreenModule } from "../../../features/routes.ts";

// search도 로드 시점 값으로 고정: 이동 직후 새 URL의 search가 이전 화면에 먼저 보이면 화면 effect가 다시 돈다.
type Loaded = { path: string; search: string; mod: ScreenModule; params: Params; data: unknown };

export function CatchAllStudio({ base }: { base: string }) {
  const full = usePathname();
  const search = useSearchParams().toString();
  const appPath = full.slice(base.length) || "/";
  const [cur, setCur] = useState<Loaded | null>(null);

  useEffect(() => {
    if (appPath === "/") {
      window.history.replaceState(null, "", base + INDEX_REDIRECT);
      return;
    }
    const m = matchRoute(appPath);
    if (!m) return;
    const ac = new AbortController();
    void (async () => {
      const mod = await m.route.load();
      const data = mod.loader ? await mod.loader(m.params, ac.signal) : undefined;
      if (!ac.signal.aborted) setCur({ path: appPath, search, mod, params: m.params, data });
    })();
    return () => ac.abort();
  }, [appPath, search, base]);

  const nav = useMemo<StudioNav | null>(() => {
    if (!cur) return null;
    const go = (to: string, replace?: boolean) => window.history[replace ? "replaceState" : "pushState"](null, "", base + to);
    return {
      params: cur.params,
      pathname: cur.path,
      search: new URLSearchParams(cur.search),
      navigate: (to, o) => go(to, o?.replace),
      Link: ({ to, children, id }) => (
        <a
          href={base + to}
          id={id}
          onClick={(e: MouseEvent) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            go(to);
          }}
        >
          {children}
        </a>
      ),
      data: cur.data,
    };
  }, [cur, base]);

  if (!cur || !nav) return null;
  const Screen = cur.mod.default;
  return (
    <NavContext value={nav}>
      <Screen />
    </NavContext>
  );
}
