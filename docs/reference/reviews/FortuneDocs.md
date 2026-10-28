# FortuneDocs 기획 리뷰

리뷰 일자: 2026-10-12 / 대상 경로: `D:\WorkSpace\platform\FortuneDocs` (코드 없음, 기획 문서 2건: `CLAUDE.MD`, `PRD.MD`)

## 1. 프로젝트 개요

- 한 줄 설명: 생년월일시를 입력받아 만세력(사주 8글자)을 산출하고, Multi-LLM으로 "현대적 커리어 관점"의 사주 해설서를 생성해 PDF/ePub 책자로 소장하게 하는 크레딧 기반 SaaS MVP (`PRD.MD:13-16`).
- 기획 의도: 화면 조회형 사주 앱(점신, 포스텔러)과 달리 "나와 지인의 평생 사주를 한 권의 책으로 소장"하는 다운로드형 포지셔닝 (`PRD.MD:15`). 셀링독스(sellingstudio) 아키텍처 계승을 명시 (`PRD.MD:3`).
- 대상 사용자: 2030 세대, 본인 및 가족/연인/지인 사주를 함께 관리하려는 사용자 (`PRD.MD:3,50`).

| 영역 | 제안된 기술 | 비고 |
|------|------------|------|
| 프론트 | Next.js 14+ App Router, Tailwind, shadcn/ui, 다크모드 + 골드/엠버 | 워크스페이스 표준은 Next 16 |
| 백엔드 | Next.js Route Handlers(Edge/Serverless) | 파이썬 서버 배제 |
| DB/인증 | Supabase PostgreSQL + Auth(매직링크, 구글) + RLS | 테이블 3개 |
| 만세력 | KASI 특수천문정보 API + `lib/astrology.ts` 자체 연산 | 정확도 리스크 큼 |
| AI | Vercel AI SDK로 OpenAI/Anthropic/Gemini 스위칭 | 역할 분담과 "선택 스위칭"이 혼재 |
| 내보내기 | Puppeteer(PDF), epub-gen-memory(ePub), QuickChart(차트 이미지) | Vercel에서 Puppeteer 리스크 |
| 인프라 | Vercel | |

- 기획 완성도: 약 40%. 근거: 기술 스택, DDL, 디렉토리 트리, 출력 JSON 예시는 구체적이다. 반면 만세력 산출 규칙(절기 기준, 시간 보정, 대운수), 크레딧 단가와 결제 수단, 화면 흐름(로그인/입력/생성 대기/편집/내보내기), 에러/대기 처리, 프롬프트 설계, 개인정보(제3자 정보) 정책이 전혀 정의되어 있지 않다. 두 문서는 같은 내용을 중복 서술하며(DDL, 트리), 생성형 AI 대화 잔재가 남아 있다.

## 2. 기획 문서 분석

| 문서 | 역할 | 상태 |
|------|------|------|
| `PRD.MD` (186행) | 제품 요구사항: 개요, 스택, 기능 요구 5개(3.1~3.5), 비기능 2개(RLS, GEO), DDL, 디렉토리 트리, 시작 프롬프트 | 1-7행에 챗봇 응답 문구("네, 프로젝트명은...")가 그대로 포함 |
| `CLAUDE.MD` (144행) | AI 코딩 도구 주입용 가이드: 스택, DDL(PRD와 동일), API 규격 2개, 트리(PRD와 동일), 시작 프롬프트 | `[cite: 3]` 인용 잔재 다수, 4행 ```` ```markdown ```` 펜스가 닫히지 않아 전체가 코드블록으로 렌더됨. 코딩 규칙/환경변수/명령어 없음 |

요구사항 구조 요약:
- 기능 요구: (1) Auth + 다중 프로필 보관함 + 크레딧 차감, (2) 입력 폼 + 실시간 원국 프리뷰(오행 색상 카드), (3) 구조화 JSON 리포트 빌더(현대적 재해석 프롬프트), (4) 10년 대운 타임라인, (5) PDF/ePub 내보내기.
- 비기능 요구: RLS 기반 사용자 격리, JSON-LD 기반 GEO 최적화.
- 데이터 모델: `profiles`(크레딧), `fortune_targets`(사주 대상), `fortune_books`(리포트 JSON). 결제 이력, 크레딧 로그, 만세력 산출 결과 캐시 테이블은 없다.
- 실제 사용자 흐름: 가입 -> 대상 등록 -> 원국 프리뷰 -> 리포트 생성(크레딧) -> 대운/원국/해설 화면 -> PDF/ePub 내보내기(크레딧). 단, 이 흐름은 문서에 명시되지 않고 기능 목록과 트리에서 추론해야 한다.

## 3. 기획상의 문제점

| # | 심각도 | 분류 | 위치 | 내용 |
|---|--------|------|------|------|
| 1 | 높음 | 기술리스크 | `PRD.MD:2.2`, `CLAUDE.MD:3.1` | KASI 음양력 API가 주는 세차/월건/일진은 음력 기준 간지다. 사주 년주는 입춘, 월주는 24절기 절입 시각 기준이므로 그대로 쓰면 1~2월생과 절기 경계일 출생자의 년/월주가 틀린다. 시주는 API가 주지 않고 일간 기준 별도 산출이 필요. 진태양시(경도) 보정, 한국 서머타임(1948~1960, 1987~1988) 규칙도 정의되지 않음 |
| 2 | 높음 | 누락 | `PRD.MD:3.4`, `PRD.MD:5` | 대운은 성별+년간 음양으로 순/역행을 정하고 출생 시각과 다음/이전 절기 사이 일수로 대운수를 산출한다. 이 계산 규칙이 없고, DDL의 `gender`는 NULL 허용이라 대운 산출이 불가능한 레코드가 생긴다 |
| 3 | 높음 | 모순 | `PRD.MD:3.2` vs `PRD.MD:5` | 입력 모델은 양력/음력/윤달, 야자시/조자시 옵션을 요구하지만 DDL에는 `is_lunar`만 있고 `is_leap_month`, 자시 처리 방식, 출생지(경도), 생시 모름 여부 컬럼이 없다. `birth_time` NULL일 때의 동작(삼주 분석)도 미정의 |
| 4 | 높음 | 보안 | `PRD.MD:5` (RLS 정책) | `fortune_books`가 `FOR ALL` 정책이라 사용자가 브라우저에서 직접 `report_json`을 insert/update할 수 있다. 크레딧 차감 없이 책을 만들어 PDF 내보내기 경로로 넘길 수 있고, `target_id`의 소유자 검증(`WITH CHECK`)도 없다. 리포트 생성은 서버(service role)만 쓰고 사용자는 SELECT/DELETE만 허용해야 함 |
| 5 | 높음 | 누락 | `PRD.MD:3.1`, `PRD.MD:5` | 크레딧 차감 방식(원자적 RPC), 행위별 단가("지정된 크레딧"으로만 표기), 실패 시 환불, 크레딧 로그 테이블이 없다. `profiles` 자동 생성 트리거가 없어 가입 직후 `fortune_targets` insert가 FK 위반으로 실패한다. 결제 유도 모달만 있고 PG(토스 등)와 충전 흐름은 미정 |
| 6 | 높음 | 기술리스크 | `PRD.MD:3.5`, `CLAUDE.MD:1` | Puppeteer 전체 패키지는 Vercel 서버리스에서 동작하지 않고(`puppeteer-core` + 서버리스용 Chromium 필요), 번들 크기·콜드스타트·한글 폰트 부재 문제가 있다. `CLAUDE.MD`는 Edge 런타임도 언급하는데 Edge에서는 Puppeteer와 epub-gen-memory 모두 실행 불가 |
| 7 | 중간 | 모순 | `PRD.MD:2.3` vs `CLAUDE.MD:3.2` | PRD는 GPT(격국/용신 판별) -> Claude(문장) -> Gemini(장문) 역할 분담형 파이프라인을 서술하고, 동시에 "유저가 선택한 모드에 따라 스위칭"이라고 한다. 체인 방식인지 단일 모델 선택인지 불명확. `response_format`은 OpenAI 전용 파라미터로 Vercel AI SDK의 스키마 기반 객체 생성 방식과 맞지 않음 |
| 8 | 중간 | 모호성 | `PRD.MD:3.3` | 출력 JSON의 `five_elements` 점수를 LLM이 생성하게 되어 있다. 결정적 계산값(`lib/astrology.ts`)과 LLM 값이 달라질 수 있으므로 수치는 서버가 계산해 주입하고 LLM은 `chapters`만 생성해야 함. 격국/용신 판별을 LLM에 맡기는 것도 결과 일관성이 없음 |
| 9 | 중간 | 범위과다 | `PRD.MD:1`, `PRD.MD:3.3` | "평생 사주 가이드북"을 표방하지만 예시 스키마는 3챕터뿐. 장수가 늘면 단일 요청이 Vercel 함수 시간 제한을 넘는다. 챕터 수, 분량, 챕터별 분할 생성/스트리밍/재시도 정책 미정 |
| 10 | 중간 | 누락 | `PRD.MD:6` (트리) | `analyze/[targetId]`의 "AI 해설서 편집 화면"이 기능 요구에 없다(편집 범위, 저장, 버전 관리 미정). 로그인/콜백, 미들웨어(proxy), 결제/크레딧 화면, 리포트 목록, GEO용 블로그 영역이 트리에 없음 |
| 11 | 중간 | 보안 | `PRD.MD:3.1`, `PRD.MD:4.1` | 가족·지인의 이름과 생년월일시(제3자 개인정보)를 저장하지만 동의, 보관 기간, 삭제 요청, 개인정보처리방침이 정의되지 않음. 운세 서비스 면책 고지도 없음 |
| 12 | 중간 | 보안 | `PRD.MD:3.1` | 가입 시 기본 3 크레딧 + 매직링크 가입 구조라 이메일을 바꿔가며 무료 크레딧을 반복 획득 가능. 생성 API 레이트 리밋 요구 없음 |
| 13 | 중간 | 기술리스크 | `PRD.MD:2.2` | KASI API는 서비스 키, 호출 한도, 장애 시 대체 경로가 필요하고 "실시간 프리뷰"마다 외부 호출하면 지연·한도 소진. 만세력은 로컬 절기 테이블/라이브러리로 계산하고 KASI는 검증용으로만 쓰는 편이 안전 |
| 14 | 낮음 | 모순 | `PRD.MD:2.1`, `CLAUDE.MD:1` | "Pure JavaScript"를 내세우지만 모든 파일이 `.ts`. Next.js 14 지정은 워크스페이스의 Next 16 프로젝트(async params, `proxy.ts`)와 불일치. `lib/supabaseClient.ts` 단일 클라이언트는 SSR 쿠키 세션 구조(client/server/admin 분리)와 맞지 않음 |
| 15 | 낮음 | 기술리스크 | `PRD.MD:2.2` | QuickChart 외부 API는 PDF 렌더 시 추가 네트워크 의존. 오행 5개 값은 인라인 SVG로 직접 그리면 화면/PDF/ePub에 동일하게 쓸 수 있음 |
| 16 | 낮음 | 모호성 | `PRD.MD:3.2` | 오행 색상 "金-백, 水-흑"은 다크모드 기본 UI에서 배경과 대비가 무너짐. 테두리/톤 규칙 필요 |
| 17 | 낮음 | 누락 | `CLAUDE.MD` 전체 | 문서 중복(DDL, 트리)으로 수정 시 동기화 위험. `[cite: 3]` 잔재와 미종료 코드펜스 정리 필요. 환경변수 목록, 실행/마이그레이션 명령, "인증 -> 크레딧 확인 -> 처리" 같은 코딩 규칙이 없음 |

심각도 높음 항목 상세:
- #1, #2, #3 (만세력 정확도): 이 제품의 신뢰는 "정확한 만세력"에 달려 있는데(`PRD.MD:97`), 제안된 KASI 음력 간지 직접 사용 방식은 사주 규칙(입춘/절기 기준)과 다르다. 절기 절입 시각 테이블 기반의 결정적 계산 엔진과, 기존 만세력 사이트 대비 회귀 테스트 세트(최소 100건, 절기 경계일 포함)를 먼저 확정해야 한다. DDL도 윤달·자시 방식·생시 모름·출생지를 담도록 다시 설계해야 한다.
- #4, #5 (크레딧/RLS): 워크스페이스 기존 리뷰에서 반복된 결함(sellingstudio의 비원자 차감과 생성 라우트 무검증, NOMAD Shorts Maker의 SECURITY DEFINER RPC 권한 미회수)이 이 DDL에서도 그대로 재현될 구조다. 리포트 생성과 크레딧 차감을 하나의 서버 라우트와 하나의 RPC 트랜잭션으로 묶고, 사용자 테이블 쓰기 권한을 최소화해야 한다.
- #6 (PDF): 정의대로 구현하면 로컬에서는 되고 Vercel 배포에서 실패하는 전형적인 경로다. MVP에서는 인쇄용 CSS + 브라우저 인쇄 또는 서버리스 Chromium 중 하나를 결정하고, 한글 폰트 임베딩을 요구사항에 명시해야 한다.

## 4. 효율적 구현 전략

권장 아키텍처
- Next.js 16 App Router + Supabase SSR(`@supabase/ssr`) + Tailwind v4 + shadcn/ui. Node 런타임만 사용(Edge 배제).
- 만세력: `lib/saju/`에 순수 함수 엔진(절기 테이블 기반 년/월/일/시주, 십신, 오행 점수, 대운). 입력은 양력 일시로 정규화(음력/윤달 변환은 로컬 테이블 또는 검증된 만세력 라이브러리, KASI는 배치 검증용). 단위 테스트 필수.
- 생성: `POST /api/books` 한 곳에서 인증 -> 대상 소유 확인 -> `consume_credits` RPC(원자적) -> 만세력 계산 -> LLM 챕터 생성(스키마 검증) -> service role로 `fortune_books` insert -> 실패 시 `refund_credits`. 수치(오행/십신/대운)는 서버가 계산해 JSON에 주입하고 LLM은 문장만 생성.
- LLM: MVP는 단일 모델(Claude 계열) + 스키마 검증으로 시작. Multi-LLM은 OpenRouter 단일 키로 모델 ID만 바꾸는 구조(sellingstudio 방식)가 Vercel AI SDK 3사 키 관리보다 단순하다.
- 내보내기: 하나의 "책 HTML 템플릿"을 웹 뷰어·PDF·ePub이 공유. 차트는 인라인 SVG.

재사용할 기존 프로젝트/모듈

| 출처 | 재사용 대상 | 용도 / 주의 |
|------|-----------|------------|
| `basic-master-module` | Next 16.2 + React 19 + Tailwind v4 기본 골격(`package.json`, `app/layout.tsx`) | 새 저장소 시작점. 4개 파일뿐이라 의존성 버전 기준선으로만 사용 |
| `sellingstudio` (PRD가 계승을 명시) | `lib/supabase/{client,server,admin}.ts`, `proxy.ts` + `lib/proxy.ts`(세션 갱신·라우트 보호), `app/api/auth/callback`, `components/ui/` shadcn 14종, `lib/llm/openrouter.ts` | 인증·레이아웃 골격을 그대로 가져온다. 단 리뷰(`D:/WorkSpace/platform/docs/reviews/sellingstudio.md` 3장 #1~#3)의 결함(생성 라우트 크레딧 무검증, 비원자 차감, 콜백 `next` 미검증)은 복사하지 말고 수정본으로 이식 |
| `Nomad-BlogStudio` | `supabase/migrations/002_rpc_functions.sql`의 `consume_credits`/`refund_credits` RPC 패턴, `src/lib/billing/credits.ts`의 `CREDIT_COSTS` 상수 패턴 | org 단위를 user 단위로 바꿔 사용. `REVOKE EXECUTE ... FROM authenticated, anon` 추가 필수(NOMAD Shorts Maker 리뷰 #1의 교훈). `credits.ts`의 선조회 후 RPC 호출은 RPC 내부 검증으로 일원화 |
| `NOMAD Shorts Maker` | Toss Payments 승인 라우트 구조 | 2단계 결제 도입 시 참고만. 웹훅 서명 미검증 결함(리뷰 #2)은 수정 후 사용 |
| `flora` (frontend) | `src/lib/print-presets.ts`(판형/@page 규칙), `src/lib/html-templates.ts`, `src/app/api/books/build-html` | 책자 HTML/CSS 템플릿과 판형 규칙을 PDF/ePub 공용 템플릿으로 이식. 리뷰 #11의 HTML 미이스케이프 결함 수정 필요 |
| Hospital / School_Management_System / ERP-Wesite | 역할 기반 RLS 패턴 | 이 프로젝트는 단일 역할이라 재사용 가치 낮음. 참고하지 않아도 됨 |

MVP 범위 축소안
- 포함: 구글 로그인, 대상 등록(최대 N명), 원국 프리뷰, 오행/십신 표시, 대운 타임라인(읽기 전용), 단일 모델 리포트 생성(5~7챕터), 웹 뷰어, PDF 1종, 크레딧 차감/환불, 개인정보 동의.
- 제외(2단계 이후): ePub, Multi-LLM 체인, 해설서 편집, 결제 연동(초기에는 관리자 수동 충전), GEO 블로그, 매직링크(남용 방지 후 도입), QuickChart.

단계별 로드맵
1. 1단계(설계, 1주): 만세력 규칙 명세와 회귀 테스트 세트, DDL 재설계(윤달/자시/생시 모름/출생지, credit_logs, 가입 트리거, RLS 최소권한, RPC 권한 회수), 리포트 JSON 스키마(zod) 확정, PDF 방식 결정.
2. 2단계(골격, 1~2주): sellingstudio 기반 인증/레이아웃 이식, `lib/saju` 엔진 + 테스트, 대상 CRUD, 원국 프리뷰/대운 타임라인 UI.
3. 3단계(핵심 가치, 1~2주): `/api/books` 생성 트랜잭션, 프롬프트 설계(현대적 재해석 사전), 뷰어, PDF 내보내기(한글 폰트).
4. 4단계(확장): ePub, 결제(Toss), Multi-LLM, 편집, GEO 랜딩/JSON-LD, 레이트 리밋 고도화.

## 5. 구현 작업 목록 및 권장 모델

| # | 작업 | 우선순위 | 규모 | 권장 모델 | 이유 |
|---|------|---------|------|----------|------|
| 1 | 만세력 산출 규칙 명세 작성(입춘/절기 기준 년·월주, 일주 기준일, 시주, 야자시/조자시, 진태양시·서머타임, 대운 순역행·대운수) + 절기 경계 포함 회귀 테스트 케이스 100건 정의 | P0 | M | Fable 5.1 | 도메인 정확도가 제품 신뢰의 핵심이고 오류 원인 추적이 어려움 |
| 2 | `lib/saju/` 순수 함수 엔진 구현(사주 4주, 십신, 오행 점수, 대운) + 단위 테스트 통과 | P0 | L | Fable 5.1 | 기획만 있는 프로젝트의 핵심 로직 설계·초기 구현 |
| 3 | DDL 재설계 마이그레이션: `fortune_targets`에 `is_leap_month`, `zi_hour_mode`, `birth_time_unknown`, `birth_longitude` 추가, `gender NOT NULL`, `credit_logs` 테이블, `handle_new_user` 가입 트리거, `fortune_books`는 SELECT/DELETE만 허용, `fortune_targets` WITH CHECK | P0 | M | Fable 5.1 | 데이터 모델과 RLS 권한 설계, 실수 비용이 큼 |
| 4 | `consume_credits`/`refund_credits` RPC(user 단위, `FOR UPDATE` 원자 차감, 로그 기록) + `REVOKE EXECUTE FROM anon, authenticated` + 행위별 단가 상수 | P0 | M | Fable 5.1 | 돈과 직결되는 과금 로직, 기존 프로젝트에서 반복된 결함 |
| 5 | basic-master-module로 저장소 생성 후 sellingstudio의 `lib/supabase/*`, `proxy.ts`, auth callback(`next` 경로 검증 추가), `components/ui/` 이식, 다크/골드 테마 토큰 적용 | P0 | M | Opus 5.5 | 범위가 명확한 다중 파일 이식 작업 |
| 6 | `POST /api/books`: 인증 -> 대상 소유 확인 -> RPC 차감 -> 엔진 계산 -> LLM 챕터 생성(zod 스키마 검증, 1회 재시도) -> service role insert -> 실패 시 환불 | P0 | M | Opus 5.5 | 설계(작업 3,4)가 확정된 뒤의 API 연동 구현 |
| 7 | 리포트 프롬프트 설계: 십신/신살 현대적 재해석 사전, 챕터 구성(5~7장)과 분량, 금지 표현(의료·투자 단정) 가이드, 수치는 입력으로만 제공 | P1 | M | Opus 5.5 | 정의된 입력/출력 사이의 프롬프트 엔지니어링 |
| 8 | 대상 관리 대시보드(목록/등록/수정/삭제, 입력 폼: 양력/음력/윤달/자시 방식/생시 모름) + 제3자 정보 동의 체크 | P1 | M | Opus 5.5 | 폼 검증과 상태 관리가 있는 중간 규모 기능 |
| 9 | 원국 카드(`pillars-card`), 오행 SVG 차트, 대운 타임라인 컴포넌트 구현(다크모드 대비 규칙 포함) | P1 | M | Sonnet 5.5 | 데이터가 확정된 뒤의 반복적 UI 컴포넌트 작업 |
| 10 | 책 HTML 템플릿(flora `print-presets.ts`/`html-templates.ts` 참고, 본문 HTML 이스케이프) + PDF 내보내기(서버리스 Chromium + 한글 폰트 또는 인쇄 CSS) | P1 | L | Opus 5.5 | 배포 환경 제약이 있는 연동 작업, 방식 결정 후 구현 |
| 11 | 생성/내보내기 라우트 레이트 리밋(사용자별 분당 N회) 및 신규 가입 크레딧 남용 방지(구글 로그인 한정 지급) | P1 | S | Opus 5.5 | 비용 방어 로직이나 범위가 작음 |
| 12 | ePub 내보내기(epub-gen-memory, 공용 템플릿 재사용) | P2 | S | Sonnet 5.5 | 템플릿 확정 후 라이브러리 연결만 남음 |
| 13 | Toss Payments 크레딧 충전(승인 라우트 + 웹훅 서명 검증 + `add_credits` 서버 전용) | P2 | M | Fable 5.1 | 결제 로직, 위변조 시 금전 손실 |
| 14 | 랜딩 페이지 + Metadata API/JSON-LD, 개인정보처리방침·면책 고지 페이지 | P2 | S | Sonnet 5.5 | 정적 페이지와 메타데이터 보일러플레이트 |
| 15 | 문서 정리: `PRD.MD` 대화 잔재 제거, `CLAUDE.MD`의 `[cite]`/미종료 펜스 제거, DDL·트리는 한 곳에만 두고 환경변수·명령어·"인증 -> 크레딧 -> 처리" 규칙 추가 | P0 | S | Sonnet 5.5 | 문서화 작업 |

## 6. 종합 평가

- 실현 가능성: 중상. 기능 범위 자체는 솔로 개발로 3~5주에 MVP가 가능한 규모이고 인증·크레딧·책 템플릿은 워크스페이스에 재사용 가능한 자산이 있다. 다만 "정확한 만세력"을 KASI 음력 간지로 해결하려는 현재 설계는 사주 규칙과 맞지 않아, 엔진을 별도로 설계·검증하지 않으면 핵심 가치가 무너진다.
- 강점: 다운로드형 소장이라는 차별화가 명확하고, DDL·디렉토리·출력 JSON이 구체적이라 착수 장벽이 낮으며, RLS 기반 격리를 처음부터 요구한다.
- 약점: 만세력 산출 규칙 부재, 크레딧/결제/RLS의 서버 권한 설계 부재, Vercel에서의 PDF 렌더 리스크.
- 모델별 비율(15개 작업 기준): Fable 5.1 33% (5건: #1, #2, #3, #4, #13) / Opus 5.5 40% (6건: #5, #6, #7, #8, #10, #11) / Sonnet 5.5 27% (4건: #9, #12, #14, #15).
- 권장 진행 순서: 15(문서 정리) -> 1, 3, 4(규칙·스키마·과금 설계) -> 2, 5(엔진·골격) -> 6, 7, 8, 9(핵심 흐름) -> 10, 11(내보내기·방어) -> 12, 13, 14(확장).
- 주 담당 모델: **Fable 5.1**. 코드가 없는 기획 단계이고, 성패를 가르는 요소(만세력 계산 엔진의 정확도, 크레딧 RPC와 RLS 권한 설계, 리포트 생성 트랜잭션 구조)가 서로 맞물려 있어 한 모델이 초기 설계와 골격을 일관되게 잡아야 한다. 엔진·스키마·과금 계약이 확정된 뒤의 API/화면/내보내기 구현은 Opus 5.5에, UI 컴포넌트·문서·정적 페이지는 Sonnet 5.5에 넘기면 비용 대비 효율이 가장 좋다.
