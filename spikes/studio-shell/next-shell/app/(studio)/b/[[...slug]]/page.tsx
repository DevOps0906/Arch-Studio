"use client";
import dynamic from "next/dynamic";

const RRStudio = dynamic(() => import("../../../_studio/rr-studio.tsx"), { ssr: false });

export default function Page() {
  return <RRStudio />;
}
