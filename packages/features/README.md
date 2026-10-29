# @arch-studio/features — 화면 작성 규약

설치형(apps/desktop, Vite)과 웹 스튜디오(071)가 같이 쓰는 화면 코드. 셸·Provider·공용 훅·자리표시자는 AR-06-004b가 만들었다.
**각 화면 작업은 자기 feature 폴더만 고친다.** 셸(`src/shell/**`)·라우트 표(`apps/desktop/src/routes/**`)·이 규약은 셸 소유라 바꿀 일이 있으면 요청한다.

## 1. 폴더 ↔ 경로 ↔ 소유 작업

| 경로(03장 1.1절) | feature 폴더(`src/…`) | exports 서브패스 | 소유 작업 | 명세 |
|---|---|---|---|---|
| `/login` | `login/` | `./login` | AR-06-004b(최소) → AR-06-062 | 3.1절 |
| `/onboarding` | `onboarding/` | `./onboarding` | AR-06-004b(최소) → AR-06-062 | 3.2절 |
| `/projects` | `projects/` | `./projects` | AR-06-034 | 3.3·8.5절 |
| `/projects/:id/site` | `site/` | `./site` | AR-06-035 | 3.4절 |
| `/projects/:id/model` | `modeler/` (`suggest/` 제외) | `./modeler` | AR-06-036 | 3.5절 |
| (모델 화면 안 판정 패널) | `judgment/` | 진입점 없음(modeler가 import) | AR-06-037 | 3.5절 |
| (매스 자동 제안) | `modeler/suggest/` | 진입점 없음 | AR-06-028 | 2.3절 |
| `/projects/:id/program` | `program/` (`intake/` 제외) | `./program` | AR-06-038 | 3.6절 |
| (대화형 입력 패널) | `program/intake/` | 진입점 없음 | AR-06-052 | 3.6절 |
| `/projects/:id/plans` | `plans/` | `./plans` | AR-06-027 | 3.7절 |
| `/projects/:id/sheets` | `sheets/` | `./sheets` | AR-06-030 | 3.8절 |
| `/projects/:id/render` | `render/` | `./render` | AR-06-056 | 3.9절 |
| `/projects/:id/proposal` | `proposal/` | `./proposal` | AR-06-032 | 3.10절 |
| `/projects/:id/review` | `review/` | `./review` | AR-06-055 | 3.11절 |
| `/chat` | `chat/` | `./chat` | AR-06-055 | 3.12절 |
| `/wiki` | `wiki/` | `./wiki` | AR-06-055 | 3.13절 |
| `/settings/drafting` | `settings/drafting/` (+ `settings/SettingsNav.tsx`) | `./settings/drafting` | AR-06-031 | 3.14절 |
| `/settings/general` | `settings/general/` | `./settings/general` | AR-06-031 | 3.15절 |
| `/license` | `license/` | `./license` | AR-06-044 | 3.16절 |
| `/credits` | `credits/` | `./credits` | AR-06-044 | 3.17절 |
| `*` | `not-found/` | `./not-found` | 셸(AR-06-004b) | — |
| — | `shell/`, `demo/` | `./shell`, `./demo` | 셸(AR-06-004b) | 8장 |
| — | `auth/`, `api-client/` | `.` | AR-06-008, AR-06-007 | — |

## 2. 진입점 모양

- `src/<feature>/index.tsx`는 `export function Screen()` 하나를 내보낸다(인자 없음). 경로 파라미터는 `useParams`, 열린 프로젝트는 `useProject()`.
- `apps/desktop/src/routes/screens/<경로>.tsx`는 `export { Screen as Component } from "@arch-studio/features/<feature>"` 한 줄 래퍼다. 로직을 넣지 않는다.
- 새 하위 모듈은 자기 폴더 안에 둔다. 다른 feature 폴더를 import하지 않는다(판정 패널처럼 공유가 필요하면 그 폴더의 공개 파일 하나만, 소유 작업과 합의).
- 프로젝트 탭 화면은 `ProjectShell` 안에서 그려진다: 헤더(← 프로젝트·이름·탭 8개)·열람 모드 배너·없는 프로젝트 처리는 셸이 한다. 화면은 `PageHeader`부터 그린다.

## 3. 데이터·파일·권한은 훅으로만

| 훅 | 주는 것 | 규칙 |
|---|---|---|
| `useAdapters()` | 070 `PlatformAdapters`(projects·files·secrets·entitlement·updater) | 전역 싱글턴·직접 `invoke` 금지. 오류는 `bridgeErrorCode(e)`로 판별(instanceof 금지), 문구는 `bridgeErrorText(e)` |
| `useCapabilities()` | `has(key)`·`by(key, a, b)`·`capabilities` | 플랫폼 이름 검사 금지(eslint `platform`). 070 `hasCapability`와 같은 결과(테스트로 고정) |
| `useEntitlement(feature)` | `EntitlementDecision \| undefined`(판정 중 undefined) | 권한 없는 메뉴·버튼은 **숨기지 않고** 잠금 안내(`LockedState`, 5.1절). ⚠ 설치형 EntitlementClient는 041·074 연결 전까지 `view_export`만 허용하고 나머지는 `unverified` Deny(실패 닫힘) → 지금 설치형에서는 편집·AI가 모두 잠금으로 보이는 게 정상. 데모 모드로 상태를 바꿔 확인한다 |
| `useSession()` | 008 상태기계 `state`(ready면 `state.session`: 역할·플랜·잔액) | 토큰은 보지 않는다. 로그아웃 `signOut()` |
| `useApi()` | 007 `ApiClient` | 변경 요청은 `idempotencyKey` 필수(`api.newIdempotencyKey()`). 오류 문구는 `errorMessageFor` |
| `useEngine()` | 017 워커 호스트 `send`·`subscribe` (없으면 null) | 기하·판정·도면은 워커의 결정적 함수만. 요청 봉투는 `apps/desktop/src/workers/protocol.ts`(판정 레인은 `seq` 필수, 최신만 유효) |
| `useProject()` | `/projects/:id` 아래의 열린 프로젝트(`load`, `reload`) | 저장은 `adapters.projects.save`(버전 충돌 `VERSION_CONFLICT`) 후 `reload()` |
| `useShellStatus()` | 상단 바 저장 상태 문구 슬롯 | 5.1절 "이 PC에만 저장됨 · 서버에 없음" 등. 화면을 떠날 때 `null` |
| `useOnline()`·`useDisplayPrefs()`·`useDemoMode()` | 온라인 표시·테마/밀도·데모 여부 | 데모 여부로 기능을 분기하지 않는다 |

## 4. 상태·접근성·토큰·3구간

- 상태 4종을 모두 그린다: 빈(`EmptyBlock`, 5.4절 문구 그대로)·로딩(`LoadingState`, 시간 기반 가짜 진행률 금지)·오류(`ErrorState`, 원인 + 다음 행동)·잠금(`LockedState`). 성공 알림은 ui `Toast`.
- 색·크기는 토큰 유틸리티만(`bg-surface`·`text-fg-2`·`p-pad`·`h-control`·`w-(--sidebar-w)` 등). hex·px·`h-px` 금지. 상태색은 아이콘 + 글자와 함께. 엔벨로프 청록은 한 화면 한 곳(셸 금지).
- 3구간: 기본(~767) → `md:`(768~1199) → `xl:`(1200~). 375px에서 가로 넘침 0(표는 ui `Table`이 카드 안 가로 스크롤).
- 접근성: 화면마다 h1 하나(`PageHeader`), 포커스 링은 `focus-ring`, 아이콘만 있는 버튼은 `aria-label`, 키보드만으로 조작 가능. 문구는 한국어, 식별자는 영어.
- 컴포넌트는 packages/ui를 쓴다(수정 금지). 없으면 자기 폴더에 두고 셸 작업에 ui 추가 요청(지금 부족 목록: `tasks/logs/AR-06-004b.md`).

## 5. 데모 데이터 모드·테스트·스크린샷

- 데모 모드(개발 전용): `VITE_DEMO_MODE=1 pnpm --filter ./apps/desktop dev` → 백엔드 없이 로그인된 상태 + 샘플 프로젝트 3개(`src/demo/samples.ts`, DesignModel v1 zod 통과). URL로 조절: `?demo-session=none`(로그아웃 상태) · `?demo-onboarding=1` · `?demo-license=trial|fallback|expired` · `?demo-role=member`. 자리표시자는 `?state=loading|error|empty`.
- 릴리스 빌드에는 데모·Mock이 0이어야 한다: `NODE_ENV=production pnpm --filter ./apps/desktop build && pnpm --filter ./apps/desktop check:release`. 릴리스 빌드에 `VITE_DEMO_MODE`가 있으면 빌드가 실패한다(env-allowlist).
- 테스트: 순수 로직은 `src/<feature>/*.test.ts`(Node 테스트 러너, `.tsx`·packages/ui는 Node가 못 읽으므로 로직을 `.ts`로 분리). `pnpm --filter @arch-studio/features test`.
- 스크린샷(필수 확인): `node scripts/shot/shot.mjs --out <스크래치 폴더> --routes "/projects,/projects/0192f0a0-1c00-7a01-8a01-000000000001/site"` → 375·900·1400px PNG + 가로 넘침·콘솔 오류(CSP 위반 포함) 출력. 이미지는 커밋하지 않는다.
