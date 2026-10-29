import { useEffect } from "react";
import { useNav } from "../nav.tsx";
import { smokeStart, smokeStep } from "../smoke.ts";

export default function Projects() {
  const nav = useNav();
  useEffect(() => {
    const started = smokeStart(nav.search);
    smokeStep({ at: "projects", pathname: nav.pathname, params: nav.params, data: nav.data });
    if (started) document.getElementById("open-42")?.click();
  }, [nav]);
  return (
    <main>
      <h1>프로젝트</h1>
      <nav.Link to="/projects/42/site" id="open-42">
        프로젝트 42 대지
      </nav.Link>
    </main>
  );
}
