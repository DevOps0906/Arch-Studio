import { useEffect } from "react";
import { useNav } from "../nav.tsx";
import { smokeFinish, smokeStep } from "../smoke.ts";

export default function Plans() {
  const nav = useNav();
  useEffect(() => {
    smokeStep({ at: "plans", pathname: nav.pathname, params: nav.params, data: nav.data });
    smokeFinish();
  }, [nav]);
  return (
    <main>
      <h1>평면 {nav.params.id}</h1>
    </main>
  );
}
