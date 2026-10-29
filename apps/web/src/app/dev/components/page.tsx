import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Showcase, type Density, type Theme } from "./Showcase";

// 개발 전용: 프로덕션 빌드·실행에서는 항상 404(NODE_ENV는 빌드 시 인라인돼 아래 렌더 경로가 제거된다).
export const metadata: Metadata = { title: "컴포넌트 미리보기 (개발 전용)", robots: { index: false, follow: false } };

export default async function DevComponentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const theme: Theme = sp.theme === "dark" ? "dark" : "light";
  const density: Density = sp.density === "compact" ? "compact" : "default";
  return <Showcase initialTheme={theme} initialDensity={density} />;
}
