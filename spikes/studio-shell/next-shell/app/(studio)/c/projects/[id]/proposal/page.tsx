// 생성 파일(scripts/gen.ts). 라우트 "projects/:id/proposal"
"use client";
import { Suspense } from "react";
import * as mod from "../../../../../../../features/screens/proposal.tsx";
import { NativeRoute } from "../../../../../_studio/adapter-native.tsx";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NativeRoute mod={mod} base="/c" />
    </Suspense>
  );
}
