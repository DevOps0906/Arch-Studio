# 마케팅 컴포넌트 8종 (AR-06-069)

근거: `03_SCREENS_UX.md` 7.7절, `LANDING_PERSUASION.md` 3·4장, PRD 6.1·9.7절·D-27·D-30. 설치형 앱과 공용인 `packages/ui`에는 넣지 않는다(마케팅 전용, 앱 화면에서 쓰지 않는다).

## 공통 규칙

- 모두 서버 컴포넌트다. `"use client"`·훅·이벤트 핸들러가 없고 JS 없이 동작한다(소스 검사 테스트가 막는다).
- 색·크기는 토큰 유틸리티만 쓴다(`packages/ui/src/tokens.css`). hex·px 직접 값, 인라인 style이 없다. 랜딩 표면(`data-surface="landing"`) 안에서 쓴다.
- 포커스 가능한 요소(링크, 가로 스크롤 영역)는 `focus-ring` 토큰 유틸리티를 쓴다. 전환·애니메이션이 없어 `prefers-reduced-motion`과 충돌하지 않는다(추가하려면 `motion-safe:` 안에서만).
- 규칙 위반은 타입으로 먼저 막고, 타입으로 못 막는 것은 렌더 중 `MarketingRuleError`를 던진다. 정적 페이지에서는 빌드가 실패한다.
- 반응형 3구간(~767 / 768~1199 / 1200~)은 `md`(768)·`xl`(1200) 접두사로 나눈다.
- 호출 쪽 문구는 PRD 6.1·9.7절 금지 문구와 D-27을 따라야 한다. 컴포넌트는 문구를 만들지 않고, 소스·README 검사 테스트(`source-rules.test.ts`)가 컴포넌트 소스만 검사한다. 호출하는 페이지는 자기 문구 테스트가 필요하다.
- 아래 표의 "오류" 열은 `MarketingRuleError` 조건이다.

## 컴포넌트

| 컴포넌트 | 쓰는 칸(LP 2장) | 주요 props | 사용 규칙 | 오류 조건 |
|---|---|---|---|---|
| `AlternativesTable` | 5 왜 이 플랫폼인가 | `caption`, `alternativeNames`(범주 이름 2~5개), `ourName`, `rows`(기준 4~6행: `criterion`, `alternatives[]`, `ours`), `unfit`(맞지 않는 경우 2~4행) | 셀은 `mark`(`yes` ○ / `partial` △ / `no` ✕) + 한 줄 근거. 768 이상은 `<table>`(캡션·`scope`, 표 안에서만 가로 스크롤), 767 이하는 기준 하나 = 블록 하나. 마지막 열은 증거 링크. 표 위에 기호 범례 | 우리 열에 △·✕ 없음. 우리 열 ○에 `proof` 없음(타입 오류이기도 함). 대안 이름이 영문 소문자 단어·주소·기호를 포함(실명 방지, D-27). 행 수·열 수 불일치. 빈 근거 |
| `ContrastPair` | 3 원인 하나 | `label`, `beforeLabel`, `afterLabel`, `rows`(2~6행: `attribute`, `before`, `after`) | 페이지에 1쌍만. 중립색 + 기호(− / +) + 글자 머리글. 768 이상 3칸, 767 이하 속성마다 위아래 | 행 수 범위 밖, 빈 문자열 |
| `DualTimeline` | 4 방식, 도입 단계, 앱 작업 상세 | `label`, `steps`(1~8: `title`, `user`, `product`, `approval?`, `meta?`), `userLabel?`, `productLabel?` | `<ol>` 번호는 실제 순서일 때만. 승인 지점은 사용자 줄에만 표시. `meta`는 도입 단계의 요금 칸처럼 단계에 붙는 한 쌍(숫자의 출처는 호출 쪽 책임) | 단계 수 범위 밖, 빈 문자열 |
| `ProofLink` | 5 | `href`, `evidenceId`(예: AS-E-02), `grade`(E1~E5), `label?`, `download?`, E4는 `conditions` | 증거 링크 필수. 문구는 일어나는 일(기본: 등급별 문구). 끝 화살표 금지. 등급 이름을 링크 아래 글자로 표시 | 주소 비었거나 `/`·`#`·`https://` 아님, 증거 ID 모양 틀림, 문구 끝 화살표, E4에 `conditions` 없음 |
| `AssumptionTable` | 6 비용·시간 비교 | `caption`, `rows`(`label`, `value`, `by: "user"` 또는 `by: "source"` + `source`, `checkedAt`, `href?`) | 출처 없는 기본값은 타입에 없다. 좁은 화면에서는 표 영역 안에서 좌우 이동(안내 문구 표시, 영역에 키보드 포커스) | 출처 값에 `source`·`checkedAt`(YYYY-MM-DD 실제 날짜) 없음, 행 0개 |
| `Callout` | 3~6 중 한 곳 | `conclusion`(한 문장), `detail?`(한 줄) | 페이지에 1개. `role="note"`, 왼쪽 띠 | 결론이 두 문장 이상·여러 줄·빈 문자열 |
| `SourceNote` | 모든 칸 | `source`, `checkedAt`(YYYY-MM-DD), `href?` | 표·주장 아래 "출처: …, 확인일 …". 출처를 못 대면 주장을 지운다 | 출처 비었음, 확인일 형식 오류, 위험한 주소 |
| `SampleTag` | 1, 5, 6 | `kind?`(`example` "예시" 기본, `sample` "샘플") | 표시 문구는 바꿀 수 없다. 예시 데이터·샘플 결과물 옆에 둔다 | (없음, 문구 고정) |

## 사용 예 (페이지 쪽 코드 조각)

```tsx
import { AlternativesTable, SourceNote } from "@/components/marketing";

<AlternativesTable
  caption="일을 하는 방법별 비교"
  alternativeNames={["손으로 작도", "범용 AI 이미지 도구"]}
  ourName="이 제품"
  rows={rows /* 4~6행, 우리 열 ○ 마다 proof, △ 또는 ✕ 1개 이상 */}
  unfit={unfit}
/>
<SourceNote source="판정표 장부 AS-C-04" checkedAt="2026-10-29" />
```

## 결정 기록

- 컴포넌트 목록은 03장 7.7절의 8종이다. `LANDING_PERSUASION.md` 4장 표에는 `StepRail`(단계 레일)과 `ContactButton`도 있지만, 7.7절은 `StepRail`을 목록에 두지 않고 `DualTimeline`이 도입 단계와 이중 타임라인을 맡으며 문의 버튼은 두지 않는다고 적었다. 제품별 문서가 우선이라 `StepRail`은 만들지 않았다(근거: `tasks/logs/AR-06-069.md`).
- 도입 단계 "탭"의 선택 UI는 클라이언트 JS가 필요하다. `DualTimeline`은 모든 단계를 순서대로 펼쳐 보이고, 탭이 필요하면 호출 쪽이 `packages/ui`의 `Tabs`로 감싼다.
- 테스트는 `node --test`(`.test.ts`만 수집)에서 `.tsx`를 읽기 위해 `tsx-hooks.mjs`(저장소의 typescript로 변환하는 로더 훅)를 쓴다. 새 의존성은 없다.
