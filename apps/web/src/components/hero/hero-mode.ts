// 히어로 표현 방식.
// 킬 스위치: 공개 env 플래그 NEXT_PUBLIC_HERO3D_ENABLED(lib/env/public.ts, 기본 true).
// 이름은 3D 시절 그대로지만 지금 뜻은 "히어로 CSS/SVG 연출 on/off"다. false 면 연출 없이 마지막 프레임(정지 이미지)만 그린다.
// 모션 줄이기 설정과 스크립트 비활성에서는 플래그와 무관하게 정지 상태다(CSS 미디어 쿼리로만 연출).
// NEXT_PUBLIC_HERO_VIDEO_ENABLED 는 영상을 채택하지 않아 읽지 않는다.
//
// 3D 교체 지점: HeroVisual.tsx 의 renderHero. 실시간 3D(three/R3F)는 아직 구현하지 않았다.
// 붙일 때 "3d" 분기를 따로 만들고, 실패·저사양·reduced-motion 이면 HeroStatic 으로 되돌린다.
export type HeroRenderer = "svg" | "3d";

/** 현재 렌더러. 3D 구현 전까지 "svg" 고정. */
export const HERO_RENDERER: HeroRenderer = "svg";
