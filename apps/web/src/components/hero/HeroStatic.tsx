// 정지 히어로 일러스트: 대지 경계(1점 쇄선) → 이격선(파선) → 법규 엔벨로프(청록 반투명) → 매스.
// 손으로 그린 예시 형상이며 엔진 출력이 아니다. 색·선 종류는 토큰만 쓴다(tokens.css).
const DASH_SITE = { strokeDasharray: "var(--line-dash-site)" } as const;
const DASH_SETBACK = { strokeDasharray: "var(--line-dash-setback)" } as const;
const ENVELOPE_FILL = { fillOpacity: "var(--envelope-fill-opacity)" } as const;

const SITE = "110,320 420,350 540,290 470,215 160,225";
const SETBACK = "140,312 412,338 515,288 455,228 180,236";
const ENV_TOP = "110,170 420,200 540,140 470,155 160,165";
const ENV_FRONT_A = "110,320 420,350 420,200 110,170";
const ENV_FRONT_B = "420,350 540,290 540,140 420,200";
const MASS_BASE = "195,292 365,309 415,272 395,240 220,248";
const MASS_TOP = "195,222 365,239 415,202 395,170 220,178";
const MASS_FRONT_A = "195,292 365,309 365,239 195,222";
const MASS_FRONT_B = "365,309 415,272 415,202 365,239";

// 연출은 한 번뿐인 CSS 애니메이션이다(엔벨로프가 바닥에서 솟음). 스크립트가 필요 없고,
// 모션 줄이기 설정이면 규칙 자체가 적용되지 않아 처음부터 완성된 모습이다. 시작 상태를 숨기는 CSS는 없다.
const MOTION_CSS = `
@media (prefers-reduced-motion: no-preference) {
  .hero-rise { transform-box: fill-box; transform-origin: 50% 100%; animation: hero-rise 1.4s var(--ease-out) 1 both; }
  .hero-mass { animation: hero-fade 0.8s ease-out 0.9s 1 both; }
}
@keyframes hero-rise { from { transform: scaleY(0.02); } to { transform: scaleY(1); } }
@keyframes hero-fade { from { opacity: 0; } to { opacity: 1; } }
`;

/** animate=false 면 연출용 클래스와 규칙을 모두 빼고 마지막 프레임만 그린다. */
export function HeroStatic({ animate = true }: { animate?: boolean }) {
  return (
    <svg
      viewBox="0 0 640 430"
      role="img"
      aria-label="예시 일러스트: 대지 경계와 이격선 위로 법규 엔벨로프가 솟고 그 안에 매스가 놓인 모습. 실제 판정 결과가 아닙니다."
      className="h-auto w-full"
    >
      {animate ? <style>{MOTION_CSS}</style> : null}
      <defs>
        <pattern id="hero-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" className="stroke-grid" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="640" height="430" className="fill-bg-deep" />
      <rect width="640" height="430" fill="url(#hero-grid)" opacity="0.6" />

      <g fill="none" strokeLinejoin="round">
        <polygon points={SITE} className="stroke-site-line" strokeWidth="2" style={DASH_SITE} />
        <polygon points={SETBACK} className="stroke-setback" strokeWidth="2" style={DASH_SETBACK} />

        <g className={`${animate ? "hero-rise " : ""}fill-envelope stroke-envelope`} strokeWidth="1.5" style={ENVELOPE_FILL}>
          <polygon points={ENV_FRONT_A} />
          <polygon points={ENV_FRONT_B} />
          <polygon points={ENV_TOP} />
        </g>

        <g className={`${animate ? "hero-mass " : ""}fill-mass stroke-mass-edge`} strokeWidth="1.5">
          <polygon points={MASS_BASE} />
          <polygon points={MASS_FRONT_A} />
          <polygon points={MASS_FRONT_B} />
          <polygon points={MASS_TOP} className="fill-room" />
        </g>

        <path d="M110 372L420 402M110 364V380M420 394V410" className="stroke-fg-3" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
