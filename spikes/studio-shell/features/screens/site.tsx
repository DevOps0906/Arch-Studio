import { useEffect } from "react";
import { useNav, type Params } from "../nav.tsx";
import { smokeActive, smokeStep } from "../smoke.ts";

export async function loader(params: Params, signal: AbortSignal) {
  await new Promise((r) => setTimeout(r, 20));
  if (signal.aborted) throw new Error("aborted");
  return { projectId: params.id, area: 500 };
}

export default function Site() {
  const nav = useNav();
  const d = nav.data as { projectId: string; area: number } | undefined;
  useEffect(() => {
    smokeStep({ at: "site", pathname: nav.pathname, params: nav.params, data: nav.data });
    if (smokeActive()) nav.navigate(`/projects/${nav.params.id}/plans`);
  }, [nav]);
  return (
    <main>
      <h1>대지 {nav.params.id}</h1>
      <p id="site-data">{d ? `${d.projectId}:${d.area}` : "데이터 없음"}</p>
    </main>
  );
}
