// 생성 파일(scripts/gen.ts). 라우트 "onboarding"
"use client";
import { Suspense } from "react";
import * as mod from "../../../../../features/screens/onboarding.tsx";
import { NativeRoute } from "../../../_studio/adapter-native.tsx";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NativeRoute mod={mod} base="/c" />
    </Suspense>
  );
}
