# COMPONENTS.md — arch-studio 컴포넌트·배리언트 명세 (확정 2026-10-29, AR-06-012)

> 정답 소스는 코드 컴포넌트 `packages/ui/src/components/*`(진입점 `packages/ui/src/index.ts`, Tailwind CSS v4 토큰 유틸리티만 사용). 이 표는 코드의 export에서 다시 만든 사본이고, 다르면 코드가 이긴다. 작업 지시는 `DESIGN_SYSTEM.md` 8장 템플릿으로 컴포넌트 1개씩 맡긴다.
> 배리언트 이름은 코드의 prop 값 그대로 적는다. 토큰 이름은 `--color-`·`--spacing-`·`--radius-`·`--text-`를 뗀 유틸리티 이름이다(값은 `DESIGN.md` 2·3장, `docs/file/03-설계/디자인/DESIGN_TOKENS.md`).
> 미리보기: `/dev/components`(`apps/web/src/app/dev/components/Showcase.tsx`, production 404) — 라이트/다크 × 기본/컴팩트 네 조합. 밀도는 컴포넌트 prop이 아니라 `[data-density="compact"]`(DESIGN.md 4장)로 바뀐다.

## 1. 기본 컴포넌트 (03장 3.19절 "기본 컴포넌트" 19개)

| 컴포넌트 | 파일 | 크기 배리언트 | 종류 배리언트 | 상태 | 주요 토큰 |
|---|---|---|---|---|---|
| Button | basic.tsx | `size`: `sm` / `md`(기본) | `variant`: `primary` / `secondary`(기본) / `ghost` / `danger`, `icon` | 기본·호버·포커스·비활성·`loading`(Spinner, 비활성 처리) | h-control(-sm) · rounded-control · accent · surface · input · danger |
| IconButton | basic.tsx | `size`: `sm` / `md`(기본) | `variant`: `ghost`(기본) / `secondary`, `icon`, `label`(필수, aria-label) | 기본·호버·포커스·비활성·`pressed`(aria-pressed) | rounded-control · fg-2 · raised · input |
| Input | basic.tsx | 단일(h-control) | `suffix`(단위 접미사) | 기본·포커스(focus-ring-within)·`invalid`·`disabled` | h-control · surface · input · danger · fg-3(placeholder) |
| NumberInput | interactive.tsx | 단일 | `unit`(기본 `mm`), `step`(기본 100), `min`·`max` | 기본·포커스·`invalid`·`disabled`·`value=null`. 화살표 키 증감 | num · fg-3 · input |
| Select | basic.tsx | 단일(h-control) | — | 기본·포커스·`invalid`·`disabled` | h-control · surface · input · danger |
| Checkbox | basic.tsx | 단일 | — | 기본·체크·포커스·비활성 | input · accent · accent-fg |
| Switch | interactive.tsx | 단일 | `label`(필수) | 켬·끔·포커스·`disabled` | accent · input · surface |
| Tabs | interactive.tsx | 단일(h-control) | `items`, `defaultId`, `label` | 선택·비선택·포커스. 화살표 키 이동(WAI-ARIA tabs) | h-control · line · fg · fg-2 |
| Dialog | interactive.tsx | 단일 | `title`, `description`, `footer` | 열림·닫힘(Escape), 포커스 가둠 | surface · overlay · shadow-pop · rounded-panel · pad |
| Sheet | interactive.tsx | 단일 | `title` | 열림·닫힘(Escape), 포커스 가둠 | surface · overlay · shadow-pop · pad |
| Toast | interactive.tsx | 단일 | `tone`: `info`(기본) / `ok` / `warn` / `danger`, `onClose` | 표시·닫기 | raised · shadow-pop · info · ok · warn · danger |
| Tooltip | interactive.tsx | 단일 | `side`: `top`(기본) / `bottom` | 호버·포커스 표시, 호버 유지, Escape 닫기(WCAG 1.4.13) | fg(바탕) · caption · shadow-pop |
| Table | basic.tsx | 밀도로만(h-row) | `columns[].numeric`(오른쪽 정렬·tabular), `caption` | 행 호버. 빈 상태·로딩은 내장 아님 → EmptyState·Skeleton과 조합 | h-row · line · surface · raised · num |
| Badge | basic.tsx | 단일 | `tone`: `neutral`(기본) / `info` / `ok` / `warn` / `danger` / `envelope`, `icon` | — | caption · 각 tone 색 |
| Kbd | basic.tsx | 단일 | — | — | line · raised · caption · fg-2 |
| Banner | basic.tsx | 단일 | `tone`: `info`(기본) / `ok` / `warn` / `danger`, `title`, `action` | — | surface · line · pad · gap · 각 tone 색(왼쪽 막대·아이콘) |
| Progress | basic.tsx | 단일 | `value`(0~100), `label`(필수) | 확정(퍼센트 표시)·`value` 없음 = 불확정 | raised · accent · caption |
| Skeleton | basic.tsx | `className`으로 크기 지정 | — | 로딩 | raised · rounded-control |
| EmptyState | basic.tsx | 단일 | `icon`, `title`, `description`, `action` | 빈 상태 | line · pad · h2 · fg-2 · fg-3 |

## 2. CAD형 제품 컴포넌트 (03장 3.19절 "CAD형 제품 컴포넌트" 20개, 모두 cad.tsx)

| 컴포넌트 | 배리언트·주요 prop | 상태 | 주요 토큰 |
|---|---|---|---|
| JudgmentBadge | `status`: `pass`(PASS 통과) / `warn`(WARN 확인 필요) / `fail`(FAIL 기준 초과) | 색 + 아이콘 + 글자(색만으로 구분 안 함) | Badge tone ok · warn · danger, font-mono |
| RuleCitation | `article` · `effectiveDate` · `packVersion` | — | line · raised · caption |
| JudgmentPanel | `title`(기본 "법규 판정"), `items[]`(status·actual·limit·unit·citation) | 항목별 판정 | surface · line · pad · num |
| FallbackBanner | `packVersion`, `action` | 업데이트 기간 만료 → 마지막 규칙 팩으로 판정 중 경고 | Banner tone warn |
| OfflineIndicator | `online` | 온라인·오프라인 | caption · fg-2 · warn |
| LayerPanel | `defaultLayers`(트리) | 표시·잠금 토글, 펼침·접힘, WAI-ARIA tree 키보드 | surface · line · h-row · raised |
| PropertyInspector | `selectionCount`, `defaultGroups`(필드 `unit`·`step`) | 선택 없음·하나·여러 개(`value=null` → "여러 값") | surface · line · pad · gap |
| MeasureReadout | `value`, `unit`(기본 `mm`), `x`·`y`, `label` | — | surface · num(tabular) · shadow-pop |
| ToolBar | `orientation`: `horizontal`(기본) / `vertical`, `tools[]`(icon·shortcut), `defaultId` | 선택·호버·포커스, 단축키 Kbd 툴팁 | surface · line · shadow-pop |
| ViewCube | `value`: `perspective` / `plan` / `section` | 선택·비선택 | h-control-sm · accent · surface |
| RoomPolygonEditor | `name`, `defaultPoints`, `width`·`height` | 꼭짓점 선택·끌기·화살표 키 이동 | viewport · grid · room · selection |
| SheetPreview | `title`, `scale`, `sheetNo` | — | sheet-paper · sheet-ink · site-line · setback · mass · mass-edge |
| CreditCost | `cost`, `balance` | 충분(차감 후 잔액)·부족("(부족)") | num · danger · fg-2 |
| ExportDialog | `open`, `onClose`, `cost`, `balance` | 열림·닫힘, 잔액 부족 | Dialog + CreditCost |
| TitleBlockEditor | `defaultValue`(office·project·drawing·scale·author·date) | 편집 | sheet-paper · sheet-ink · gap |
| LayerMapTable | `defaultRows`(source·dxfName·aci·linetype) | 편집 | h-control-sm. DXF 색은 ACI 번호(토큰 아님) |
| IntakeCandidateList | `items[]`(field·value·source) | 배지 "AI 추출 후보"(Badge info) | surface · line · pad · num |
| LicenseStatusBadge | `status`: `active` / `trial` / `update-expired` / `expired` / `device-limit` | — | Badge tone ok · info · warn · danger |
| VoiceButton | `state`: `idle` / `listening` / `unavailable` | 대기·녹음 중(aria-pressed, 깜박임은 motion-safe)·사용 불가(비활성) | h-control · input · danger |
| ChatThread | `messages[]`(`role`: `user` / `assistant`, `citations`, `noSource`) | "AI 답변" 표시, 출처 칩, 근거 없음 표시 | surface · accent(사용자) · raised(AI) · warn · chat-bubble-max |

## 3. 보조 export (화면에서 직접 고르는 컴포넌트가 아님)

| export | 파일 | 용도 |
|---|---|---|
| `cn` | cn.ts | 클래스 결합 |
| `Icon` (`IconName`) | icons.tsx | Lucide(ISC) 경로 아이콘. 이모지 아이콘 금지 |
| `Spinner` | basic.tsx | Button `loading` 표시(`motion-reduce` 정지) |
| `Field` | basic.tsx | 라벨·`hint`·`error` 묶음(Input·Select·NumberInput 감싸기) |
| `inputBoxClass` | basic.tsx | 입력 상자 클래스(`invalid`·`disabled`) 공유 |
| `ToastRegion` | interactive.tsx | Toast 쌓는 영역(aria-live) |
| 타입 | 각 파일 | `Tone` · `ButtonVariant` · `ButtonSize` · `Column` · `TabItem` · `JudgmentStatus` · `Citation` · `JudgmentItem` · `LayerNode` · `PropertyField` · `PropertyGroup` · `Tool` · `ViewMode` · `Point` · `TitleBlock` · `LayerMap` · `IntakeCandidate` · `LicenseStatus` · `VoiceState` · `ChatMessage` |
