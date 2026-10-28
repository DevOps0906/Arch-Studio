# Tauri: 데스크톱 앱 공용 가이드

작성일 2026-10-14. 이 폴더는 platform-docs의 제품(`products/`)을 Windows·macOS 설치형 데스크톱 앱으로 만들 때 공통으로 따르는 기획·개발 지침이다. 코드는 없고 지침과 계약 예시만 있다(`docs/products/_PRODUCT_AGENT_BRIEF.md:6`과 같은 원칙). 모바일은 [`../Capacitor/README.md`](../Capacitor/README.md)를 본다.

이 문서의 지위: 공용 지침 초안. `_platform-core`와 충돌하면 `_platform-core`가 우선하고, 이 문서가 코어 변경을 필요로 하는 항목은 15장 "코어 요청"에 모았다. 근거 없는 수치·정책은 "제안", 외부 사실을 원문으로 확인하지 않았으면 "미확인"으로 적는다(`docs/products/_platform-core/DOC_TEMPLATE.md:12-13`).

## 0. 읽는 순서

| 순서 | 문서 | 왜 |
|---|---|---|
| 1 | 이 문서 1~2장 | 데스크톱 앱이 필요한지, 흔한 오해가 무엇인지 |
| 2 | 이 문서 3~9장 | 공용 구조, 데이터 배치, 인증, 결제, 라이선스, 보안 |
| 3 | 이 문서 12장 | 자기 제품의 적용 방안 |
| 4 | 이 문서 13장 | 개발 착수 지시(작업 분해, 수용 기준, 요청 프롬프트) |
| 5 | `docs/products/_platform-core/`(`CORE_SPEC.md`, `SHARED_MODULES.md`, `SECURITY_BASELINE.md`, `AI_ARCHITECTURE.md`) | 셸 앱도 코어 규칙을 그대로 지킨다 |

## 1. 결론 요약

| 항목 | 내용 |
|---|---|
| 한 줄 | 제품의 화면(React)을 그대로 쓰고, 그 아래에 작은 Rust 계층(파일, 로컬 DB, 키체인, 업데이트, 라이선스, 네이티브 연동)을 붙여 설치형 앱으로 배포한다. 클라우드(Next.js Route Handler, FastAPI, Supabase)는 바뀌지 않는다 |
| 기준 버전 | Tauri 2.x(tauri 2.12.3, 2026-10-10 기준). 구현 시 최신 2.x를 고정한다 |
| 렌더링 엔진 | Windows WebView2(Chromium, 자체 업데이트), macOS WKWebView(OS 업데이트로만 갱신), Linux WebKitGTK(배포판 의존) |
| Electron 대신 Tauri를 기본으로 두는 이유 | (1) 설치 파일·메모리가 작다 (2) 로컬 백엔드가 네이티브 바이너리라 라이선스 검증 우회가 JS 묶음보다 어렵다 (3) 명령별 권한(capability) 모델이 기본으로 안전하다 (4) C 라이브러리 연동(FFI)이 Electron 버전과 무관하다 |
| Electron을 고를 때 | 첫 출시부터 Windows·macOS·Linux 렌더링이 완전히 같아야 할 때, Chromium 전용 API에 깊게 의존할 때, Rust를 전혀 쓸 수 없을 때. 갈아탈 수 있게 10장 `NativeBridge` 경계를 지킨다 |
| 데스크톱 앱이 필요 없는 경우 | 오프라인 동작, 대용량 로컬 파일, OS 장비 연동, 설치형 판매 중 어느 것도 없으면 웹(PWA 포함)으로 충분하다. 셸 앱은 빌드·서명·업데이트·OS별 테스트 비용을 추가로 만든다(린 원칙: 웹으로 먼저 검증) |

## 2. 흔한 설명의 검토: "Tauri·Capacitor에서 Supabase/Firebase를 웹처럼 그대로 쓴다"

아래 설명(2026-10-14 대표님 공유)은 방향은 맞지만, 그대로 구현하면 막히거나 보안 구멍이 생기는 부분이 있다. 이 장은 Tauri·Capacitor 공통이며 Capacitor 가이드도 이 장을 인용한다.

> 요지: Capacitor(모바일)와 Tauri(데스크톱)는 웹 기술을 쓰므로 Supabase·Firebase 웹 SDK를 그대로 쓸 수 있다. 구글 로그인 등은 웹뷰가 브라우저처럼 처리하고 토큰을 안전하게 저장한다. Tauri는 로컬 SQLite(대용량 파일, 로컬 로그, 챗봇 기록, 민감 작업물)와 Supabase(계정, 구독·결제, 팀 공유, 백업)를 하이브리드로 쓰면 가장 강력하다.

| # | 주장 | 판정 | 실제로 필요한 것 | 이 문서 위치 |
|---|---|---|---|---|
| 1 | 웹 SDK를 그대로 쓸 수 있다 | 맞음 | `supabase-js`의 DB 조회, Realtime, Storage는 웹뷰에서 그대로 동작한다. 단 레포 표준 백엔드는 Supabase 하나다. Firebase는 Capacitor Android 푸시(FCM 전송 경로)에만 쓴다. DB·인증을 두 클라우드에 나누면 RLS·감사·크레딧 규칙이 두 벌이 된다 | 3장 |
| 2 | 구글 로그인을 웹뷰가 브라우저처럼 처리한다 | 틀림 | Google은 임베디드 웹뷰 안의 OAuth 요청을 차단한다(`disallowed_useragent`, 2021년 정책 공지). 소셜 로그인은 시스템 브라우저에서 PKCE로 진행하고 딥링크(또는 데스크톱 루프백)로 앱에 돌아와 코드를 세션으로 교환해야 한다. 이메일·비밀번호 로그인은 웹뷰 안에서 그대로 된다 | 5장 |
| 3 | 토큰을 안전하게 저장한다 | 보완 필요 | `supabase-js` 기본 저장소는 웹뷰 `localStorage`라 평문이다. `createClient`의 `auth.storage`에 OS 키체인 어댑터(Tauri `keyring`, Capacitor 보안 저장소)를 넣어야 "안전한 저장"이 된다 | 5.3절 |
| 4 | 클라이언트가 클라우드 DB와 바로 통신한다 | 조건부 맞음 | 셸 앱 번들은 사용자 PC에 있으므로 anon key와 RLS가 유일한 방어선이다. `service_role`, AI 제공자 키, 크레딧 차감, 결제 확정은 셸에 절대 두지 않는다(`docs/products/_platform-core/SHARED_MODULES.md:71`, `SECURITY_BASELINE.md` 11장). AI 기능은 웹과 똑같이 제품 Route Handler(`/api/ai/*`)만 부른다(`docs/products/_platform-core/AI_ARCHITECTURE.md:9-10`) | 6장 |
| 5 | Next.js 앱을 그대로 넣는다 | 틀림 | Tauri는 정적 파일만 싣는다(`output: 'export'`). Route Handler, Server Action, `proxy.ts`, SSR은 셸 안에서 돌지 않는다. 서버 기능은 클라우드에 남기고 셸은 그것을 HTTPS로 부른다. 그런데 코어 인증은 쿠키 세션 기반이라(`docs/products/_platform-core/SHARED_MODULES.md:70`, `CORE_SPEC.md:98`) 셸의 `Authorization: Bearer` 요청을 받는 경로가 코어에 필요하다(코어 요청 T-C1) | 3장, 6장 |
| 6 | 로컬 SQLite + Supabase 하이브리드가 가장 강력하다 | 맞음, 단 비용이 있다 | 진짜 비용은 동기화다: 충돌 해결, 삭제 전파, 두 DB의 스키마 마이그레이션, 오프라인 중 권한 변경. 테이블마다 "정본 위치"를 먼저 정하지 않으면 데이터가 갈라진다 | 4장 |
| 7 | 구독·결제 상태는 Supabase가 관리한다 | 맞음 | 추가 규칙: 오프라인에서 권한을 판단해야 하면 로컬 DB 값이 아니라 서버가 서명한 라이선스 파일만 믿는다. 로컬 SQLite는 사용자가 수정할 수 있다 | 8장 |
| 8 | 챗봇 대화 기록을 로컬에 둔다 | 보완 필요 | 레포 AI 구조에서 대화는 이미 `core.ai_conversations`와 Dify에 남는다(`docs/products/_platform-core/AI_ARCHITECTURE.md:44-56`). 로컬에는 열람용 사본만 둔다. 서버에 남기면 안 되는 대화라면 로컬 LLM 경로를 따로 설계해야 하며 크레딧·출처 규칙도 따로 정한다 | 4.2절 |
| 9 | "가장 강력한 아키텍처" | 과장 | 웹 대비 추가되는 것: OS별 빌드·코드 서명, 업데이트 서버, 두 DB, 웹뷰 차이 테스트. 오프라인·대용량 로컬 파일·장비 연동·설치형 판매 중 하나 이상이 있을 때만 이득이다 | 1장, 12장 |

## 3. 공용 구조

```
┌──────────────────────── 사용자 PC ────────────────────────┐
│ WebView (WebView2 / WKWebView)                            │
│   apps/desktop  React + Vite(또는 Next.js output:'export') │
│   packages/ui, packages/features   ← 웹과 공유            │
│   Web Worker: 제품 엔진(TS 순수 함수, WASM)               │
│        │ NativeBridge (TS 인터페이스, 10장)               │
│        ▼  invoke() / 이벤트                               │
│ Rust 코어 (src-tauri)                                     │
│   commands: fs, local_db(SQLite), secrets(keyring),       │
│             license, device, updater, sidecar, deeplink   │
└───────────────┬───────────────────────────────────────────┘
                │ HTTPS (Authorization: Bearer <Supabase JWT>)
                ▼
┌──────────────────────── 클라우드 (변경 없음) ──────────────┐
│ Next.js apps/web: Route Handler(/api/*, /api/ai/*), 결제,   │
│                   라이선스 발급, 업데이트 매니페스트        │
│ FastAPI apps/api: LLM 라우터, RAG, LangGraph               │
│ Supabase: core + 제품 스키마, RLS, Realtime, Storage       │
│ 공용 서비스: WeasyPrint 렌더, Dify, 잡 워커                │
└────────────────────────────────────────────────────────────┘
```

| 계층 | 책임 | 하지 않는 일 |
|---|---|---|
| 화면(WebView) | 입력·표시, 로컬 엔진 실행(Web Worker), Supabase 읽기(RLS 범위), 제품 API 호출 | 비밀 보관, 크레딧 차감, 결제 확정, 권한 최종 판정 |
| Rust 코어 | OS 기능(파일, 키체인, 기기 식별), 로컬 DB, 라이선스 서명 검증, 업데이트, 외부 프로세스·C 라이브러리 연동 | 비즈니스 규칙 중복 구현(엔진은 TS 패키지 하나), 클라우드 비밀 보관 |
| 클라우드 | 정본 데이터, 권한, 크레딧, 결제, AI, PDF 렌더 | 사용자 PC 파일 직접 접근 |

원칙: 제품 로직(규칙엔진, 효과 엔진, 계산)은 TS 순수 함수 패키지 하나로 두고 웹·데스크톱·서버가 같은 코드를 쓴다. Rust에는 OS 접점만 둔다. 이 원칙을 지키면 Rust 코드는 제품당 수천 줄 안쪽(추정)이고, 화면 코드는 웹과 거의 그대로 공유된다.

## 4. 데이터 배치 규칙 (로컬 SQLite와 Supabase)

### 4.1 정본 위치를 테이블마다 정한다

| 분류 | 정본 | 로컬 SQLite | Supabase | 예 |
|---|---|---|---|---|
| A. 클라우드 정본 | Supabase | 읽기 캐시만(만료 시각 포함) | 정본 | 계정, 조직·역할, 플랜·구독, 크레딧 잔액·원장, 결제, 라이선스, 감사 로그 |
| B. 로컬 정본 | 로컬 | 정본 | 없음 또는 사용자가 켠 백업(암호화 사본) | 대용량 작업 파일, 3D 모델, 로컬 자동화 로그, 오프라인 초안, 민감 작업물 |
| C. 동기화 | 둘 다(규칙 필요) | 작업 사본 + 변경 대기열(outbox) | 공유·백업 정본 | 팀 공유 프로젝트, 기기 간 이어 쓰기 |
| D. 파생 | 어느 쪽에도 저장 안 함 | 계산 시 생성 | 계산 시 생성 | 엔진 판정 결과, 합계, 미리보기 |

- A를 로컬에서 판정하지 않는다. 오프라인 권한이 필요하면 서버가 서명한 라이선스 파일(8장)만 믿는다(`docs/products/_platform-core/SECURITY_BASELINE.md:183`: 기능 게이팅은 서버).
- B를 클라우드에 올리는 기능(백업, 렌더 입력 업로드)은 사용자가 실행할 때만, 필요한 부분만 올린다. 무엇을 올리는지 실행 전에 보여 준다.
- C는 꼭 필요할 때만 만든다. MVP는 A + B만으로 시작하고 C는 Phase 2 이후로 둔다(제안: 동기화 버그가 데이터 손실로 이어져 비용이 가장 크다).

### 4.2 동기화(C)를 만들 때의 규약 (제안)

| 항목 | 규칙 |
|---|---|
| 식별자 | 행 id는 클라이언트가 만드는 UUIDv7. 로컬·클라우드가 같은 id를 쓴다 |
| 버전 | 행마다 `version`(정수)과 `updated_at`(서버 시각). 서버가 쓰기 시 `version`을 올린다 |
| 변경 대기열 | 로컬 쓰기는 같은 트랜잭션에서 `outbox` 행을 남긴다. 온라인이 되면 순서대로 서버 RPC로 보낸다 |
| 충돌 | 서버의 `version`이 기대값과 다르면 거부(SQLSTATE `<제품>0xx`). 클라이언트는 서버 행을 받아 사용자에게 병합 화면을 보여 준다. "마지막 쓰기 승리"를 조용히 적용하지 않는다(`docs/products/_platform-core/SECURITY_BASELINE.md:189`: mock·은폐 금지와 같은 취지) |
| 삭제 | 소프트 삭제(`deleted_at`)로 전파하고 휴지통 기간 후 purge |
| 서버 쓰기 경로 | 동기화 RPC는 SECURITY DEFINER + 소유권 확인 + `set search_path`(`SECURITY_BASELINE.md` 1~4장). 클라이언트가 보낸 org_id는 무시하고 세션에서 정한다 |
| 스키마 | 로컬 SQLite 마이그레이션은 앱 버전과 함께 배포하고, 서버 스키마보다 늦게 바뀌어도 동작하도록 필드 추가만 허용(삭제·이름 변경은 두 번에 나눠 배포) |
| 동기화 엔진 | 직접 구현이 기본. 상용·오픈소스 동기화 엔진(Supabase 연동을 내세우는 제품들)은 Tauri 지원·라이선스·비용을 확인한 뒤 도입한다(미확인) |

### 4.3 로컬 DB 구현

| 항목 | 기준 |
|---|---|
| 라이브러리 | Rust `rusqlite`(번들 SQLite) 또는 `tauri-plugin-sql`(sqlx). 화면에서 SQL을 직접 실행하지 않고 Rust 명령(`local_db_*`)으로만 접근한다(권한 범위를 명령 단위로 묶기 위해) |
| 위치 | OS 앱 데이터 폴더(`app_data_dir`). 사용자 문서 폴더에는 사용자가 내보낸 파일만 쓴다 |
| 암호화 | 민감 작업물이 있는 제품은 SQLCipher 계열 사용 검토, 키는 OS 키체인에 둔다(제안) |
| 백업 | 앱 업데이트 전 자동 스냅샷 1개 보관 |

## 5. 인증

### 5.1 방식별 흐름

| 방식 | 셸 안 처리 | 흐름 |
|---|---|---|
| 이메일·비밀번호 | 웹뷰 안에서 그대로 | `signInWithPassword` → 세션을 키체인 어댑터에 저장. 가입은 `options.data.signup_app` 필수(`docs/products/_platform-core/SHARED_MODULES.md:84`) |
| 매직 링크·OTP | 메일 링크 → 딥링크 또는 6자리 코드 입력 | 데스크톱은 코드 입력 방식이 단순하다(제안) |
| 소셜(Google, Kakao 등) | 시스템 브라우저 | `signInWithOAuth({ provider, options: { redirectTo: '<앱 스킴>://auth/callback', skipBrowserRedirect: true } })`로 URL만 받아 시스템 브라우저로 연다 → 사용자가 로그인 → 딥링크(`tauri-plugin-deep-link`)로 앱이 `code`를 받음 → `exchangeCodeForSession(code)`. 클라이언트는 `flowType: 'pkce'`로 만든다 |
| 딥링크가 막힌 환경 | 루프백 | 앱이 `127.0.0.1`의 임시 포트로 콜백을 받는 방식(데스크톱 OAuth 표준 관행). 커뮤니티 플러그인 사용 시 유지 상태 확인(미확인) |

- Supabase 대시보드 Redirect URLs에 `<앱 스킴>://auth/callback`(제품별)을 등록한다(코어 요청 T-C6).
- 딥링크로 들어온 URL은 신뢰하지 않는다. 앱이 직전에 시작한 로그인 시도(PKCE verifier 보유)에 대한 콜백만 처리한다.
- 첫 적용 제품 arch-studio는 이 흐름을 열린 결정 D-15(권고: 커스텀 스킴 딥링크, 막히면 루프백, 이메일은 앱 안 폼)와 D-16(시리얼은 계정 조직에 귀속, 활성화는 로그인 계정으로만)으로 이미 정했다(`docs/products/arch-studio/01_PRD.md` 8장). 다른 제품은 이 결정을 기본값으로 쓴다.

### 5.2 세션과 클라우드 API

| 항목 | 규칙 |
|---|---|
| Supabase 직접 조회 | `supabase-js`가 세션 토큰을 자동으로 붙인다. RLS가 그대로 적용된다 |
| 제품 Route Handler 호출 | 웹은 쿠키, 셸은 `Authorization: Bearer <access_token>`. 코어 `requireSession`이 Bearer도 검증하도록 확장이 필요하다(코어 요청 T-C1). 그 전까지 셸은 Supabase 직접 조회 범위의 기능만 쓴다 |
| CORS | Route Handler는 셸 출처(Tauri 기본: Windows `http://tauri.localhost`, macOS `tauri://localhost`. 구현 시 확인)만 허용 목록에 넣는다(코어 요청 T-C2). 와일드카드 금지 |
| 토큰 갱신 | `autoRefreshToken: true`. 앱이 절전에서 돌아오면 갱신을 먼저 시도한다 |
| 로그아웃 | 키체인 항목 삭제 + 로컬 캐시(A 분류) 삭제. B 분류(로컬 정본)는 지우지 않고 물어본다 |

### 5.3 토큰 저장 어댑터 (계약 예시)

```ts
// packages/shell-bridge (계약 예시, 구현 아님)
export interface SecureStore {
  getItem(key: string): Promise<string | null>   // Rust: keyring 조회
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}
// createClient(url, anonKey, { auth: { storage: secureStore, flowType: 'pkce',
//   autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })
```

### 5.4 인증 단계(확정 결정 22)와의 정합

셸 앱도 `docs/products/_platform-core/AUTH_ROADMAP.md`의 단계(A Mock → B Google → C1 카카오, C2 네이버)와 불변 조건(세션은 항상 실제 Supabase JWT, 권한 판정은 `session_context` 하나, 단계 분기는 인증 모듈 안에서만, `AUTH_ROADMAP.md:18-23`)을 그대로 따른다. 웹과 다른 점은 콜백을 서버(`/auth/callback`, `@supabase/ssr`)가 아니라 앱이 딥링크로 받아 클라이언트에서 교환한다는 것 하나다.

| 단계 | 웹(`AUTH_ROADMAP.md`) | 셸 앱(Tauri·Capacitor) |
|---|---|---|
| A Mock | `POST /api/dev/login`(로컬 전용)으로 시드 계정 실제 로그인 | 개발 빌드에서만 로컬 Supabase 시드 계정으로 `signInWithPassword`(실제 JWT). 허용 조건은 `AUTH_ROADMAP.md:78-86`의 판정을 빌드 시점에 적용: `AUTH_MODE=mock` + Supabase URL 호스트가 `127.0.0.1`·`localhost` + 개발 빌드. 서명·배포용 빌드에 Mock 코드가 들어가면 CI가 실패해야 한다(제안: 빌드 산출물에서 페르소나 키 문자열 검사) |
| B Google | 서버 콜백에서 `exchangeCodeForSession` | 시스템 브라우저 + PKCE + 딥링크 → 앱에서 `exchangeCodeForSession`(5.1절). Supabase Redirect URLs에 앱 스킴·Universal Link를 와일드카드 없이 명시 등록(`AUTH_ROADMAP.md:195`의 원칙, 코어 요청 T-C6) |
| C1 카카오 | Supabase 기본 제공자 `kakao` | B와 같은 흐름(시스템 브라우저 웹 로그인). 카카오톡 앱 간 로그인은 카카오 네이티브 SDK가 필요해 범위 밖(제안) |
| C2 네이버 | `custom:naver` 또는 서버 브리지(스파이크로 결정) | `custom:naver`가 채택되면 B와 같은 흐름. 서버 브리지 경로는 세션이 시스템 브라우저 쿠키에 생기므로 앱으로 넘기는 1회용 교환 코드 설계가 따로 필요하다(코어 요청 T-C7). 그 전까지 셸 앱은 네이버를 제공하지 않는다 |
| 모듈 위치 | `@nomad/core-auth`(`develop/_shared/auth/README.md` 3장): Route Handler·서버 컴포넌트 팩토리, `finishLogin` | 셸에는 Route Handler가 없으므로 딥링크 수신, 클라이언트 교환, 보안 저장소는 core-auth 밖 `packages/shell-bridge`에 둔다(공용 인증 가이드의 arch-studio 메모 "앱 복귀 방식을 패키지 밖에 추가", `develop/_shared/auth/README.md:233`). 교환 직후 셸은 서버의 `finishLogin`을 Bearer로 한 번 호출해 제공자 허용 검사, `no_profile` 처리, 감사 `auth.login`을 웹과 같은 코드로 거친다(코어 요청 T-C8). 기능 코드에 `if (tauri)`·`if (mock)` 금지(`AUTH_ROADMAP.md:23`) |
| iOS 추가 | 해당 없음 | 제3자 소셜 로그인을 넣으면 Apple 로그인 대안 제공 의무 여부를 확인(Capacitor 가이드 2장 2번) |

## 6. 클라우드 API 호출 규약

| 항목 | 규칙 | 근거 |
|---|---|---|
| AI | 셸도 `/api/ai/*`만 부른다. Dify·FastAPI·LLM 제공자 직접 호출 금지 | `docs/products/_platform-core/AI_ARCHITECTURE.md:9-10` |
| 비밀 | `service_role`, LLM 키, Toss 시크릿, 서명 개인키는 셸 번들·Rust 바이너리에 넣지 않는다. 바이너리도 추출된다고 가정한다 | `docs/products/_platform-core/SHARED_MODULES.md:71` |
| 크레딧 | 셸은 "작업 요청"만 보낸다. 금액·크레딧 수를 보내지 않는다. 차감은 서버 service_role 경로 | `docs/products/_platform-core/DB_CONVENTIONS.md:240` |
| 사용자 API 키(BYOK) | 기본 금지. 데스크톱 예외(OS 키체인 저장, 서버 미전송)는 코어 문서 변경 후에만(코어 요청 T-C5) | `docs/products/_platform-core/SECURITY_BASELINE.md:121` |
| 대용량 업로드 | Storage 서명 업로드 URL을 서버에서 받아 Rust가 스트리밍 업로드(화면 메모리 절약). 경로는 서버가 만든다 | `docs/products/nomad-docs/CLAUDE.md` 4장 Storage 규칙 |
| 실패 | 네트워크 실패는 재시도 대기열에 넣고 사용자에게 보인다. 실패를 성공처럼 표시하지 않는다 | `docs/products/_platform-core/SECURITY_BASELINE.md:189` |

## 7. 결제

| 항목 | 규칙 |
|---|---|
| 기본 흐름 | 셸 안 결제창 대신 시스템 브라우저로 웹 결제 페이지(`apps/web`)를 연다 → Toss 결제 → 서버 웹훅으로 확정(`core.confirm_payment_order`) → 셸은 Realtime 또는 폴링으로 결과를 받는다. 딥링크 복귀는 편의 기능일 뿐 결제 확정 근거가 아니다 |
| 이유 | 결제 SDK의 리디렉션·팝업·간편결제 앱 전환이 웹뷰에서 깨질 수 있고(미확인, 제품별 실기 확인), 결제 확정은 원래 서버 웹훅만 믿는다(`docs/products/_platform-core/SECURITY_BASELINE.md` 6장) |
| 스토어 | 직접 배포(웹사이트 다운로드)는 앱스토어 결제 정책 대상이 아니다. Microsoft Store·Mac App Store로 배포할 때는 각 스토어의 결제 정책을 따로 확인한다(미확인) |
| 일회성 상품 | 영구 라이선스처럼 구독이 아닌 상품은 코어 `payment_orders.kind` 확장이 필요하다(코어 요청 T-C3, `docs/products/arch-studio/01_PRD.md` 8.1절 C-1) |

## 8. 설치형 판매 공통: 라이선스와 업데이트

설치형으로 파는 제품(영구 라이선스, 연간 업데이트)은 arch-studio 규격(`docs/products/arch-studio/01_PRD.md:117`)을 공통 기준으로 쓴다.

| 항목 | 공통 규격 |
|---|---|
| 라이선스 파일 | 서버가 Ed25519로 서명한 JSON(`license_id`, `org_id`, `app_id`, `sku`, `updates_until`, `activation_id`, `device_hash`, `issued_at`, `kid`). 앱에는 공개키만. 개인키는 AI 서명 토큰 키와 분리(코어 요청 T-C4) |
| 검증 위치 | Rust 코어. 화면 코드는 결과만 받는다 |
| 기기 식별 | OS 머신 ID를 앱별 솔트로 해시한 값만 서버로 보낸다 |
| 활성화 수 | 제품 PRD에서 정한다(기본 제안 2대) |
| 업데이트 | `tauri-plugin-updater`. 업데이트 서버(제품 Route Handler)가 요청마다 라이선스를 확인해 `build_date <= updates_until`인 빌드만 내준다. 업데이트 파일은 Tauri 업데이트 서명키로 서명한다(이 키는 라이선스 키·코드 서명 인증서와 별개) |
| 폴백 | 업데이트 기간이 끝나도 마지막 자격 버전은 계속 실행되고, 계정 화면에서 그 설치 파일을 다시 받을 수 있다 |
| 구독형 셸 | 라이선스 파일 대신 세션 + 서버 엔타이틀먼트(`requireSession`)로 판정한다. 오프라인 허용 기간은 제품 PRD에서 정한다 |

## 9. 보안 기준

| 항목 | 규칙 |
|---|---|
| 권한(capability) | 창별로 필요한 명령만 허용. 파일 접근은 앱 데이터 폴더와 사용자가 대화상자로 고른 경로로 제한. `shell` 플러그인은 등록된 sidecar만 실행 |
| 원격 콘텐츠 | 셸은 번들된 정적 화면만 로드한다. 원격 URL을 메인 창에 띄우지 않는다. 외부 링크는 시스템 브라우저로 연다. 원격 콘텐츠에 IPC 권한을 주지 않는다 |
| CSP | `connect-src`는 제품 API 도메인, Supabase 프로젝트 도메인, 업데이트 서버만. `script-src 'self'`. 인라인 스크립트 금지 |
| IPC 입력 | Rust 명령의 모든 인자를 검증(경로 정규화, 길이·형식 제한). 화면에서 받은 경로를 그대로 열지 않는다 |
| 비밀 | 6장. Rust 바이너리에 키를 넣어도 추출된다고 가정한다 |
| 로그 | 토큰, 사용자 작업물 본문, 프롬프트 전문을 로그 파일에 남기지 않는다(`docs/products/_platform-core/SECURITY_BASELINE.md:200`, `:305`) |
| 코드 서명 | Windows는 코드 서명 인증서(SmartScreen 경고 방지), macOS는 Developer ID 서명 + 공증(notarization). 인증서 비용·발급 기간은 출시 일정에 넣는다(미확인: 제공사별 가격) |
| 의존성 | `Cargo.lock`, lockfile 커밋, `latest` 금지(`docs/products/nomad-docs/CLAUDE.md` 5장과 같은 원칙). `cargo audit`를 CI에 넣는다 |

## 10. 모노레포 구조와 공용 패키지 (제안)

```
<제품 개발 폴더>/
├── apps/web/            Next.js 16.2 (클라우드: 랜딩, Route Handler, 결제, 업데이트 매니페스트)
├── apps/api/            FastAPI (AI)
├── apps/desktop/        Tauri 셸
│   ├── src/             Vite + React 진입점, 라우팅(React Router)
│   └── src-tauri/       Rust 코어 (Cargo.toml, tauri.conf.json, capabilities/, src/commands/)
├── packages/ui/         디자인 시스템 컴포넌트(Tailwind CSS v4 토큰) - 웹·데스크톱 공유
├── packages/features/   화면 기능 단위 - 데이터 접근은 주입받은 클라이언트로만
├── packages/engine/     제품 엔진(TS 순수 함수, WASM 래퍼) - 웹·데스크톱·서버 공유
├── packages/shell-bridge/  NativeBridge 인터페이스 + Tauri 구현 + 웹 대체 구현
└── supabase/            마이그레이션(클라우드 정본)
```

| 결정 | 기준 |
|---|---|
| 셸 화면 빌드 도구 | Vite + React Router를 기본으로 둔다(제안). Next.js를 쓰려면 `output: 'export'`, `images.unoptimized: true`, `frontendDist: '../out'`, 개발 시 `assetPrefix` 설정이 필요하고 서버 기능은 쓸 수 없다 |
| 화면 공유 범위 | `packages/ui`와 `packages/features`를 공유한다. 서버 컴포넌트에 의존하는 화면은 데이터 로딩을 hooks로 분리해야 공유된다 |
| NativeBridge | 화면은 Tauri API를 직접 import하지 않고 `packages/shell-bridge`만 부른다. 웹 빌드에서는 같은 인터페이스의 웹 구현(파일 대화상자 → `<input type=file>` 등)이 들어간다. Electron으로 바꿀 때 이 패키지만 교체한다 |
| Tailwind | Tailwind CSS v4 고정(`README.md` 6장 규칙) |

```ts
// packages/shell-bridge (계약 예시, 구현 아님)
export interface NativeBridge {
  platform: 'web' | 'tauri'
  secureStore: SecureStore                                   // 5.3절
  files: { pickOpen(filters: FileFilter[]): Promise<LocalFile | null>; saveAs(name: string, data: Uint8Array): Promise<boolean> }
  localDb: { query<T>(name: string, params: unknown): Promise<T[]>; exec(name: string, params: unknown): Promise<void> } // 이름 붙은 쿼리만
  license?: { status(): Promise<LicenseStatus>; activate(serial: string): Promise<LicenseStatus> }
  updater?: { check(): Promise<UpdateInfo | null>; install(): Promise<void> }
  openExternal(url: string): Promise<void>                    // 시스템 브라우저
  onDeepLink(cb: (url: string) => void): () => void
}
```

## 11. 빌드·배포

| 항목 | Windows(MVP 기본) | macOS(Phase 2 기본) |
|---|---|---|
| 설치 형식 | NSIS 또는 MSI | `.dmg`(앱 번들) |
| 웹뷰 | WebView2. Windows 11 기본 포함, 없으면 설치 프로그램이 부트스트랩. 기업 고객용으로 고정 버전 런타임 동봉 옵션(용량 증가) | WKWebView. OS 버전에 따라 기능이 다르다. 최소 macOS 버전을 PRD에 적는다 |
| 서명 | 코드 서명 인증서 | Developer ID 서명 + 공증 |
| 렌더링 기준 | Chromium 수준 | WebKit 수준. 3D 제품은 WebGL2를 기준으로 만들고 WebGPU는 선택 가속(WKWebView의 WebGPU 기본 활성 여부 미확인) |
| CI | GitHub Actions에서 OS별 러너로 빌드·서명·업데이트 매니페스트 생성(Tauri 공식 액션 사용 검토) | 같음 |
| 회귀 테스트 | WebView2 Beta 채널로 사전 확인 | 신규 macOS 베타에서 사전 확인 |

## 12. 제품별 적용 방안

판정 기준: 오프라인 필요, 대용량 로컬 파일, OS·장비 연동, 설치형 판매, 비용 절감(로컬 처리로 클라우드 원가 감소). 우선순위는 제안이며 각 제품 `01_PRD.md` 2장(범위)에서 확정한다. 데스크톱 셸은 확정 결정의 MVP 범위를 바꾸지 않는다(`docs/products/_platform-core/DOC_TEMPLATE.md:74`).

| 제품 | 데스크톱 이득 | 로컬로 내릴 것 | 로컬 SQLite(B·C 분류) | 네이티브 연동 | 권고 |
|---|---|---|---|---|---|
| arch-studio | 매우 큼(본체가 설치형) | 모델러, 규칙엔진, 엔벨로프, 파일 입출력 | 프로젝트, 3D 모델, 판정 기록 | 키체인, 라이선스, .3dm·IFC, (조건부) SketchUp C API | MVP 필수 |
| sceneflow | 큼 | 영상 편집·인코딩(FFmpeg sidecar), 원본 관리 | 원본 목록, 편집 프로젝트, 업로드 대기열 | FFmpeg, 대용량 파일 스트리밍 업로드 | Phase 2. 클라우드 렌더 원가 절감 효과를 먼저 측정 |
| nomad-docs | 중간 | 기밀 RFP 로컬 파싱, 오프라인 편집 | 초안, 업로드 원본 캐시 | 키체인, 파일 | Phase 2. 설치형 판매 수요(`docs/products/nomad-docs/README.md:74`)가 확인되면 |
| book-trailer | 중간 | 미출간 원고 로컬 파싱, (선택) 로컬 Remotion 렌더로 렌더 원가 절감 | 원고 캐시, 작업 중 장면 초안 | 키체인, 파일, (조건부) 로컬 Chromium 렌더 sidecar | Phase 3. 출판사 설치형(판매 모델 A, `docs/products/book-trailer/README.md` 5장) 수요가 확인되면. 로컬 렌더는 Remotion 라이선스 조건(직원 수 기준)을 먼저 확인 |
| admin-suite(hms) | 큼 | 접수·대기열 화면 오프라인 지속, 장비 연동 | 대기열 캐시(정본은 서버) | 영수증·라벨 프린터, 바코드 스캐너(미확인: 장비 SDK) | Phase 2. 의료정보 규제 확인 후(`develop/README.md` 개발 순서 5단계) |
| admin-suite(erp) | 중간 | 오프라인 판매 입력 | 판매 outbox(C 분류) | 프린터, 스캐너 | Phase 2 |
| toon-factory | 중간 | 컷 조립·PNG 내보내기 | 캐릭터 모듈 캐시, 작업 회차 | 파일 | Phase 3 |
| flora-publishing | 중간 | 원고 집필 오프라인 | 원고 초안(C 분류) | 파일, 폰트 | Phase 3. 동기화 비용 대비 효과 검증 후 |
| nomad-commerce | 낮음~중간 | 대량 이미지·엑셀 처리 | 작업 캐시 | 파일 | Phase 3 |
| stock-dashboard | 낮음~중간 | 멀티 모니터 위젯, 항상 위 창 | 화면 설정 | 알림 | Phase 3. 금융 규제 확인 후 |
| live-poll | 낮음~중간 | 진행자용 발표·방송 오버레이 창(항상 위, 투명 창) | 없음 | 창 제어 | Phase 3. 청중은 웹(QR) 유지 |
| study-note | 낮음 | 오프라인 노트 | 노트 초안 | 없음 | 웹 유지 |
| nomad-blog | 낮음 | 해당 없음 | 없음 | 없음 | 웹 유지. 로컬 브라우저 자동화로 발행하는 방식은 플랫폼 약관 위험이 커 셸 도입 근거로 삼지 않는다 |
| local-news | 낮음 | 해당 없음(편집국 CMS·독자 사이트 모두 웹) | 없음 | 없음 | 웹 유지. 신문사별 브랜드 데스크톱 앱 수요는 없다고 본다(제안) |
| astro-ai, microweb-studio, website-floria | 없음 | 해당 없음 | 없음 | 없음 | 웹(또는 모바일, Capacitor 가이드) |

판매 모델과의 관계: 셸 앱을 만드는 것과 설치형으로 파는 것(판매 모델 A, `Price_Plans/_common/PRICING_PRINCIPLES.md:68`)은 별개다. 구독형 SaaS 제품도 데스크톱 셸을 가질 수 있고, 그때는 라이선스 파일 없이 세션 + 서버 엔타이틀먼트로 판정한다(8장 마지막 행). 각 제품의 판매 모델 A 결정은 `Price_Plans/<제품>/PRICE_PLAN.md`가 정본이다: arch-studio는 설치형이 본체, admin-suite hms는 "예"(`Price_Plans/admin-suite/PRICE_PLAN.md:89`), nomad-docs는 "장기 검토"(`Price_Plans/nomad-docs/PRICE_PLAN.md:99`), 나머지 제품은 "아니오"다. 위 표의 Phase 2·3 권고는 "구독형 데스크톱 클라이언트"를 뜻하며 판매 모델을 바꾸지 않는다.

### 12.1 제품별 상세 메모

| 제품 | 메모 |
|---|---|
| arch-studio | 이 가이드의 기준 제품이다. `docs/products/arch-studio/01_PRD.md` 4장(라이선스·업데이트)과 1주 기술 스파이크(R3F + Manifold WASM, 저사양 PC 30fps) 통과 후 확정 |
| sceneflow | 클라우드 `services/media-worker`(`docs/products/_platform-core/SHARED_MODULES.md` 0장)의 Whisper·FFmpeg 처리를 로컬 sidecar로 옮기면 GPU·서버 원가가 줄지만, 사용자 PC 사양 편차가 크다. "로컬 처리 우선, 실패 시 클라우드" 이중 경로와 크레딧 차등(로컬 0 또는 할인)을 PRD에 함께 정한다. 업로드는 여전히 서버 업로더(`sns-uploader`)를 거친다 |
| nomad-docs | 고위험 문서 규칙(템플릿 전용, AI 조항 금지)은 셸에서도 같다. 로컬 파싱은 업로드 원문을 서버에 보내지 않는 장점이 있으나 RAG 색인은 서버에 있으므로 "로컬 전용 모드"의 기능 범위를 따로 정한다 |
| book-trailer | 워터마크·AI 표시 판정은 서버(`start_render`) 정본이라 로컬 렌더를 허용해도 스냅샷과 판정은 서버에서 받는다. 무료 플랜의 로컬 렌더는 허용하지 않는다(워터마크 우회 위험, `docs/reviews/Toon-Factory.md:45`) |
| admin-suite(hms) | hms는 전용 서버를 쓰는 제품이다. 셸은 병원 내부망의 hms 전용 백엔드만 바라보게 빌드 설정을 분리하고, 공용 클라우드 도메인을 CSP에서 제외한다 |

## 13. 개발 지시사항 (에이전트용)

### 13.1 착수 조건

| 조건 | 내용 |
|---|---|
| 제품 PRD | `01_PRD.md` 2장에 데스크톱 범위(무엇을 로컬로 내리는지), 4장에 판매 방식(설치형/구독형), 5장에 OS·사양·오프라인 기간이 있어야 한다 |
| 데이터 분류 | 제품 `05_DATA_MODEL.md`에 4.1절 분류(A~D)를 테이블마다 표시 |
| 코어 요청 | T-C1(Bearer 세션), T-C2(CORS)가 반영되기 전에는 셸이 Route Handler를 부르는 기능을 머지하지 않는다 |
| 스파이크 | 3D·영상처럼 성능이 걸린 제품은 1주 스파이크로 기준 사양 통과를 먼저 확인한다 |

### 13.2 작업 분해 템플릿

작업 ID는 `<제품약어>-T-###`(예: `AR-T-001`)로 제품 `06_AGENT_PLAN.md`에 넣는다. 약어는 `DB_CONVENTIONS.md` 1장 SQLSTATE 접두사와 같다.

| 순서 | 작업 | 소유 경로 | 권장 모델 | 수용 기준 |
|---|---|---|---|---|
| T-001 | 셸 골격: `apps/desktop`(Vite + React), `src-tauri`, capability 최소 설정, CSP | `apps/desktop/**` | Haiku | 빈 창이 Windows에서 실행되고 CSP 위반 0, 허용 명령 외 호출 시 거부 |
| T-002 | `packages/shell-bridge` 인터페이스와 웹 대체 구현 | `packages/shell-bridge/**` | Opus | 웹 빌드와 셸 빌드가 같은 화면 코드로 동작 |
| T-003 | 키체인 어댑터 + Supabase 클라이언트(PKCE, `detectSessionInUrl: false`), 인증 단계 A Mock(개발 빌드 전용, 5.4절) | `packages/shell-bridge/secure-store/**`, `src-tauri/src/commands/secrets.rs` | Opus | 토큰이 `localStorage`에 0건, 재시작 후 세션 유지 |
| T-004 | 소셜 로그인(인증 단계 B 이후, G1 통과 후): 시스템 브라우저 + 딥링크 + `exchangeCodeForSession` | `src-tauri/src/commands/deeplink.rs`, `packages/features/auth/**` | Opus | Google 로그인 성공, 시작하지 않은 콜백 URL은 무시 |
| T-005 | 로컬 DB: 이름 붙은 쿼리, 마이그레이션, 업데이트 전 스냅샷 | `src-tauri/src/commands/local_db.rs`, `apps/desktop/migrations/**` | Opus | 화면에서 임의 SQL 실행 불가, 마이그레이션 재실행 멱등 |
| T-006 | 클라우드 API 클라이언트(Bearer, 재시도 대기열) | `packages/features/api-client/**` | Opus | 오프라인 요청이 온라인 복귀 후 순서대로 처리, 실패가 화면에 보임 |
| T-007 | 라이선스(설치형 제품만): 활성화·검증·기기 해시 | `src-tauri/src/commands/license.rs` + 클라우드 Route Handler | Fable | 변조한 라이선스 파일 거부, 3대째 활성화 거부 |
| T-008 | 업데이터: 서명 검증, 라이선스 기반 매니페스트 | `src-tauri/src/commands/updater.rs`, `apps/web/src/app/api/updates/**` | Fable | 만료 라이선스에 신규 빌드 미제공, 서명 불일치 업데이트 설치 거부 |
| T-009 | 결제 연결: 시스템 브라우저 결제 → 웹훅 확정 → Realtime 반영 | `packages/features/billing/**` | Opus | 딥링크 없이도 결제 결과가 1분 안에 반영 |
| T-010 | CI: OS별 빌드·서명·매니페스트 | `.github/workflows/desktop-*.yml` | Sonnet | 태그 푸시로 서명된 설치 파일과 매니페스트 생성 |
| T-011 | 보안 점검: capability·CSP·IPC 입력 검증 리뷰 | 리뷰 전용 | Fable | 9장 항목 전부 체크, 위반 0 |
| T-012 | E2E: 설치 → 로그인 → 핵심 기능 → 오프라인 → 복귀 | `apps/desktop/e2e/**` | Sonnet | 시나리오 5개 통과(WebDriver 기반, 도구는 구현 시 선택) |

웨이브(제안): W0 = T-001, T-002 / W1 = T-003, T-005, T-006 / W2 = T-004, T-009, 제품 기능 이식 / W3 = T-007, T-008(설치형만) / W4 = T-010, T-011, T-012.

### 13.3 요청 프롬프트 예시 (베이스 `_templates/dev-request-prompt.md` 형식)

현재 개발 묶음 생성 스크립트(`develop/_shared/tools/build_root.py:91-98`)는 이 폴더를 `docs/reference/`로 복사하지 않는다. 묶음에 넣기 전까지는 platform-docs 원본 경로를 지시한다.

```
D:/WorkSpace/DEV/<제품>/docs/file 의 모든 파일과 D:/WorkSpace/platform/docs/Tauri/README.md 를 최대한 자세히 읽고 분석한다.

[요구사항]
<약어>-T-003: Tauri 셸에서 Supabase 세션을 OS 키체인에 저장하는 어댑터를 만든다.
완료 조건 = ① localStorage 에 토큰 0건 ② 앱 재시작 후 세션 유지 ③ 로그아웃 시 키체인 항목 삭제
④ Tauri/README.md 5.3절 계약 준수 ⑤ capability 에 secrets 명령만 추가.

[작업의 특성]
작업 대상 경로: packages/shell-bridge/secure-store/, apps/desktop/src-tauri/src/commands/secrets.rs
클라우드 코드와 supabase/ 는 수정하지 않는다.

이 요구와 근거 산출물(baseline)로 작업을 만들어 진행한다.
승인·결정 사항은 묻지 말고 먼저 진행한 뒤, 임의로 결정한 내용은 log.md 에 [DECISION] 으로 남긴다.
```

### 13.4 금지 패턴

| 분류 | 금지 |
|---|---|
| 비밀 | 셸 번들·Rust 바이너리·`tauri.conf.json`에 service_role, LLM 키, 결제 시크릿, 서명 개인키 |
| 권한 | 로컬 SQLite·`localStorage` 값으로 플랜·크레딧·라이선스 판정, 클라이언트가 보낸 금액·org_id 신뢰 |
| 인증 | 임베디드 웹뷰 안 소셜 로그인, PKCE 없는 OAuth, 시작하지 않은 딥링크 콜백 처리 |
| 런타임 | 원격 URL을 메인 창에 로드하고 IPC 권한 부여, 화면에서 임의 SQL·임의 경로 실행, `shell` 플러그인으로 임의 명령 실행 |
| 데이터 | "마지막 쓰기 승리"를 조용히 적용, 동기화 실패를 성공처럼 표시 |

## 14. 열린 결정

| ID | 결정 | 선택지 | 권고 |
|---|---|---|---|
| T-D1 | 셸 화면 빌드 도구 | (a) Vite + React Router (b) Next.js `output: 'export'` | (a). 셸에는 서버 기능이 없어 Next.js 이점이 적고, 라우팅·빌드가 단순하다. 웹은 Next.js 유지 |
| T-D2 | macOS 지원 시점 | (a) 제품별 Phase 2 (b) MVP 동시 | (a). Windows 우선. 3D 제품은 WKWebView 실기 확인 후 |
| T-D3 | 동기화(C 분류) 구현 | (a) 직접 구현(4.2절) (b) 동기화 엔진 도입 | (a)로 시작. 두 제품 이상이 C 분류를 쓰게 되면 (b) 비교 검토 |
| T-D4 | 로컬 DB 암호화 | (a) 민감 작업물 제품만 (b) 전 제품 | (a) |
| T-D5 | 코드 서명 인증서 | 발급 주체(개인사업자·법인), 종류 | 첫 설치형 제품 출시 3개월 전 발급 착수(제안) |

## 15. 코어 요청

| ID | 요청 | 이유 |
|---|---|---|
| T-C1 | `requireSession`이 쿠키 외에 `Authorization: Bearer <Supabase JWT>`를 검증하도록 확장(같은 `SessionContext` 반환) | 셸 앱은 쿠키 세션을 쓰지 않는다(`docs/products/_platform-core/SHARED_MODULES.md:70-81`) |
| T-C2 | Route Handler CORS 허용 목록 규격(제품별 셸 출처, 와일드카드 금지) | 셸 출처가 웹 도메인과 다르다 |
| T-C3 | `payment_orders.kind` 일회성 상품 추가 | 설치형 판매(`docs/products/arch-studio/01_PRD.md` 8.1절 C-1과 같은 요청) |
| T-C4 | 라이선스 서명 키 규격(키 id, 교체, 공개키 배포)과 업데이트 서명키 관리 | 8장 |
| T-C5 | BYOK 데스크톱 예외 여부 | `docs/products/_platform-core/SECURITY_BASELINE.md:121`은 BYOK를 금지하지만 판매 모델 A 정의는 "고객 API 키"를 전제한다(`Price_Plans/_common/PRICING_PRINCIPLES.md:68`). 둘 중 하나를 고쳐야 한다(arch-studio는 크레딧 게이트웨이 방식으로 BYOK 없이 설계, `docs/products/arch-studio/01_PRD.md` 4장) |
| T-C6 | Supabase Auth Redirect URLs에 제품별 앱 스킴 등록 절차 | 5.1절 |
| T-C8 | 셸 앱용 로그인 마무리 엔드포인트: 클라이언트 `exchangeCodeForSession` 뒤 Bearer로 부르면 `finishLogin`(제공자 허용 검사, 프로필 상태, 감사 `auth.login`, 첫 로그인 경로)을 실행하고 이동할 경로를 돌려준다 | 5.4절. 웹 콜백(`/auth/callback`)과 같은 검사를 한 구현으로 유지 |
| T-C7 | 네이버 서버 브리지 경로를 쓸 경우 앱으로 세션을 넘기는 1회용 교환 코드(짧은 만료, 1회 소비, PKCE 검증값 결합) | 5.4절, `docs/products/_platform-core/AUTH_ROADMAP.md` 7.2절 |

## 16. 출처 (확인일 2026-10-14)

| 내용 | 출처 |
|---|---|
| Tauri 최신 버전(tauri 2.12.3, 2026-10-10) | [Tauri Releases](https://v2.tauri.app/release/) |
| 플랫폼별 웹뷰와 업데이트 방식 | [Tauri Webview Versions](https://v2.tauri.app/reference/webview-versions/) |
| Next.js 정적 내보내기 요건 | [Tauri: Next.js](https://v2.tauri.app/start/frontend/nextjs/) |
| Google 임베디드 웹뷰 OAuth 차단 | [Google Developers Blog (2021-06)](https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html) |
| 네이티브 앱 OAuth·딥링크 흐름(`skipBrowserRedirect`) | [Supabase: Native Mobile Deep Linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking) |
| Electron 비교 기준(Electron 44, Chromium 152) | [Electron Releases](https://releases.electronjs.org/) |
