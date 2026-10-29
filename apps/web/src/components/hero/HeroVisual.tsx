import type { ReactNode } from "react";
import { HERO_RENDERER, type HeroRenderer } from "./hero-mode.ts";
import { HeroStatic } from "./HeroStatic.tsx";

const LEGEND = [
  { swatch: "border-t-2 border-dashed border-site-line", label: "대지 경계(쇄선)" },
  { swatch: "border-t-2 border-dashed border-setback", label: "이격선(파선)" },
  { swatch: "border-t-4 border-envelope", label: "법규 엔벨로프" },
  { swatch: "border-t-4 border-mass", label: "매스" },
] as const;

// lib/env/public.ts 의 publicEnv 는 다른 필수 변수(Supabase·Toss)가 없으면 기동을 중단시켜
// 환경 변수 없는 빌드에서 정적 마케팅 페이지까지 깨진다. 그래서 같은 의미(스키마 flag: "false"만 끔, 기본 켬)로 이 변수만 읽는다.
// Next.js 가 번들에 치환하도록 process.env.NEXT_PUBLIC_* 를 글자 그대로 쓴다.
function heroAnimationEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HERO3D_ENABLED !== "false";
}

function renderHero(renderer: HeroRenderer, animate: boolean): ReactNode {
  switch (renderer) {
    case "svg":
    case "3d": // 3D 교체 지점: 구현 전까지 "3d"도 SVG 로 그린다.
      return <HeroStatic animate={animate} />;
  }
}

/** 랜딩 히어로 시각 요소. 표현 방식은 hero-mode.ts 의 NEXT_PUBLIC_HERO3D_ENABLED·HERO_RENDERER에서만 바꾼다. */
export function HeroVisual({
  renderer = HERO_RENDERER,
  animate = heroAnimationEnabled(),
}: {
  renderer?: HeroRenderer;
  animate?: boolean;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-card border border-line">{renderHero(renderer, animate)}</div>
      <figcaption className="flex flex-col gap-2 text-caption text-fg-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-2">
              <span aria-hidden="true" className={`inline-block w-6 ${l.swatch}`} />
              {l.label}
            </li>
          ))}
        </ul>
        <span>예시 형상 일러스트입니다. 실제 대지의 판정 결과가 아닙니다.</span>
      </figcaption>
    </figure>
  );
}
