import { Suspense } from "react";
import { CatchAllStudio } from "../../../_studio/adapter-catchall.tsx";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CatchAllStudio base="/a" />
    </Suspense>
  );
}
