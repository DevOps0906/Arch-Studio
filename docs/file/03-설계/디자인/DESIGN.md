# DESIGN.md — arch-studio 디자인 토큰 (확정 2026-10-29, AR-06-012)

> 정답 소스는 코드다: `packages/ui/src/tokens.css`(Tailwind CSS v4 `@theme`). 이 문서는 코드에서 갱신하고, 다르면 코드가 이긴다.
> 수치(hex·크기)는 이 문서에 적지 않는다. 값은 자동 생성 표 [`docs/DESIGN_TOKENS.md`](../../../DESIGN_TOKENS.md)(`design-preview --md`)와 `tokens.css`에서 본다. 컴포넌트 목록은 `COMPONENTS.md`.
> 규칙: `docs/file/03-설계/디자인/DESIGN_SYSTEM.md`. 피그마 노드 ID나 외부 파일 링크를 적지 않는다.

## 1. 레퍼런스와 방향

근거: 화면설계서 3.19절(앱 주 레퍼런스)·4.1절(랜딩 레퍼런스), `DESIGN_SYSTEM.md` 4장 1단계·5장. 확정 시안이 레퍼런스보다 우선한다: 랜딩 `design/reference/landing/`(다크 단일), 앱 `design/reference/dashboard/`(라이트, GNB 펼침 = `--sidebar-w`). 레퍼런스가 시안과 어긋나면 레퍼런스를 버린다. 수치(색·크기)는 이 절이 아니라 `packages/ui/src/tokens.css`가 정한다.

### 1.1 앱 주 레퍼런스

| 화면 | 주 레퍼런스 | 가져올 것 | 가져오지 않을 것 |
|---|---|---|---|
| 모델러·평면·도면(작업 화면) | Atlassian + Primer | Atlassian: 복잡한 폼과 상태 흐름, 패널 중첩(속성 인스펙터·레이어 패널·시트 미리보기). Primer: 정보 밀도, 상태 표시(판정 배지는 색 + 아이콘 + 글자, 색만으로 구분하지 않음) | 두 시스템의 라이브러리 설치(Atlaskit·Primer React. 기반은 shadcn/ui를 토큰으로 재스타일, `DESIGN_SYSTEM.md` 3장), 브랜드 색·서체·로고, Octicons 등 아이콘(Lucide만) |
| 목록·라이선스·크레딧 | Primer | 컴팩트 표(행 선택, 페이지네이션), 상태 배지, tabular 숫자 | GitHub 화면 구성·브랜드 색, 모든 지표를 같은 카드로 늘어놓는 카드 키트 |
| 채팅·음성·위키(AI 화면) | Astryx(MIT 베타) — 패턴만, 설치 안 함 | 메시지 스레드 구조, "AI 답변" 표시와 출처 칩, 근거 없음 답의 처리, 입력창 옵션(맥락 첨부·마이크·읽어 주기) | 패키지 설치와 코드 복사, 시각 스타일(색·서체·반경은 제품 토큰), 브랜드 자산. AI 화면이라도 밀도는 Primer 기준 |

### 1.2 랜딩 레퍼런스 (`REFERENCES.md`에 있는 URL만)

| 레퍼런스 | 가져올 것 | 가져오지 않을 것 |
|---|---|---|
| `DESIGN_PRINCIPLES.md` + `HERO_3D.md` | 연출 순간 하나(히어로의 엔벨로프가 솟는 순간), 생성형 기본값 회피 검토, 3D 히어로 절차 | 섹션마다 반복하는 스크롤 연출 |
| Kononenko Architectural Bureau | 섹션을 도곽 안 격자처럼 같은 기준선에 정렬하는 정돈된 구조 | 굵은 타이포 처리와 몰입형 인터랙션 겹치기(website-floria 쓰임과 구분) |
| Humbert & Poyet | 예시 대지별 시트 묶음을 여백 있게 하나씩 보여 주는 제시 방식(`/samples`) | 사진, 로고, 고급 주거 브랜드 톤 |
| Runway Financial | 도구를 실제 제품 화면으로 설명 → 판정 패널 한 장(PASS/WARN/FAIL 행과 근거 칩)만 크게 | B2B 기획 도구 기능 카피, 페이지 전체 구성 |
| OH Architecture | 업종(건축사무소) 톤 대조용. URL은 확인됨(REFERENCES.md arch-studio 절), 구체 참고 포인트만 구현 전 브라우저 확인(미확인) | 확인 전에는 어떤 요소도 가져오지 않음 |

공통으로 가져오지 않을 것: 4.2절 "피할 인상"(청사진 클리셰, 분양 광고형 렌더 사진, 보라 그라디언트 AI 툴, 크림 + 세리프 + 테라코타, 큰 숫자 히어로, 보장 문구)과 `REFERENCES.md` "영감용이지 복제용이 아니다"(로고·사진·아이콘·폰트 파일·카피·색 조합 전체·화면 트레이싱 금지).

### 1.3 고문 검토 기록

| 검토자 | 일자 | 결과 | 반영 |
|---|---|---|---|
| 고문(Fable) | 2026-10-29 | 통과 | ① 1.1 배분은 03장 3.19절·DESIGN_SYSTEM.md 5장과 일치, 시안(dashboard 라이트·GNB 펼침 `--sidebar-w`)과 어긋남 없음. ② 1.2는 4.1절 랜딩 4행을 같은 참고 포인트로 옮기고 원 레퍼런스의 다른 쓰임(굵은 타이포·B2B 카피)을 제외 항목으로 구분함. ③ landing 시안 그라디언트 18건은 민트→데님 진행 막대·밑줄·면 틴트·질감 용도이며 보라 계열 없음 → 4.2절 "보라 그라디언트 AI 툴" 해당 없음. OH Architecture는 URL만 확인된 상태라 참고 포인트 확인 전 미사용이 맞음. |

## 2. 색 토큰 (라이트 / 다크)

값: [`DESIGN_TOKENS.md` "색"](../../../DESIGN_TOKENS.md) 표(라이트·다크 두 열). 출발점은 03장 4.3절 토큰 플랜, 랜딩은 `design/reference/landing/`. Tailwind 유틸리티는 `--color-` 뒤 이름(`bg-surface`, `text-fg-2`, `border-input`)으로 쓴다.

| 묶음 | 토큰 | 용도·규칙 |
|---|---|---|
| 바탕·면 | `--color-bg` · `--color-surface` · `--color-raised` · `--color-nav` | 페이지 바탕(트레이싱지/흑판) · 패널 · 팝오버·카드 위 · GNB 셸 |
| 글자 | `--color-fg` · `--color-fg-2` · `--color-fg-3` | 본문(제도 먹/분필) · 보조 · 약한 보조(placeholder·nav 위 글자). 모두 bg·surface 위 4.5:1 |
| 선 | `--color-line` · `--color-input` | `line`은 장식 구분선 전용(대비 기준 없음). 입력창·체크박스 경계는 `input`(3:1, WCAG 1.4.11) |
| 상태 쌍 | `--color-{accent,info,ok,warn,danger,envelope}` + 각 `-fg` | 면 색 위 글자는 짝 `-fg`(4.5:1). 앱 주 버튼 `accent`는 먹(다크는 반전). `info` = 링크(배치도 남). 판정 PASS/WARN/FAIL = ok/warn/danger(색 + 아이콘 + 글자) |
| 특수 | `--color-envelope` · `--color-concrete` · `--color-focus` · `--color-overlay` | 엔벨로프 청록은 한 화면에 한 곳, 셸에 쓰지 않음 · 콘크리트는 매스·비활성 면 전용(글자·점 금지) · 포커스 링 · Dialog·Sheet 가림막 |
| 3D·도면 미리보기 | `--color-viewport` · `--color-grid` · `--color-site-line` · `--color-setback` · `--color-mass` · `--color-mass-edge` · `--color-room` · `--color-selection` · `--color-sheet-paper` · `--color-sheet-ink` | 뷰포트·SVG 미리보기 화면색. 시트 종이·먹은 테마와 무관(다크에서도 흰 종이). DXF 출력 색은 토큰이 아니라 ACI 번호(PRD 9.6절) |
| 랜딩 전용 | `--color-bg-deep` · `--color-panel-2` · `--color-nav-sub` · `--color-line-2` · `--color-accent-strong`(+`-fg`) · `--color-mint` · `--color-violet` | `[data-surface="landing"]` 안에서만. 앱 화면에서 쓰지 않음. `mint`는 장식(테두리·바), 글자는 `accent` |

대비 검사: `design-preview packages/ui/src/tokens.css --check`(라이트·다크 전 짝 통과, 2026-10-29). 토큰 우회: `--scan packages/ui/src/components` 0건.

## 3. 서체, 크기, 간격, radius, 그림자, 모션

| 묶음 | 토큰 | 용도·규칙 |
|---|---|---|
| 서체 | `--font-sans` · `--font-mono` | 한국어 본문은 `font-sans`(Noto Sans KR 우선, SUIT는 라이선스 확인 전 후보). 숫자·금액·코드는 `font-mono` 또는 `tabular-nums` |
| 글자 크기 | `--text-hero` · `--text-display` · `--text-h1` · `--text-h2` · `--text-body` · `--text-caption` · `--text-num` (+ 각 `--line-height`) | `hero`는 랜딩 전용. `num`은 표·치수 숫자(tabular). 행간은 무단위 비율 |
| 밀도 간격 | `--spacing` · `--spacing-control` · `--spacing-control-sm` · `--spacing-row` · `--spacing-pad` · `--spacing-gap` | 유틸리티 `h-control` · `h-control-sm` · `h-row` · `p-pad` · `gap-gap`. 4장 밀도 선택이 이 다섯 개만 바꾼다 |
| 반경·그림자 | `--radius-control` · `--radius-panel` · `--radius-card` · `--shadow-pop` | 컨트롤 · 패널 · 카드 · 팝오버(Dialog·Sheet·Toast·Tooltip) |
| 포커스 | `--focus-ring-width` · `--focus-ring-offset` · 유틸리티 `focus-ring` · `focus-ring-within` | 모든 상호작용 컴포넌트는 이 유틸리티만 쓴다. 단위 접미사가 붙은 입력은 감싼 상자에 `focus-ring-within` |
| 레이아웃 | `--breakpoint-md` · `--breakpoint-xl` · `--layout-max` · `--gnb-h` · `--sidebar-w` · `--sidebar-w-collapsed` | 3구간 경계(`md:` = 태블릿, `xl:` = 데스크톱) · GNB 높이 · 사이드바 펼침/접힘 |
| 선 종류·기타 | `--line-dash-site` · `--line-dash-setback` · `--envelope-fill-opacity` · `--chat-bubble-max` | 쇄선 = 대지 경계, 파선 = 이격·사선(선 종류가 의미를 나른다) · 엔벨로프 면 투명도 · 채팅 말풍선 최대 너비. 자동 표에 없으므로 값은 `tokens.css` `:root` 블록 |
| 모션 | `--ease-out` | `motion-reduce:`로 `prefers-reduced-motion` 존중(Spinner·VoiceButton 등) |

### 3.1 반응형 3구간 글자 크기

값: [`DESIGN_TOKENS.md` "글자 크기 (반응형 3구간)"](../../../DESIGN_TOKENS.md) 표(모바일 ~767 / 태블릿 768~1199 / 데스크톱 1200~). 코드는 `tokens.css`의 `@theme`(모바일) + 태블릿·데스크톱 구간(`--breakpoint-md` · `--breakpoint-xl`) `@media` 안 `:root` 덮어쓰기(앱), 같은 구간의 `[data-surface="landing"]` 덮어쓰기(랜딩)다.

- 주의(2026-10-29 확인): 현재 자동 표의 태블릿·데스크톱 열은 랜딩 표면 값을 보여 준다(생성기가 `[data-surface="landing"]` 미디어 블록을 앱 값 위에 덮어 읽음). 앱의 태블릿·데스크톱 값은 `tokens.css`의 `:root` 미디어 블록이 정답이다. 생성기가 고쳐질 때까지 앱 값은 그 블록에서 본다.
- 밀도와 무관하게 글자 크기는 같다(컴팩트는 간격만 줄인다).

## 4. 표면·테마·밀도 선택 규칙

[DECISION] 2026-10-29 대표님(AR-06-011 판정): "모든 디자인을 설정에서 선택" — 앱은 라이트/다크 테마와 기본/컴팩트 밀도를 모두 제공하고 사용자가 설정 화면에서 고른다. 제안값(앱 다크 색 D-34, 밀도 수치)을 그대로 채택. 기본값은 테마 = 시스템 따름, 밀도 = 기본. 설정 화면 구현은 AR-06-031.

| 축 | 선택지 | 코드 선택자(정답 `tokens.css`) | 기본값 | 상태 |
|---|---|---|---|---|
| 표면 | 앱 / 랜딩 | 선택자 없음 = 앱, `[data-surface="landing"]` = 랜딩 | 앱 | 랜딩은 다크 단일(확정 2026-10-28). 테마·밀도 선택 대상이 아니다 |
| 테마(앱) | 시스템 따름 / 라이트 / 다크 | 선택자 없음 = 라이트, 루트 요소의 `.dark` = 다크(`@custom-variant dark (&:where(.dark, .dark *))`) | 시스템 따름 | 확정(사용자 선택형). 다크 색 = D-34 제안값 채택 |
| 밀도(앱) | 기본 / 컴팩트 | 선택자 없음 = 기본, `[data-density="compact"]` = 컴팩트 | 기본 | 확정(사용자 선택형). 수치 = AR-06-010 제안값 채택 |

- 테마 전환 방식은 `.dark` 하나로 통일한다(DESIGN_SYSTEM.md 6장 "data-theme 또는 .dark 한 가지"). 코드에 `data-theme` 선택자는 없다. 다크 토큰은 `.dark`에만 걸려 있으므로 "시스템 따름"은 `prefers-color-scheme`를 읽어 `.dark`를 붙이고 떼는 방식이어야 한다(CSS 미디어 쿼리 다크 블록 없음).
- 컴팩트는 3장 "밀도 간격" 다섯 토큰만 바꾸고 글자 크기·색은 유지한다(Primer식). 컴팩트 값은 자동 표에 없으므로 `tokens.css`의 `[data-density="compact"]` 블록에서 본다.
- 테마와 밀도는 독립이다(라이트·다크 × 기본·컴팩트 네 조합 모두 지원, `/dev/components`에서 확인).
- AR-06-031에서 정할 것(미정): 선택 저장 위치(로컬·계정·설치형 설정 파일), 첫 그리기 전 적용(깜빡임 방지), 웹과 설치형 간 동기화 여부.
- 시트 미리보기(`--color-sheet-paper`·`--color-sheet-ink`)와 DXF 출력은 테마 선택과 무관하다.
