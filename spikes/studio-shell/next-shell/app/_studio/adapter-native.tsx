"use client";
// Next 방식 C 어댑터: 경로별 page.tsx(코드 생성) + next/navigation. Next가 페이지 단위로 청크를 나눈다.
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NavContext, type Params, type StudioNav } from "../../../features/nav.tsx";
import type { ScreenModule } from "../../../features/routes.ts";

function normalize(p: Record<string, string | string[] | undefined>): Params {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v)) out["*"] = v.map(decodeURIComponent).join("/");
    else out[k] = v === undefined ? undefined : decodeURIComponent(v);
  }
  return out;
}

export function NativeRoute({ mod, base }: { mod: ScreenModule; base: string }) {
  const rawParams = useParams();
  const full = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const key = JSON.stringify(rawParams);
  const params = useMemo(() => normalize(rawParams), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // 로더: Next에는 클라이언트 loader 개념이 없어 어댑터가 렌더 전에 직접 호출한다(SSR 시 데이터 없음).
  const [data, setData] = useState<{ key: string; value: unknown } | null>(mod.loader ? null : { key, value: undefined });
  useEffect(() => {
    if (!mod.loader) return;
    const ac = new AbortController();
    mod.loader(params, ac.signal).then((value) => !ac.signal.aborted && setData({ key, value }), () => {});
    return () => ac.abort();
  }, [mod, params, key]);
  const search = sp.toString();
  const nav = useMemo<StudioNav>(
    () => ({
      params,
      pathname: full.slice(base.length) || "/",
      search: new URLSearchParams(search),
      navigate: (to, o) => (o?.replace ? router.replace(base + to) : router.push(base + to)),
      Link: ({ to, children, id }) => (
        <Link href={base + to} id={id}>
          {children}
        </Link>
      ),
      data: data?.value,
    }),
    [params, full, search, router, base, data],
  );
  if (!data || data.key !== key) return null;
  const Screen = mod.default;
  return (
    <NavContext value={nav}>
      <Screen />
    </NavContext>
  );
}
