# AUTH_ROADMAP: 인증 단계별 도입 규격 (Mock → Google → 카카오·네이버)

작성일 2026-10-14. 확정 결정 22(`docs/reference/00_MERGE_ANALYSIS.md` "확정 결정" 표)의 정본이다. 14개 제품(arch-studio 포함) 전부에 적용한다. 대상 독자는 제품 기획 에이전트, 인증 작업 담당(Fable), 개발 폴더에서 일하는 구현 에이전트다. 경로 인용에서 `migrations/`는 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/`다.

이 문서는 "언제 어떤 로그인을 켜는가"와 "단계를 바꿀 때 무엇이 바뀌고 무엇이 바뀌지 않는가"를 정한다. 세션·조직·엔타이틀먼트 계약(`CORE_SPEC.md` 2장)과 보안 규칙(`SECURITY_BASELINE.md`)은 그대로이며, 이 문서가 그 위에 단계 규칙을 더한다.

## 0. 요약

| 단계 | 이름 | 언제 | 켜지는 로그인 | 끝나는 조건(다음 단계 진입 게이트) |
|---|---|---|---|---|
| A | Mock 로그인(개발 1단계, MVP 개발) | W0부터 MVP 기능이 모두 동작할 때까지 | 로컬 Supabase에 시드한 개발용 계정(페르소나) 원클릭 로그인. 실제 제공자 버튼 없음 | G1: MVP P0 기능·핵심 플로우 E2E·RLS 스모크가 Mock 계정으로 녹색 (4장) |
| B | Google OAuth | G1 통과 후, 공개 베타 전 | Google(+ 제품 PRD가 정한 이메일·초대 메일). 배포 환경에서 Mock 차단 | G2: Google 실사용 안정화 (6장) |
| C1 | 카카오 로그인 | G2 통과 후 | Supabase 기본 제공자 `kakao` 추가 | 7.1절 수용 기준 |
| C2 | 네이버 로그인 | C1과 병렬 가능(검수 기간 때문에 신청은 G2 직후) | `custom:naver`(Supabase 커스텀 OAuth2) 또는 서버 브리지(스파이크로 결정) | 7.2절 수용 기준 |

세 가지는 단계가 바뀌어도 변하지 않는다. 이 불변 조건이 단계 전환을 "버튼 추가"로 만드는 핵심이다.

| 불변 조건 | 내용 | 근거 |
|---|---|---|
| 세션은 항상 실제 Supabase Auth JWT | Mock도 로컬 Supabase에 실제로 로그인한다. 가짜 쿠키·가짜 사용자 객체를 만들지 않는다 | 2장 |
| 권한 판정은 `session_context` 하나 | `requireSession(appId)`·`proxy.ts`·레이아웃 가드는 단계와 무관하게 같은 코드다 | `CORE_SPEC.md` 2.3, `SHARED_MODULES.md` 2장 |
| RLS는 `auth.uid()` 기준 그대로 | Mock 단계에서 통과한 RLS 스모크가 Google·카카오·네이버 단계에서도 그대로 유효하다 | `SECURITY_BASELINE.md` 15장 |
| 단계 분기는 인증 모듈 안에서만 | `AUTH_MODE`·제공자 목록을 읽는 코드는 `src/lib/auth/`(또는 `packages/core-auth/providers`)와 로그인 화면·콜백 라우트에만 있다. 기능 코드에 `if (mock)` 금지 | 9장 CI 검사 |

## 1. 확정 결정과 근거

| 항목 | 확정 내용 | 이유 |
|---|---|---|
| 순서 | Mock → Google → 카카오·네이버 | 2026-10-14 사용자 결정. 외부 콘솔 설정·검수 없이 MVP 기능 개발을 먼저 끝내고, 실제 로그인은 기능이 안정된 뒤 붙인다 |
| Mock의 정의 | "로컬 Supabase의 시드 계정으로 실제 로그인"(제안) | 쿠키에 역할을 적는 방식의 Mock은 리뷰에서 권한 위조·프로덕션 노출 결함으로 확인됐다: `D:/WorkSpace/platform/docs/products/nomad-blog/07_SOURCE_MIGRATION.md:88`(`lib/mock-auth.ts` 프로덕션 노출), `D:/WorkSpace/platform/docs/products/nomad-commerce/07_SOURCE_MIGRATION.md:96`(`mock-login`, `nomad_role`, `nomad_plan` 쿠키 권한). 실제 JWT를 쓰면 RLS·엔타이틀먼트·크레딧이 Mock 단계부터 진짜로 검증된다 |
| 이메일+비밀번호 | 제품 PRD가 이미 정한 범위를 유지하되 B단계에서 Google과 함께 켠다. 초대제 제품(microweb, sms, stock, site)의 초대 메일 수락 흐름도 B단계 | 기존 제품 결정(`astro-ai/01_PRD.md` AS-F-001 등)을 바꾸지 않는다. 신규 공개 가입 제품에서 이메일을 뺄지는 각 PRD 8절 열린 결정 |
| Apple, 매직링크 | 이번 로드맵 범위 밖. 기존 연기 결정 유지 | `docs/reference/00_MERGE_ANALYSIS.md:318` |
| 카카오 위치 | nomad-commerce의 MVP 카카오(CM-F-001)와 flora-publishing의 카카오 열린 결정(D6)은 C1으로 옮긴다 | 단계 순서를 전 제품에서 같게 한다 |

## 2. Stage A: Mock 로그인

### 2.1 동작

| 항목 | 내용 |
|---|---|
| 화면 | `/login`에 "개발용 로그인" 패널. 페르소나 버튼 목록(2.2절), 현재 로그인 페르소나, 로그아웃. 페이지 상단에 고정 배지 `MOCK AUTH · 로컬 전용`(모든 화면). 실제 제공자 버튼은 렌더하지 않는다 |
| 로그인 경로 | 버튼 → `POST /api/dev/login { persona }` → 서버가 `isMockAuthAllowed()` 확인 → 쿠키 세션용 서버 클라이언트로 `signInWithPassword(<페르소나 이메일>, DEV_SEED_PASSWORD)` → 세션 쿠키 설정 → `next`(화이트리스트) 또는 `/app` |
| 비밀번호 위치 | `DEV_SEED_PASSWORD`는 서버 환경변수. 브라우저 번들·`NEXT_PUBLIC_*`에 넣지 않는다 |
| 계정 생성 | `scripts/dev/seed-users.mjs`(2.3절). 앱 코드가 계정을 만들지 않는다 |
| 이후 흐름 | 로그인 뒤에는 B·C 단계와 같은 코드: `proxy.ts` → `session_context` → 역할·엔타이틀먼트 분기 |
| E2E | Playwright `globalSetup`이 페르소나마다 `/api/dev/login`을 호출해 `storageState`를 저장하고, 각 테스트는 필요한 페르소나 상태로 시작한다 |

### 2.2 공통 페르소나 (제품은 도메인 역할을 더한다)

이메일 도메인은 예약 TLD `.test`(제안)를 쓴다. 실제 메일이 나가지 않는다.

| 키 | 이메일 | 만드는 방법 | 기대 `session_context` | 쓰임 |
|---|---|---|---|---|
| `owner` | `owner@dev.test` | `signup_app=<app>`으로 생성 | 개인 조직 owner, `entitled=true`, 기본 플랜, 가입·월 크레딧 지급됨 | 기본 사용자 |
| `admin` | `admin@dev.test` | 생성 후 owner 조직에 `invite_member(admin)` → 본인 `accept_invite` | owner 조직의 admin | 역할 분기 |
| `member` | `member@dev.test` | 같은 방법(member) | owner 조직의 member | 역할 분기 |
| `viewer` | `viewer@dev.test` | 같은 방법(viewer) | owner 조직의 viewer | 읽기 전용 검사 |
| `outsider` | `outsider@dev.test` | `signup_app=<app>`으로 생성(다른 개인 조직) | 자기 조직 owner | 교차 테넌트 RLS 거부 확인 |
| `no_app` | `no_app@dev.test` | `signup_app` 없이 생성 | 모듈러: `entitled=false`. 모놀리스: 앱 행이 1개면 가입 트리거가 자동 부트스트랩해 `entitled=true`(3.2절) | 402·첫 진입 부트스트랩 확인(모듈러) |
| `pending` | `pending@dev.test` | approval 앱만. `signup_app=<app>` | `status=pending` | `/pending` 안내 |
| `suspended` | `suspended@dev.test` | 생성 후 service_role로 `status=suspended` | 403 | 차단 확인 |
| `ops` | `ops@dev.test` | 생성 후 service_role로 `platform_role=platform_admin` | 운영자 | `/admin` 화면 |

제품 도메인 역할(예: admin-suite의 doctor·staff, live-poll 진행자, microweb `studio_access` 허용 목록, stock 베타 초대, website-floria `provision_site`)은 각 제품 `05_DATA_MODEL.md`·`06_AGENT_PLAN.md`가 이 표에 행을 더한다. 시드 스크립트는 공통 행을 만든 뒤 제품 훅(`scripts/dev/seed-users.<app>.mjs`)을 실행한다.

### 2.3 시드 스크립트 계약 (`scripts/dev/seed-users.mjs`, 제안)

| 항목 | 규칙 |
|---|---|
| 실행 | `node scripts/dev/seed-users.mjs --app <app_id>`. `supabase db reset` 뒤에 실행. `package.json` 스크립트 `db:seed-users` |
| 대상 확인 | `SUPABASE_URL` 호스트가 `127.0.0.1`·`localhost`가 아니면 즉시 종료(exit 1). 원격 프로젝트에 개발 계정을 만들지 않는다 |
| 생성 | service_role 관리자 클라이언트 `auth.admin.createUser({ email, password: DEV_SEED_PASSWORD, email_confirm: true, user_metadata: { signup_app, full_name } })`. 가입 트리거(`core.handle_new_user`, `migrations/0001_core_identity.sql:113`)가 실제 가입과 같은 경로로 프로필·조직·엔타이틀먼트·크레딧을 만든다 |
| 역할 | admin·member·viewer는 owner로 로그인한 클라이언트가 `invite_member`, 각 사용자가 `accept_invite`를 호출한다(실제 RPC 경로 검증). `suspended`·`ops`만 service_role 갱신 |
| 멱등 | 이미 있는 이메일은 건너뛰고 역할·상태만 맞춘다. 두 번 실행해도 크레딧이 두 번 지급되지 않는다(멱등 키 `signup:<org>:<app>`) |
| 출력 | 페르소나·이메일·조직 id·플랜·잔액 표. 비밀번호는 출력하지 않는다 |
| 모듈러 통합 DB | `--app`을 여러 번 줄 수 있다. 두 번째 앱부터는 service_role로 `bootstrap_app_for_org`(`migrations/0003_core_credits.sql:440`)를 호출한다 |

### 2.4 Mock 허용 판정과 가드

`isMockAuthAllowed()`는 아래가 모두 참일 때만 참이다.

| 조건 | 이유 |
|---|---|
| `AUTH_MODE === 'mock'` | 명시적으로 켠 경우만 |
| `SUPABASE_URL`(또는 `NEXT_PUBLIC_SUPABASE_URL`) 호스트가 `127.0.0.1` 또는 `localhost` | 시드 계정은 로컬 DB에만 있다. 원격 DB를 가리키는 배포에서 Mock이 동작할 수 없게 한다 |
| `VERCEL_ENV`, `RAILWAY_ENVIRONMENT`가 비어 있다 | 배포 플랫폼에서는 항상 거짓 |

| 가드 | 동작 |
|---|---|
| 기동 시 env 검증(zod) | `AUTH_MODE=mock`인데 위 조건이 거짓이면 기동 실패(조용히 live로 바꾸지 않는다) |
| `/api/dev/login` | 판정이 거짓이면 404(존재 자체를 숨긴다). 레이트 리밋 대상 아님(로컬 전용) |
| 로그인 화면 | 판정이 거짓이면 개발용 패널 코드를 렌더하지 않는다(서버 컴포넌트에서 분기) |
| 빌드 검사(CI) | `AUTH_MODE=mock VERCEL_ENV=production npm run build`가 실패해야 한다. `AUTH_MODE=live` 빌드에서 `/api/dev/login` 호출이 404여야 한다 |
| 금지 문자열(CI) | `nomad_role`, `nomad_plan`, `mock-auth`, 쿠키·localStorage에 역할·플랜을 쓰는 코드, `dev-user` 우회(`SECURITY_BASELINE.md` 14장) |

`SECURITY_BASELINE.md` 11장 "dev 전용이라도 프로덕션 빌드에서 제거"와의 관계: Mock 로그인은 인증을 우회하지 않고(실제 JWT 발급) 원격 DB에서는 동작할 수 없으므로 우회 기능이 아니다. 다만 위 가드가 하나라도 빠지면 같은 결함으로 본다.

### 2.5 Stage A에서 하지 않는 것

| 하지 않음 | 이유 |
|---|---|
| Google·카카오·네이버 콘솔 설정 | B·C 단계 일 |
| 이메일 가입 화면·메일 인증·비밀번호 재설정 화면 구현 | B단계(제품 PRD가 이메일을 유지할 때). 다만 "이메일 인증 전 제한" 같은 규칙은 `email_confirmed_at` 기준으로 서버 가드를 먼저 만들어 둔다(시드 계정은 인증 완료 상태) |
| 기능 코드에서 페르소나 이메일로 분기 | 권한은 `session_context`로만 |

## 3. 공통 구조 (A·B·C 동일)

### 3.1 인증 모듈 경계 (`packages/core-auth/providers`, 제품 앱은 `src/lib/auth/`)

```ts
// 계약 예시(구현 파일 아님). SHARED_MODULES.md 2장 auth 모듈에 속한다.
export type AuthMode = 'mock' | 'live'
export type LoginProvider = 'google' | 'kakao' | 'naver' | 'email'

export interface AuthConfig {
  mode: AuthMode                      // AUTH_MODE, 기본 'live'
  providers: LoginProvider[]          // AUTH_PROVIDERS="google,kakao,naver" (live에서만 의미)
  naverPath?: 'supabase_custom' | 'bridge'  // NAVER_AUTH_PATH, C2 스파이크 결과
}
export function getAuthConfig(): AuthConfig            // env zod 검증 결과. 잘못된 조합이면 기동 실패
export function isMockAuthAllowed(): boolean           // 2.4절
export function listLoginOptions(appId: string): Array<
  | { kind: 'mock'; personas: Array<{ key: string; label: string }> }
  | { kind: 'oauth'; provider: 'google' | 'kakao' | 'naver' }
  | { kind: 'email' }
>
// 브라우저: supabase.auth.signInWithOAuth({ provider: 'google' | 'kakao' | 'custom:naver', options: { redirectTo } })
// 네이버 브리지 경로면 /auth/naver/start 로 이동한다(7.2.3절)
export async function finishLogin(appId: string, next: string | null): Promise<string> // 콜백 공통 처리(3.2절), 이동할 경로 반환
```

### 3.2 `/auth/callback` 공통 처리 (B단계에서 완성, C단계 재사용)

| 순서 | 처리 | 실패 시 |
|---|---|---|
| 1 | `code`로 `exchangeCodeForSession`(PKCE, `@supabase/ssr` 서버 클라이언트) | `/login?error=callback` |
| 2 | `session_context(<app>)` 1회 조회 | 프로필 없음 → 로그아웃 후 `/login`(기본 admin 금지, `CORE_SPEC.md` 2.2) |
| 3 | `entitled=false`이고 앱 `signup_policy`가 open·approval이면 `rpc('bootstrap_app_for_org', { p_app_id })` 1회 후 다시 조회 | OAuth 가입은 `signUp`의 `options.data.signup_app`을 보낼 수 없어 가입 트리거가 엔타이틀먼트를 만들지 않는다. 이 호출이 그 공백을 메운다(`migrations/0003_core_credits.sql:440-461`, 크레딧 멱등). invite 앱은 호출하지 않고 `/no-access` |
| 4 | `status`: pending → `/pending`, suspended → 403 | |
| 5 | `next`가 `/`로 시작하고 `//`·`@`·`\`가 없을 때만 그 경로, 아니면 제품 기본 경로. origin은 `NEXT_PUBLIC_APP_URL` 고정 | `next=//evil.com` → 기본 경로 |
| 6 | 감사 `auth.login`(provider, 첫 로그인 여부). 토큰·코드는 남기지 않는다 | |

모놀리스 코어(`MONOLITH_CORE_LITE.sql` 머리말 b항)는 `signup_app`이 없어도 앱 행이 1개면 가입 트리거가 자동 부트스트랩하므로 3번은 아무 일도 하지 않는다. 같은 코드를 두 배포 형태에 그대로 쓴다.

Mock 로그인(`/api/dev/login`)도 로그인 직후 2~5번을 같은 함수(`finishLogin`)로 거친다. 그래서 `no_app` 페르소나로 3번 경로를 A단계에서 미리 검증할 수 있다.

### 3.3 환경변수

| 이름 | 단계 | 위치 | 없으면 |
|---|---|---|---|
| `AUTH_MODE` | A·B·C | 서버(web) | `live`. 로컬 `.env.example` 기본값은 `mock` |
| `AUTH_PROVIDERS` | B·C | 서버(web) | 빈 목록 → live 모드에서 로그인 수단 0개면 기동 실패 |
| `DEV_SEED_PASSWORD` | A(로컬 전용) | 서버(web), 시드 스크립트 | Mock 모드 기동 실패 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | B | 로컬 `supabase/config.toml`의 `env()`. 원격은 Supabase 대시보드에만 입력(앱 env에 넣지 않음) | 로컬 Google 버튼 비활성 |
| `KAKAO_CLIENT_ID`(REST API 키), `KAKAO_CLIENT_SECRET` | C1 | 같은 방식 | 카카오 버튼 비활성 |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | C2 | `supabase_custom`: 등록 스크립트만 사용(앱 env 불필요). `bridge`: 서버(web) 전용 | 네이버 버튼 비활성 |
| `NAVER_AUTH_PATH` | C2 | 서버(web) | `supabase_custom` |
| `AUTH_BRIDGE_SECRET` | C2 브리지 경로만 | 서버(web). 32바이트 이상 | 브리지 경로면 기동 실패 |

`AUTH_PROVIDERS`에 있는 제공자인데 Supabase에 설정이 없으면 로그인 시 오류가 난다. 배포 체크리스트(5.3절)에서 대시보드 설정과 목록을 함께 확인한다.

### 3.4 로컬 `supabase/config.toml` 단계별 설정

| 단계 | `[auth.external.google]` | `[auth.external.kakao]` | 기타 |
|---|---|---|---|
| A | `enabled = false` | `enabled = false` | `[auth.email] enable_confirmations = true` 유지(시드는 `email_confirm: true`로 만든다) |
| B | `enabled = true`, `client_id = "env(GOOGLE_CLIENT_ID)"`, `secret = "env(GOOGLE_CLIENT_SECRET)"` | `false` | `additional_redirect_urls`에 앱 `/auth/callback` |
| C1 | 유지 | `enabled = true`, `client_id = "env(KAKAO_CLIENT_ID)"`, `secret = "env(KAKAO_CLIENT_SECRET)"` | 이메일 없는 카카오 사용자를 받으면 대시보드의 "Allow users without an email"(로컬 config 키는 미확인) |
| C2 | 유지 | 유지 | 커스텀 제공자는 config.toml이 아니라 관리자 API로 등록한다(로컬 CLI 지원 미확인, 7.2.2절) |

예시는 `D:/WorkSpace/platform/docs/products/_supabase-modular/config.toml.example`에 있다.

## 4. 게이트 G1: Mock → Google

아래가 모두 참일 때 B단계 작업을 시작한다. 판정은 사람(대표님)이 하고 결과를 제품 개발 폴더 task `log.md`에 `[DECISION] G1 통과`로 남긴다.

| # | 조건 | 확인 방법 |
|---|---|---|
| 1 | `06_AGENT_PLAN.md` 2절의 MVP P0 기능 작업 완료(인증 B·C 작업과 공개 베타 직전 통합 작업 제외) | 작업 상태 |
| 2 | 핵심 플로우 E2E 녹색(Mock 페르소나 `storageState`) | `npx playwright test e2e/flows`(제품별 경로) |
| 3 | RLS 스모크 전 항목 통과, `outsider` 교차 테넌트 거부 확인 | 제품 RLS 러너 |
| 4 | 결제 E2E 녹색(결제가 있는 제품, Toss 테스트 키) | 제품 결제 E2E |
| 5 | 단계 분기 코드가 인증 모듈 밖에 0건 | CI grep(9장) |
| 6 | 외부 준비 완료: Google Cloud 프로젝트, OAuth 동의 화면(앱 이름, 지원 이메일, 로고, 개인정보처리방침·이용약관 URL, 승인된 도메인), 웹 클라이언트 ID, 운영 Supabase 프로젝트 | 5.1절 체크리스트 |

## 5. Stage B: Google OAuth

### 5.1 외부 설정 (사람)

| 순서 | 할 일 | 비고 |
|---|---|---|
| 1 | Google Cloud 콘솔 → OAuth 동의 화면: 사용자 유형 External, 범위는 기본(`openid`, `email`, `profile`)만 | 민감 범위를 쓰지 않으면 고급 검증 대상이 아니다(브랜드 정보 검토는 있을 수 있음, 미확인). 게시 상태 "테스트"에서는 등록한 테스트 사용자만 로그인된다 |
| 2 | 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션). 승인된 리디렉션 URI = `https://<project-ref>.supabase.co/auth/v1/callback`, 로컬은 `http://127.0.0.1:54321/auth/v1/callback` | 앱 도메인이 아니라 Supabase 콜백이다 |
| 3 | Supabase 대시보드 → Authentication → Providers → Google 사용, 클라이언트 ID·시크릿 입력 | 로컬은 3.4절 config |
| 4 | Authentication → URL Configuration: Site URL = 운영 도메인, Redirect URLs = `https://<도메인>/auth/callback`(미리보기 도메인은 명시 등록) | 와일드카드 지양(`config.toml.example` 주석) |
| 5 | 동의 화면을 "프로덕션"으로 게시 | 공개 베타 전 |

### 5.2 앱 변경 (B단계 작업이 하는 일)

| 항목 | 내용 |
|---|---|
| 로그인 화면 | "Google로 계속하기" 버튼(+ PRD가 이메일을 유지하면 이메일 폼). `signInWithOAuth({ provider: 'google', options: { redirectTo: <APP_URL>/auth/callback?next=..., queryParams: { prompt: 'select_account' } } })` |
| 콜백 | 3.2절 전체 구현과 단위 테스트 |
| 가입 화면 | OAuth는 가입과 로그인이 같은 버튼이다. 약관 동의는 첫 로그인 직후 온보딩에서 받는다(제품 온보딩 화면이 있으면 그 첫 단계, 없으면 `/onboarding/terms` 제안) |
| 계정 연결 | 같은 이메일의 이메일 가입자가 Google로 로그인하면 Supabase가 자동으로 같은 사용자에 연결한다(이메일 인증된 경우). 별도 코드 없음 |
| 초대제 앱 | 초대 메일의 이메일과 같은 Google 계정으로 로그인하면 같은 사용자. 다른 이메일이면 엔타이틀먼트 없는 새 사용자가 되므로 `/no-access`에서 "초대받은 이메일로 로그인하세요" 안내 |
| Mock | 코드는 남긴다(로컬 개발·E2E용). 배포 환경 env는 `AUTH_MODE=live`, `AUTH_PROVIDERS=google`(+`email`) |
| 개인정보 | 01_PRD 6절 수집 항목에 "Google 계정 식별자, 이름, 프로필 이미지 URL"을 적는다 |

### 5.3 B단계 수용 기준 (공통, 제품 작업에 그대로 옮긴다)

| # | 기준 |
|---|---|
| B-1 | 새 Google 계정으로 첫 로그인 → `session_context(<app>)`가 `entitled=true`, 기본 플랜, 가입·월 크레딧이 1회만 지급(재로그인 3회 뒤에도 원장 행 수 같음). invite 앱은 `entitled=false`이고 `/no-access` |
| B-2 | `next=//evil.com`, `next=https://evil.com`, `next=/\evil.com` → 제품 기본 경로 |
| B-3 | `code` 없음·재사용·만료 → `/login?error=callback`, 서버 오류 로그에 토큰·코드 없음 |
| B-4 | 배포 빌드(`VERCEL_ENV=production`)에서 `/api/dev/login` 404, 로그인 화면에 개발용 패널 없음, `AUTH_MODE=mock`이면 빌드 실패 |
| B-5 | Mock E2E(핵심 플로우) 계속 녹색. Google 실로그인은 사람이 수동 점검표(데스크톱·모바일 각 1회, 신규·기존 계정)로 확인하고 결과를 task `log.md`에 남긴다(실제 Google 로그인은 자동화하지 않는다) |
| B-6 | 운영 대시보드 Google 설정, Redirect URLs, `AUTH_PROVIDERS` 값이 배포 체크리스트와 일치 |

## 6. 게이트 G2: Google → 카카오·네이버

| # | 조건 | 확인 방법 |
|---|---|---|
| 1 | Google 실로그인으로 공개 베타 운영 2주(제안: 콜백 오류의 대부분은 첫 주 실사용에서 드러난다) | 운영 기간 |
| 2 | 인증 관련 P0·P1 장애 0, `/auth/callback` 오류율 1% 미만(제안) | 감사 `auth.login`과 오류 로그 |
| 3 | 신규 가입자 중 `entitled=false`로 남은 사용자 0(open 앱) | `select count(*) from core.profiles p where not exists (select 1 from core.app_entitlements e join core.org_members m on m.org_id = e.org_id where m.user_id = p.id and e.app_id = '<app>')`를 가입 기간으로 제한해 실행 |
| 4 | 카카오: 카카오 디벨로퍼스 앱 생성, 이메일이 필요하면 비즈 앱 전환(사업자 정보) | 7.1.1절 |
| 5 | 네이버: 애플리케이션 등록, 검수 신청 자료(로그인 버튼부터 가입 완료까지 화면 캡처) 준비, C2 스파이크 결과 기록 | 7.2절 |

## 7. Stage C: 카카오(C1)와 네이버(C2)

### 7.1 C1 카카오 (Supabase 기본 제공자 `kakao`)

#### 7.1.1 외부 설정 (사람)

| 순서 | 할 일 | 근거 |
|---|---|---|
| 1 | 카카오 디벨로퍼스 앱 생성 → REST API 키 = `client_id` | [Supabase: Login with Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao) |
| 2 | 카카오 로그인 Client Secret 활성 → `client_secret` | 같음 |
| 3 | Redirect URI = Supabase 콜백(`https://<project-ref>.supabase.co/auth/v1/callback`, 로컬 `http://localhost:54321/auth/v1/callback`) | 같음 |
| 4 | 카카오 로그인 활성(State ON), 동의항목 `profile_nickname`, `profile_image`, (비즈 앱이면) `account_email` | 같음. `account_email`은 비즈 앱에서만 받을 수 있다 |
| 5 | Supabase → Providers → Kakao 사용. 이메일을 받지 못하면 "Allow users without an email"을 켠다 | 같음 |

#### 7.1.2 이메일 정책 (결정 필요, 제품 PRD 8절)

| 선택 | 결과 | 권장 |
|---|---|---|
| (a) 비즈 앱 전환 후 `account_email` 필수 동의 | 영수증·알림 메일·계정 연결이 Google과 같다 | **권장**. 사업자등록이 있는 운영 주체면 전환 비용은 서류 입력뿐이다 |
| (b) 이메일 없이 허용 | `core.profiles.email`이 null(컬럼은 null 허용, `migrations/0001_core_identity.sql:14`). 결제 영수증·알림을 위해 온보딩에서 연락 이메일을 따로 받아야 하고, 같은 사람이 Google로 오면 다른 사용자가 된다 | 비즈 앱 전환 전 임시로만 |

#### 7.1.3 C1 수용 기준

| # | 기준 |
|---|---|
| C1-1 | 새 카카오 계정 첫 로그인 → B-1과 같은 결과(엔타이틀먼트·크레딧 1회) |
| C1-2 | 비즈 앱(a)이면 Google로 가입한 같은 이메일 사용자가 카카오로 로그인 → 같은 `user_id`(Supabase 자동 연결은 제공자가 이메일 인증을 확인한 경우에만, 미확인이면 수동 연결 7.3절) |
| C1-3 | (b)면 이메일 없는 사용자가 결제 전 연락 이메일 입력 화면을 본다 |
| C1-4 | 표시 이름은 카카오 닉네임, 없으면 `user` 규칙(`migrations/0001_core_identity.sql:124-129`) |
| C1-5 | 카카오 로그인 버튼은 카카오 디자인 가이드의 색·문구를 따른다(미확인: 가이드 최신판 확인 후 반영) |

### 7.2 C2 네이버

#### 7.2.1 사실 정리

| 항목 | 내용 | 상태 |
|---|---|---|
| Supabase 기본 제공자 | 없음 | 확인 |
| Supabase 커스텀 제공자 | 2026-04-08 출시. OAuth2(엔드포인트 직접 입력)·OIDC 두 방식, 식별자 `custom:<이름>`, PKCE 기본, `email_optional` 옵션, Free 플랜 프로젝트당 3개 | [Supabase 블로그](https://supabase.com/blog/custom-oauth-oidc-providers), [Custom OAuth/OIDC Providers 문서](https://supabase.com/docs/guides/auth/custom-oauth-providers) |
| 네이버 방식 | OIDC가 아니라 OAuth 2.0. authorize `https://nid.naver.com/oauth2.0/authorize`, token `https://nid.naver.com/oauth2.0/token`, 사용자 정보 `https://openapi.naver.com/v1/nid/me` | [Ory: Sign in with Naver](https://www.ory.com/docs/integrates-with/social-sign-in/naver) |
| 사용자 정보 형태 | 필드가 `response` 객체 아래에 중첩된다(`response.id`, `response.email`) | 같음 |
| 위험 | Supabase 커스텀 OAuth2가 중첩 응답에서 id·email을 읽는지 문서에 없다 | **미확인 → 스파이크** |
| 검수 | 검수 전에는 "개발중 상태"로 일반 사용자 로그인이 막힌다. 로그인 버튼부터 가입 완료까지의 화면 캡처를 제출한다 | [채널톡 클릭앤 도움말] (https://docs.channel.io/clickn/ko/articles/네이버-아이디로-로그인-261c8aeb) |

#### 7.2.2 스파이크 (C2 작업의 첫 단계, 0.5일)

| 단계 | 할 일 | 통과 기준 |
|---|---|---|
| 1 | 운영과 분리한 Supabase 프로젝트에 관리자 API(`auth.admin.customProviders.createProvider`)로 `custom:naver` 등록: `provider_type: 'oauth2'`, 위 세 엔드포인트, `scopes: []`(네이버는 앱 설정의 제공 항목으로 정함, 미확인) | 등록 성공 |
| 2 | 네이버 개발 중 상태 + 등록된 테스트 아이디로 `signInWithOAuth({ provider: 'custom:naver' })` | 로그인 성공, `auth.users`에 사용자 1명, `identities[].provider = 'custom:naver'` |
| 3 | `auth.users.email`이 네이버 이메일로 채워졌는지, 같은 계정 재로그인이 같은 사용자로 매칭되는지 | 둘 다 참이면 경로 `supabase_custom` 채택 |
| 4 | 실패하면 브리지 경로(7.2.3절) 채택. 결과를 `NAVER_AUTH_PATH`와 task `log.md` `[DECISION]`에 기록 | 기록 |

등록은 스크립트(`scripts/auth/register-naver-provider.mjs`, 제안)로 남겨 운영 프로젝트에도 같은 값으로 재현한다. 로컬 CLI가 커스텀 제공자를 지원하지 않으면(미확인) 로컬 개발은 Mock과 Google·카카오로 하고 네이버는 스테이징 프로젝트에서 확인한다.

#### 7.2.3 브리지 경로 (스파이크 실패 시)

| 순서 | 처리 | 보안 규칙 |
|---|---|---|
| 1 | `GET /auth/naver/start?next=` → 32바이트 state를 만들어 HttpOnly·Secure·SameSite=Lax 쿠키(HMAC `AUTH_BRIDGE_SECRET`, 10분)에 넣고 네이버 authorize로 302 | `core.oauth_states`는 로그인 전 사용자·조직이 없어 쓸 수 없다(`user_id not null`, `migrations/0004_core_security.sql:510-521`). 레이트 리밋 `auth:naver:<ip 해시>` 10회/10분 |
| 2 | `GET /auth/naver/callback?code&state` → 쿠키 state와 상수 시간 비교 후 쿠키 삭제 | 불일치·없음·만료 → `/login?error=state` |
| 3 | 서버가 client secret으로 토큰 교환 → `/v1/nid/me` 조회(`resultcode='00'` 확인) | 네이버 토큰은 저장하지 않는다(로그인에만 쓰고 버린다) |
| 4 | `core.auth_identity_links`에서 `(provider='naver', provider_user_id=response.id)` 조회(테이블: `D:/WorkSpace/platform/docs/products/_platform-core/staged/0010_core_auth_identity_links.sql`) | 이메일이 아니라 네이버 고유 id로 찾는다 |
| 5a | 연결 있음 → 그 `user_id`의 이메일로 `auth.admin.generateLink({ type: 'magiclink' })` → 서버 클라이언트 `verifyOtp({ token_hash, type: 'magiclink' })`로 세션 쿠키 설정 | 링크·토큰을 로그·응답에 남기지 않는다 |
| 5b | 연결 없음 + 같은 이메일 사용자 없음 → `auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name, avatar_url } })` → 링크 행 INSERT → 5a | 이메일 동의 항목을 네이버 앱 설정에서 필수로 둔다 |
| 5c | 연결 없음 + 같은 이메일 사용자 있음 → 자동 연결하지 않는다. `/login?error=email_in_use`("이미 다른 방법으로 가입한 이메일입니다. 그 방법으로 로그인한 뒤 설정에서 네이버를 연결하세요") | 이메일 일치만으로 계정을 합치면 탈취 경로가 된다 |
| 6 | 3.2절 2~6번(`finishLogin`) | |

알려진 함정: 브리지 로그인 뒤 `app_metadata.provider`가 `email`로 보인다. 제공자 판단은 `auth_identity_links`로만 한다. 사용자 목록 전체 조회(`listUsers`)로 사용자를 찾지 않는다(페이지 누락으로 중복 계정이 생긴다).

#### 7.2.4 C2 수용 기준

| # | 기준 |
|---|---|
| C2-1 | 스파이크 결과가 `[DECISION]`으로 기록되고 `NAVER_AUTH_PATH`가 그 값이다 |
| C2-2 | 새 네이버 계정 첫 로그인 → B-1과 같은 결과 |
| C2-3 | 같은 네이버 계정 재로그인 5회 → 같은 `user_id`, 사용자 수 증가 0 |
| C2-4 | (브리지) state 변조·재사용·쿠키 없음 → 거부, 세션 미생성. 다른 브라우저에서 받은 콜백 URL 재생 → 거부 |
| C2-5 | (브리지) 같은 이메일의 Google 가입자가 네이버로 처음 로그인 → `email_in_use` 안내, 새 사용자 0 |
| C2-6 | 네이버 검수 통과 전에는 운영 `AUTH_PROVIDERS`에 `naver`를 넣지 않는다(개발 중 상태 화면 노출 방지) |

### 7.3 계정 연결 화면 (C단계, P1)

| 항목 | 내용 |
|---|---|
| 위치 | 설정 → 로그인 방법. 연결된 제공자 목록, 연결·해제 |
| 연결 | 로그인 상태에서 `linkIdentity({ provider })`(Supabase 수동 연결, `[auth] enable_manual_linking = true` 필요). 브리지 네이버는 로그인 상태에서 1~3번 후 링크 행 INSERT(이미 다른 사용자에 연결된 네이버 id면 거부) |
| 해제 | 남는 로그인 수단이 1개 이상일 때만 |
| 감사 | `auth.identity_link`, `auth.identity_unlink` |

## 8. 제품별 적용 매트릭스

| 제품(app) | 가입 정책 | 로그인하는 사람 | A 추가 페르소나 | B | C1 카카오 | C2 네이버 |
|---|---|---|---|---|---|---|
| flora-publishing(`publishing`) | open | 작가 | - | Google + 이메일 | P1(D6 열린 결정 해소) | P1 |
| astro-ai(`astro`) | open | 일반 소비자 | 환영 크레딧 미지급 상태 사용자 | Google + 이메일(환영 크레딧은 Google 로그인 확인 후, AS-F-002) | P1(B2C 핵심) | P1 |
| sceneflow(`video`) | open | 크리에이터 | Advanced 팀 멤버 | Google + 이메일 | P1 | P1 |
| nomad-blog(`blog`) | open | 블로거·제휴 마케터 | - | Google + 이메일 | P1 | P1(네이버 블로거 비중) |
| nomad-commerce(`commerce`) | open | 셀러 | - | Google + 이메일 | P1(기존 MVP 카카오 이동) | P1 |
| microweb-studio(`microweb`) | invite | 초대받은 운영자(하객은 로그인 없음) | `studio_access` 허용·미허용 | Google + 초대 메일 | P2 선택 | P2 선택 |
| admin-suite(`erp`, `sms`, `hms`) | erp approval, sms invite, hms 별도 DB | 기관 직원 | doctor·staff·학교 역할, 가입 코드 대기자 | erp·sms Google + 이메일·초대. hms는 기관 정책 확인 전 이메일만(제안) | erp·sms P2 선택, hms 제외 | 같음 |
| live-poll(`poll`) | open | 진행자(청중은 로그인 없음) | 행사 진행자·공동 진행자 | Google + 이메일 | P1 | P1 |
| stock-dashboard(`stock`) | invite | 초대받은 개인 투자자 | 초대 수락·미수락 | Google + 초대 링크 | P2 선택 | P2 선택 |
| toon-factory(`toon`) | open | 작가·마케터 | - | Google + 이메일 | P1 | P1 |
| study-note(`notes`) | open | 수강생·강사 | - | Google + 이메일 | P1 | P1 |
| website-floria(`site`) | invite | 운영자(방문자는 로그인 없음) | `provision_site` 완료·미완료 | Google + 초대 메일 | 제외 | 제외 |
| nomad-docs(`docs`) | open | 프리랜서·에이전시 | - | Google + 이메일 | P1 | P1 |
| book-trailer(`trailer`) | open | 1인 출판사·작가·출판사 마케터 | creator 플랜 owner, publisher 팀(owner·member·viewer) | Google + 이메일 | P1 | P1 |
| arch-studio(`arch`, 제안) | open(앱은 시리얼 라이선스, 계정은 크레딧·클라우드 기능용) | 소규모 건축사사무소·전원주택 시공사 실무자 | 체험 중·체험 만료, 영구(업데이트 유효·만료 폴백), 월 구독, 기기 2대 활성화 완료(PRD 4.3·4.4절 상태) | Google + 이메일(데스크톱은 시스템 브라우저 로그인 후 앱 복귀, PRD D-15) | P2 선택(유료 B2B 실무 도구라 시리얼·영수증·세금계산서를 이메일로 보내므로 이메일 확보가 우선이고, 데스크톱 앱 복귀 경로를 제공자마다 검증해야 한다. 베타 가입 전환 데이터로 P1 승격 판단) | P2 선택(같음) |

로그인 없는 사용자(하객, 청중, 방문자)의 흐름은 단계와 무관하다. 그 화면에 로그인 버튼을 추가하지 않는다.

## 9. 작업 계획 반영 규칙 (각 제품 `06_AGENT_PLAN.md`)

| 규칙 | 내용 |
|---|---|
| A 작업 | 기존 인증 작업(가입·로그인·콜백·온보딩을 소유한 작업)의 범위를 "Stage A: 인증 모듈 경계(3.1절), Mock 로그인(2장), 시드 스크립트, 가드, `finishLogin`"으로 바꾼다. 이메일 가입·비밀번호 재설정 화면은 B 작업으로 옮긴다. 웨이브는 그대로 두되, 그보다 앞 웨이브의 작업은 시드 스크립트 없이 SQL·단위 테스트로 검증한다 |
| B 작업(신규) | "Stage B: Google OAuth 전환 + 이메일·초대 메일 화면". 소유 경로: 로그인 화면의 제공자 버튼, `/auth/callback`, 온보딩 약관 단계. 진입 조건: G1. 우선순위 P0(공개 베타 필수), 모델 Fable(권한 경계), 규모 M. 웨이브: 마지막 기능 웨이브 다음, 공개 베타 직전 통합·E2E 웨이브와 같은 웨이브의 맨 앞(통합 작업이 B 완료를 기다린다) |
| C1 작업(신규) | "Stage C1: 카카오 로그인". 진입 조건 G2. 우선순위는 8장 표(P1 또는 P2), 모델 Opus, 규모 S |
| C2 작업(신규) | "Stage C2: 네이버 로그인(스파이크 → `custom:naver` 또는 브리지)". 진입 조건 G2. 브리지면 코어 요청(아래). 모델 Fable(브리지는 세션 발급 경로), 규모 M |
| 제외 제품 | 8장에서 "제외"인 제품은 C 작업을 만들지 않고 01_PRD 2절 범위 표에 "제외(이유)"를 적는다 |
| 테스트 | Mock 페르소나 로그인 E2E는 기존 E2E 작업이 소유한다. B·C 수용 기준(5.3, 7.1.3, 7.2.4)은 각 작업의 수용 기준에 그대로 옮긴다 |
| CI 금지 문자열 | 기존 "Mock 로그인" 금지 검사는 "쿠키·localStorage 역할/플랜, `mock-auth`, `nomad_role`, `nomad_plan`, 인증 모듈 밖의 `AUTH_MODE` 참조" 검사로 바꾼다(2.4절) |
| 공용 모듈 요청 | 브리지 경로를 택하면 6절에 "코어: `staged/0010_core_auth_identity_links.sql` 적용"을 요청한다. 코어는 한 번만 적용하고 모든 제품이 쓴다 |
| 웨이브 표·모델 비율 | 새 작업을 넣고 3절 웨이브 표, 4절 비율, 7절 완료 정의(P0 작업 ↔ 테스트 작업 표)를 함께 갱신한다 |

## 10. 문서 반영 위치 (제품 공통)

| 문서 | 반영할 것 |
|---|---|
| `01_PRD.md` | 2절 범위 표: 인증 단계 A(MVP 개발)·B(공개 베타)·C(G2 후). 3절 가입·로그인 FR: 단계 표기, 수용 기준. 6절 개인정보 수집 항목: 단계별 제공자 식별자. 8절 열린 결정: 카카오 이메일 정책(7.1.2절), 네이버 경로(스파이크), 이메일 가입 유지 여부(공개 가입 제품) |
| `02_ARCHITECTURE.md` | 모듈 경계의 auth 행에 `src/lib/auth/`와 단계 분기 규칙. 전용 "인증 단계" 절(기존 제품은 9절)을 두고 그 안에 단계별 구성, 3.3절 환경변수 표, 제공자 콘솔(Google·카카오·네이버) 배포 설정을 적는다. 기존 환경변수 절에는 그 절을 가리키는 한 줄만 둔다 |
| `03_SCREENS_UX.md` | `/login`·`/signup`·`/auth/callback` 행에 단계별 표시(A 개발용 패널, B Google 버튼, C 카카오·네이버 버튼), 오류 상태(`error=callback`, `state`, `email_in_use`), 설정 → 로그인 방법(C) |
| `04_API.md` | `POST /api/dev/login`(A, 로컬 전용), `GET /auth/callback`(B), `GET /auth/naver/start`·`/auth/naver/callback`(C2 브리지만) |
| `05_DATA_MODEL.md` | 스키마 변경 없음(코어 계약 그대로). 브리지 경로 채택 시 코어 `auth_identity_links` 참조만 |
| `06_AGENT_PLAN.md` | 9장 규칙 |
| `07_SOURCE_MIGRATION.md` | 복사 금지: 쿠키 역할 Mock, `mock-auth.ts`, 콜백 `next` 무검증 |
| `CLAUDE.md` | "인증 단계 규칙" 절: 지금 단계, 단계 분기 위치 제한, 페르소나 사용법, 금지 패턴 |

## 11. 구현 지시서와 전체 적용 (2026-10-15 추가)

이 문서는 "무엇을 언제"를 정한다. "어떻게 만드는가"(Google Auth Platform·카카오 디벨로퍼스·네이버 개발자센터 화면별 설정과 공식 링크, 공용 모듈 `@nomad/core-auth` 파일 구성, 테스트, 버전·출시, 14개 제품 적용 순서와 절차)는 `D:/WorkSpace/platform/docs/develop/_shared/auth/README.md`가 정본이다.

| 항목 | 이 문서와의 관계 |
|---|---|
| 통합 DB 제품의 제공자 앱 | Supabase 제공자 설정은 프로젝트마다 1세트라, 모듈러 통합 DB 제품은 Google 동의 화면·카카오 앱·네이버 애플리케이션을 같이 쓴다. 브랜드 결정 AUTH-D1(통합 "NOMAD 계정" 권고)은 지시서 1장 |
| 제공자 허용 검사 | 3.2절 콜백 처리에 한 단계를 더한다: 이번 로그인의 제공자가 그 앱의 `AUTH_PROVIDERS`에 없으면 로그아웃 후 `/login?error=provider`(통합 프로젝트에서 다른 앱용으로 켠 제공자로 들어오는 것을 막는다). 공용 모듈 v1.0에 포함 |
| 네이버 커스텀 제공자 | 7.2.1절 사실 정리 그대로. 지시서 7.2절이 등록 화면(대시보드 New Provider → Manual configuration)을 더한다 |
| 전체 적용 | 공용 모듈 완성과 제품 단계 전환은 별개다. 제품은 자기 G1·G2 판정 뒤 환경변수로만 단계를 바꾼다(지시서 9장) |

### 11.1 local-news 추가 (2026-10-15)

| 제품 | 로그인 대상 | A | B | C1 카카오 | C2 네이버 | 비고 |
|---|---|---|---|---|---|---|
| local-news | 편집국 + 독자(신문사별 `news.readers`) | NW-06-004, 023 | NW-06-052, 053 | NW-06-054 | NW-06-055 | 독자 P1, 편집국 P2 선택. 커스텀 도메인 Redirect URL은 활성화 때 개별 등록. 코어 요청 R-1·R-2·R-3·R-10(`products/local-news/06_AGENT_PLAN.md` 6절) |

### 11.2 book-trailer 추가 (2026-10-16)

| 제품 | 로그인 대상 | A | B | C1 카카오 | C2 네이버 | 비고 |
|---|---|---|---|---|---|---|
| book-trailer | 작가·출판사(외부 승인 링크의 저자는 로그인 없음) | TR-06-004 | TR-06-053 | TR-06-054 | TR-06-055 | 로그인용 Google 클라이언트와 YouTube 채널 연결용 클라이언트를 나눈다(`products/book-trailer/01_PRD.md` D-17). 페르소나는 `products/book-trailer/05_DATA_MODEL.md` 10절 |
