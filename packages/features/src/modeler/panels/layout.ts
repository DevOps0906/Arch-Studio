// 화면 폭 구간(6.4절 웹 스튜디오 배치표): ~767 좁음 / 768~1199 중간 / 1200~ 넓음. 경계 값은 토큰(--breakpoint-md·xl)에서 읽는다.
import { useEffect, useState } from "react";

export type LayoutKind = "narrow" | "medium" | "wide";

/** 폭(CSS px)과 구간 경계 → 배치(순수). */
export function layoutFor(width: number, md: number, xl: number): LayoutKind {
  return width >= xl ? "wide" : width >= md ? "medium" : "narrow";
}

function readBreakpoint(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const v = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 지금 배치. 폭이 바뀌면 다시 그린다(상태·선택·카메라는 부모가 유지). */
export function useLayoutKind(): LayoutKind {
  const [kind, setKind] = useState<LayoutKind>(() => (typeof window === "undefined" ? "wide" : layoutFor(window.innerWidth, readBreakpoint("--breakpoint-md", 768), readBreakpoint("--breakpoint-xl", 1200))));
  useEffect(() => {
    const md = readBreakpoint("--breakpoint-md", 768);
    const xl = readBreakpoint("--breakpoint-xl", 1200);
    const update = () => setKind(layoutFor(window.innerWidth, md, xl));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return kind;
}
