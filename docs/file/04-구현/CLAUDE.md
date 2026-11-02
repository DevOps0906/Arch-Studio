# CLAUDE.md: Arch Studio (arch-studio)

작성일 2026-10-16. 개발 에이전트 지침. 이 제품의 기획 정본은 같은 폴더의 01~07이고(기능 정본 `01_PRD.md` AR-F-001~038, 도면은 9장), 데스크톱 공통 규칙의 정본은 `D:/WorkSpace/platform/docs/Tauri/README.md`다. 둘이 다르면 제품 문서가 이기고, 제품 문서가 말하지 않는 데스크톱 규칙은 Tauri 가이드를 따른다. 모든 사용자 노출 문구는 한국어. 경로 약어(`web/`, `desk/`, `rust/`, `api/`, `wk/`, `feat/`, `draft/`)는 `06_AGENT_PLAN.md` 머리말과 같다. 같은 폴더 문서는 `01_PRD.md:줄`처럼 줄여 쓴다(= `docs/file/02-요구사항/01_PRD.md:줄`).

## 1. 먼저 읽을 문서

| 순서 | 문서 |
|---|---|
| 1 | `D:/WorkSpace/platform/docs/products/_platform-core/`의 `CORE_SPEC.md`, `SHARED_MODULES.md`, `SECURITY_BASELINE.md`, `DB_CONVENTIONS.md`, `DOC_TEMPLATE.md`, `MONOLITH_CORE_LITE.sql`. 인증 작업이면 `AUTH_ROADMAP.md`(이 문서 맨 끝 "인증 단계 규칙" 절도) |
| 2 | `D:/WorkSpace/platform/docs/Tauri/README.md` 전체. 특히 3장 구조, 4.1절 데이터 분류 A~D, 5장 인증, 6장 클라우드 호출, 8장 라이선스, 9장 보안, 13.4절 금지 패턴 |
| 3 | 이 폴더 `01_PRD.md`(2장 범위, 4장 라이선스·플랜·크레딧, 6장 법·금지 문구, 9장 도면) → `02_ARCHITECTURE.md`(2절 모듈 경계, 2.3절 도면 엔진, 2.4절 워커 프로토콜, 4절 잡, 5절 라우팅, 6절 위험 14건, 8절 환경변수, 9절 인증) → `04_API.md`(2절 Route Handler, 3절 RPC, 4.7절 로컬 엔진 계약, 7절 오류 코드) → `05_DATA_MODEL.md`(테이블, RLS, 함수) → `03_SCREENS_UX.md`(화면·상태·오류 문구) |
| 4 | 자기 작업 행(`06_AGENT_PLAN.md` 2장)과 금지 패턴(`07_SOURCE_MIGRATION.md` 4장) |
| 4-DB | DB 작업이면 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/2400_arch.sql`(정본)과 `supabase/monolith/` |
| 4-AI | AI·음성 작업이면 `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md`, `LLM_WIKI.md`, `VOICE_ARCHITECTURE.md` |
| 4-UI | 화면 작업이면 `docs/file/03-설계/디자인/DESIGN_SYSTEM.md`(먼저), `DESIGN_PRINCIPLES.md`, `DASHBOARD_PATTERNS.md`, `03_SCREENS_UX.md` 3.19절, 랜딩이면 `HERO_3D.md` |
| 4-도면 | 도면 작업이면 `01_PRD.md` 9장(`:328-494`), `02_ARCHITECTURE.md` 2.3절(`:119-235`), `04_API.md` 4.7.3~4.7.6절, 스파이크 결과(task `log.md`의 `[DECISION] D-20`, `D-23`) |
| 5 | V2 공용모듈: `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md`(compliance 채택, media·search 보류) |

## 2. 절대 규칙

| 규칙 | 내용 |
|---|---|
| service_role 서버 전용 | `SUPABASE_SERVICE_ROLE_KEY`와 admin 클라이언트는 `web/src/server/**`, Route Handler, `wk/`, `api/`에서만. 데스크톱 번들·Rust 바이너리·`tauri.conf.json`에 service_role, LLM·fal 키, 결제 시크릿, `LICENSE_SIGNING_PRIVATE_KEY`, `AI_TOKEN_PRIVATE_KEY` 금지(`D:/WorkSpace/platform/docs/Tauri/README.md:352`). 데스크톱 `VITE_` 변수는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, `VITE_AUTH_MODE`만(`02_ARCHITECTURE.md:457-458`) |
| 크레딧 선차감은 서버 | 클라우드 AI 작업은 Route Handler가 검사 후 `arch.start_ai_run(p_org, p_actor, p_kind, p_variant, p_request_id, p_project_ref, p_options)`(service_role) 한 번으로 실행 행 + `enqueue_job` + `consume_credits`를 한 트랜잭션에 한다. 차감액은 `p_variant` → 서버 상수(`web/src/server/ai/pricing.ts` = seed). `core.consume_credits`를 Route Handler에서 직접 부르지 않는다. 실패는 `fail_job` 자동 환불 → `arch.fail_ai_run` 순서(`02_ARCHITECTURE.md:294`) |
| 데스크톱은 금액·org_id를 보내지 않는다 | 셸은 작업 요청만 보낸다. 금액·크레딧 수·`org_id`·플랜은 서버가 세션과 DB로 정한다(`D:/WorkSpace/platform/docs/Tauri/README.md:173`, `:353`). 요청 본문에 그런 필드가 와도 무시한다 |
| 로컬 SQLite는 권한을 정하지 않는다 | 로컬 기능 권한(편집, 시트 출력, 체험판 표시)은 Rust `license.rs`가 검증한 서명 라이선스 파일(`license_store`)만 믿는다. SQLite 다른 값·`local_settings`·`localStorage`로 판정 금지. 클라우드 기능 권한은 호출마다 서버 `arch.org_features`(`02_ARCHITECTURE.md:94-99`). 라이선스 파일 `features`는 화면 표시용 |
| LLM은 선을 그리지 않는다 | 어떤 그래프·서술도 좌표·치수·면적·판정 값·금액을 만들지 않는다. `arch.intake`·`arch.layout` 출력은 strict 스키마(좌표·면적 필드 없음, 추가 필드 거부), review·제안서 문장의 숫자는 `{ref:<판정 경로>}` 자리표시자 치환만(`01_PRD.md 9.1절`, `02_ARCHITECTURE.md:322`) |
| 도면은 모델에서만 파생 | DesignModel이 정본이고 시트는 매번 다시 계산한다. 시트에서 고칠 수 있는 것은 `annotations[]`(자동 주석 옮기기·숨김, 사람 치수·문자·지시선·구름)뿐, 치수·면적 문자 값과 형상은 못 바꾼다(04장 4.7.3절). 뷰 생성기는 법규 값을 다시 계산하지 않고 JudgmentResult와 `packages/geometry`만 읽는다. 수치 TEXT는 `source_ref` 필수(`01_PRD.md 9.1절`, `02_ARCHITECTURE.md:164`, `:184`) |
| DXF는 결정적 | 같은 입력·엔진 버전 → 같은 바이트(`$TDCREATE`·`$TDUPDATE`만 예외). 모델 mm 정수, 용지 0.01mm 정수, half-away-from-zero, 지수 표기 금지, 정렬 순서 고정, 핸들 순차, `\r\n`, `$ACADVER = AC1027`, 엔티티는 LINE·LWPOLYLINE·ARC·CIRCLE·TEXT·MTEXT·HATCH·INSERT/BLOCK만(`02_ARCHITECTURE.md:190-210`). 엔진 패키지에서 `Date`, `Math.random`, 네트워크, `process.env` 금지(린트) |
| 표제란 고지 불변 | "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다"는 `titleblock` 상수다. DraftingProfile·덮어쓰기·레이어 매핑·요청 입력으로 지울 수 없고 네 작성기가 출력 직전에 존재를 다시 확인한다. 건축사 날인·서명란을 만들지 않는다. 체험판 표시는 서명 파일 `drafting_watermark`로만 정한다(`01_PRD.md 9.1절`, `:450`, `02_ARCHITECTURE.md:186`) |
| GPL 번들 금지 | 설치 파일에 GPL·AGPL 라이브러리를 넣지 않는다(DWG 오픈소스 라이브러리 포함, `01_PRD.md 9.9절`). 라이선스 미확인 후보(2D 다각형 AR-02-D1, rhino3dm AR-02-D2, jsPDF·svg2pdf.js D-23)는 확인 기록(`[DECISION]`) 전 머지 금지. 글꼴은 재배포 가능 라이선스(SIL OFL 등)만, DXF에는 글꼴 이름만(`01_PRD.md 9.7절`). ezdxf는 CI 전용이고 런타임에 넣지 않는다 |
| 코어 재정의 금지 | auth, org, credits, toss, webhooks, storage, audit, jobs, compliance, fal client, weasyprint render, ai-gateway, ai-service, dify, core-voice, llm-wiki는 import·호출만(`02_ARCHITECTURE.md:270-290`) |
| 수정 금지 | `D:/WorkSpace/platform/docs/products/_platform-core/`, `D:/WorkSpace/platform/docs/products/_design-guide/`, `_supabase-modular/`의 다른 파일, `packages/core-*`, 공용 ai-service 원본, `@nomad/compliance` 패키지 코드. 필요하면 `06_AGENT_PLAN.md` 6장 요청(R-A1~R-A14)에 적는다 |
| DB 변경 | `2400_arch.sql`만, AR-06-001 담당만(compliance 변환본은 AR-V2-01). 모놀리스와 seed는 변환 스크립트로만 재생성 |
| 키 위치 | LLM 키는 `api/`에만. `FAL_KEY`·`RENDER_SERVICE_TOKEN`은 워커에만. `LICENSE_SIGNING_PRIVATE_KEY`·`AI_TOKEN_PRIVATE_KEY`·`VWORLD_API_KEY`는 web 서버에만. 업데이트 서명키·코드 서명 인증서는 CI 환경 비밀에만(`02_ARCHITECTURE.md:430-462`) |
| AI 경계 | 데스크톱·웹 화면은 `/api/ai/*`, `/api/voice/*`만 부른다. Dify·FastAPI·fal·음성 서버 직접 호출 금지(`D:/WorkSpace/platform/docs/Tauri/README.md:171`). 렌더 입력은 뷰포트 깊이·윤곽 이미지와 프리셋뿐(원본 모델·도면 전송 금지). 클라우드 검토는 데스크톱이 보낸 JudgmentResult를 믿지 않고 서버가 같은 `packages/rules`로 재계산한다(`02_ARCHITECTURE.md:308`) |
| 오프라인 | 도면 생성·DXF·SVG·PDF·PNG 출력·매스 자동 제안·판정·엔벨로프는 로컬 Web Worker에서 0크레딧, 잡이 아니다. 서버를 거치지 않는다(`02_ARCHITECTURE.md:306`) |
| mock 금지 | 실패를 성공처럼 표시하지 않는다. 동기화 실패·잡 실패·환불을 화면에 보인다. "마지막 쓰기 승리"를 조용히 적용하지 않는다(`AR041`). 인증 Mock은 아래 "인증 단계 규칙"만 허용 |
| 인증 단계 | 지금은 Stage A(Mock)다. 단계 분기 코드는 인증 경로에만, 단계 전환은 사람이 G1·G2를 판정한 뒤(맨 끝 절) |

## 3. 디렉토리와 소유 경계

`02_ARCHITECTURE.md` 2절(`:30-55`)과 `06_AGENT_PLAN.md` 2장 "소유 파일/디렉토리" 열이 정본이다. 자기 작업 경로만 쓴다. 공용 설정(`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`)은 AR-06-003에 요청한다. 화면 작업은 AR-06-012(디자인 시스템 4단계) 뒤에 시작한다.

| 위치 | 책임 | 소유 작업 |
|---|---|---|
| `supabase/**`(tests 제외), `scripts/db/**`, 생성 타입 | `arch` 스키마, 모놀리스 변환, seed, 타입 | 001 |
| `supabase/tests/**`, `scripts/test-rls/**` | RLS·권한 회귀 | 002 |
| 루트 설정, `web/src/{proxy.ts,lib/**}`(`lib/auth`·`lib/compliance` 제외) | 모노레포·web 골격 | 003 |
| `desk/{index.html,vite.config.ts,src/main.tsx,src/routes/**}`, `rust/` 골격·`capabilities/` | 셸 골격, 라우트 → `feat/<기능>` 지연 로드 | 004 |
| `packages/shell-bridge/src/**`(`auth/` 제외), `rust/src/commands/secrets.rs` | NativeBridge, SecureStore, Exporter | 005 |
| `rust/src/commands/{local_db,fs,export}.rs`, `desk/migrations/**` | 로컬 DB, 파일 대화상자 경로 | 006 |
| `rust/src/commands/{license,device}.rs`, `rust/keys/**` / `updater.rs` / `deeplink.rs` | 라이선스 검증 / 업데이트 / 딥링크 | 041 / 042 / 062 |
| `desk/src/workers/**` | `engine.worker.ts`, `drafting.worker.ts` | 017 |
| `packages/domain/src/**` | DesignModel·SheetSpec·JudgmentResult·DraftingProfile zod | 013 |
| `packages/geometry/src/**`(`solid/` 016) | 2D 연산, mm 정수 | 014 |
| `packages/rules/**`(`envelope/` 016) | 판정, 규칙 팩, 골든 | 015, 016 |
| `packages/program/**`, `packages/massing/**`, `packages/layout/**` | 프로그램·공사비 / 매스 제안 / 실 배치 규칙 | 018 / 028 / 026 |
| `draft/src/{sheet,titleblock,layers,annotate}/**` | 시트 모델, 축척, 표제란, 레이어, 주석 | 020 |
| `draft/src/writers/dxf/**`, `draft/golden/{_harness,writer-*}/**`, `.github/workflows/golden.yml` | DXF 작성기, 골든 CI | 021 |
| `draft/src/writers/{svg,png,pdf}/**`, `draft/fonts/**` | SVG·PNG·PDF, 글꼴 폭 표 | 022 |
| `draft/src/views/<kind>/**`, `draft/golden/<kind>-*/**` | 뷰 생성기(site_plan 023, area_plan 024, sunlight_section 025, floor_plan 026) | 023~026 |
| `packages/io/src/{ifc,gltf,rhino}/**` / `dxf-import/**` | 3D 입출력 / DXF 가져오기 | 039 / 029 |
| `feat/<기능>/**` | 화면 기능(auth 008, settings 031, proposal 032, projects 034, site 035, modeler 036, judgment 037, program 038, license·credits 044, review·chat·wiki 055, render 056, sheets 030, plans 027, voice 053) | 2장 각 행 |
| `packages/ui/**` | 토큰(`tokens.css`), 기본·CAD형 컴포넌트 | 010 |
| `web/src/server/<도메인>/**`, `web/src/app/api/<리소스>/**` | 서버 도메인·Route Handler(리소스별 단일 소유) | 2장 각 행 |
| `web/src/app/(marketing)/**`, `web/src/components/hero3d/**`, `web/public/hero/**`, `web/src/app/legal/**` / `(marketing)/samples/**`, `web/public/samples/**` | 랜딩·3D 히어로·법적 고지 / 샘플 도면 | 057 / 033 |
| `api/app/ai/graphs/arch_{review,intake}.py`, `api/app/ai/compliance/arch.py`, `api/app/ai/products/arch/**` | 그래프, compliance, 스키마, RAG, 서술 | 046, 050, 051, 052, 032 |
| `wk/src/{index.ts,core/**,cron/**}` / `wk/src/handlers/<kind>/**` | 워커 골격 / 잡 핸들러 | 048 / 032, 051, 052, 053, 056 |
| `e2e/**`, `tests/**`, `desk/e2e/**`, `api/tests/arch/**` | 테스트 작업 소유 | 045, 049, 060, 061, AR-V2-02 |
| `.github/workflows/{desktop-build,desktop-release,web,api}.yml`, `scripts/ci/**` | CI·서명·릴리스 | 058 |
| `spikes/drafting/**` | 버리는 스파이크 코드(패키지 import 금지) | 019 |

인증 단계 분기 경로: `web/src/lib/auth/`, `web/src/app/(auth)/`, `web/src/app/auth/`, `web/src/app/api/dev/login/`, `web/src/app/api/auth/finish/`, `packages/shell-bridge/src/auth/**`, `feat/auth/**`(008, 062, 063, 064).

## 4. 코어 사용 규칙

| 상황 | 쓰는 것 |
|---|---|
| Route Handler 진입 | `const ctx = await requireSession('arch')`(쿠키 또는 `Authorization: Bearer`, 코어 요청 R-A6 = T-C1) → zod → 레이트 리밋 → `arch.org_features(ctx.org.id)` 기능 판정 → 크기·동시성 검사(`AR031`, `AR030`) → 서버 RPC → 응답. CORS는 셸 출처 허용 목록(`DESKTOP_CORS_ORIGINS`, 와일드카드 금지, R-A7 = T-C2) |
| 크레딧 | AI 작업은 `arch.start_ai_run`만(위 2장). kind·variant → 크레딧: render_std 3, render_hq 5, upscale 2, review 15, intake_text 2, intake_consult 5, proposal 10, doc_template 1(같은 버전 재요청 0). STT는 core-voice `voice:<request_id>` 멱등 키로 분당 1. 채팅은 ai-gateway 턴 선차감 1/턴. 데스크톱은 금액을 보내지 않는다 |
| 잡 | `start_ai_run` 안의 `core.enqueue_job`. 큐 = job_type(`arch.render`, `arch.review`, `arch.intake`, `arch.proposal_pdf`, `arch.stt`, Phase 2 `arch.layout`·`arch.walkthrough`), 소비자는 `workers/arch-jobs` 하나(`core.claim_jobs`). payload에는 id만(좌표·문장·비밀 금지). 결과는 `arch.finish_ai_run`, 실패는 `fail_job` → `arch.fail_ai_run`. 진행률은 Realtime `core.jobs` |
| 그래프 실행 | 워커가 `POST /api/internal/ai-token`(`ARCH_WORKER_INTERNAL_KEY`)으로 잡 토큰을 받아 FastAPI `POST /graphs/arch.<name>/runs`. Next.js → FastAPI는 EdDSA 서명 토큰(`iss=arch`, `aud=platform-ai:arch`), 발급은 `web/src/server/ai/`만 |
| 라이선스 | 발급 `arch.issue_license`(Toss 웹훅 확정 후), 활성화 `arch.activate_license`·플랜 기기 `arch.activate_plan_device`(service_role, Route Handler가 세션 검증 후), 해제 `arch.deactivate_activation`(owner·admin), 연장 `arch.extend_updates`. 라이선스 파일은 Ed25519(`kid`), 서버는 시리얼 해시만 저장하고 화면은 끝 5자만 |
| 업데이트·규칙 팩 | 매니페스트는 `arch.eligible_build(p_org, p_platform, p_current)`, 팩 목록은 `arch.eligible_rule_packs()`. Rust가 서명과 `published_at <= updates_until`을 다시 확인한 팩만 엔진에 넘긴다 |
| Storage 경로 | 서버가 만든 `<org_id>/arch/<purpose>/<uuid>.<ext>`만(`POST /api/uploads/sign`, purpose `project_snapshot`·`render_input`·`proposal_sheet`·`consult_audio`). 버킷 `arch-releases`(빌드·팩·단가표, 서명 URL), `arch-user`(사용자 업로드). 사용자 파일명은 표시용만 |
| 로컬 파일 | 읽기는 Rust `fs.rs`가 OS 대화상자 경로만, 쓰기는 `export.rs`가 저장 대화상자 경로만. 화면이 준 문자열 경로 거부 |
| 웹훅 | 원시 본문 서명 검증 → `core.webhook_events`(provider, event_id) 멱등 → 처리. 결제 결과 딥링크는 표시 갱신 트리거일 뿐 확정 근거가 아니다(`D:/WorkSpace/platform/docs/Tauri/README.md:182`) |
| 감사 | 활성화·해제, 라이선스 발급·정지, 표제란 설정 변경, 국외 이전 동의, 녹음 고지 확인, 로그인(`auth.login`)은 감사 필수. 사용자 RPC는 내부에서 `write_audit` |
| compliance | 그래프 마지막 생성 노드 + `api/app/ai/compliance/arch.py`. 웹 가입·구매 약관·동의 기록은 `@nomad/compliance`(`createModule({ appId: 'arch' })`, `profileKind: kr_ecommerce`, AR-V2-01) |
| DB 스키마 | 모듈러 `supabase.schema('arch')`, 코어는 `SUPABASE_DB_SCHEMA`(`core` / 모놀리스 `public`) |
| SECURITY DEFINER | `set search_path = ''`, 스키마 한정, service RPC는 `core.is_service_caller()`, PUBLIC EXECUTE 회수 후 허용 목록 부여(`04_API.md:134`) |

## 5. 코드 규칙

| 항목 | 규칙 |
|---|---|
| 스택 | Tauri 2.x(구현 시 최신 2.x 고정, 2026-10-10 확인 2.12.3), Rust stable + `rusqlite`(bundled), Vite + React 19 + React Router, Next.js 16.2.x + React 19.2, TypeScript strict, Tailwind CSS v4(4.x 고정, `@import "tailwindcss"`, `@theme`, `@custom-variant dark`), shadcn/ui(Tailwind CSS v4 지원 버전), zod 3.x, three.js + React Three Fiber + drei(WebGL2), Manifold WASM, web-ifc, Node 20 LTS(워커), FastAPI + Python 3.12(제안) + LangChain/LangGraph, pgvector 0.8 이상(`02_ARCHITECTURE.md:7-22`) |
| 금지 설정 | `tailwind.config.js`, `@tailwind base` 등 v3 문법, `latest` 의존성. 지시·문서에 "Tailwind"가 아니라 "Tailwind CSS v4"라고 쓴다 |
| 의존성 | 버전 고정 + lockfile 커밋(`pnpm-lock.yaml`, `Cargo.lock`). 새 의존성은 라이선스를 PR에 적는다(GPL·AGPL 거부) |
| 타입 생성 | `supabase gen types typescript --local --schema core,arch > apps/web/src/types/supabase.ts`(같은 출력을 `packages/domain/src/db/supabase.gen.ts`에 복사, AR-06-001 스크립트). 모놀리스는 `--schema public`. `any`로 Supabase 타입 우회 금지 |
| 계약 | DesignModel·SheetSpec·JudgmentResult·DraftingProfile은 `packages/domain`(zod)이 정본, Python은 `apps/api/app/ai/products/arch/schema.py`(pydantic) 사본 + 동치 테스트. 다른 곳에서 형식을 다시 정의하지 않는다. 스키마 변경은 `schema_version` 이주 함수와 함께 |
| TS 린트 | ESLint flat(typescript-eslint, react-hooks). `@tauri-apps/api`는 `packages/shell-bridge` 밖 import 금지, three.js는 `hero3d/`·`feat/modeler/` 밖 금지, service 클라이언트는 `web/src/server/**` 밖 금지, `packages/{domain,geometry,rules,program,massing,layout,drafting}`에서 `Date`·`Math.random`·`fetch`·`process.env` 금지, `spikes/` import 금지, hex 직접 사용(`bg-[#...]`) 금지 |
| Rust 린트 | `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo audit`. 모든 명령 인자를 검증하고(`D:/WorkSpace/platform/docs/Tauri/README.md:208`) 비즈니스 규칙을 Rust에 두지 않는다(`02_ARCHITECTURE.md:33`). `unwrap()`은 테스트에서만. capability에 명령을 추가할 때는 해당 작업 행에 적는다 |
| Python 린트 | `ruff check`, pydantic strict(추가 필드 거부) |
| 입력 검증 | 모든 경계 zod / pydantic. 그래프 출력도 재검증(intake 스키마, layout 실 id 집합) |
| 디자인 토큰 | `packages/ui/tokens.css`(Tailwind CSS v4 `@theme`, 라이트·다크, 컴팩트·기본, 웹·데스크톱 공유). 3D 재질·SVG 미리보기 색도 토큰에서 읽는다. DXF 색은 토큰이 아니라 ACI 번호(`01_PRD.md 9.6절`)로 고정. 이모지 아이콘 금지(Lucide) |
| 단위 | 모델 좌표 mm 정수, 용지 고정 요소 0.01mm 정수, 면적 표시 ㎡ 소수 둘째 자리. 변환은 작성기 출력 직전 한 번 |
| 스트리밍 | fetch POST + ReadableStream(SSE 응답). EventSource로 POST 금지 |
| 로그 | 도면·모델 좌표, 표제란 사무소 정보, 녹음, 프롬프트 전문, 딥링크 `code`·토큰을 로그에 남기지 않는다. 워커 메시지는 `op`·`elapsed_ms`·오류 코드만(`02_ARCHITECTURE.md:266`) |
| 문구 | 실패 문구는 원인과 다음 행동(환불 여부 포함). 오류 코드 문구는 `03_SCREENS_UX.md` 5.2·5.3절. 금지 문구는 `01_PRD.md` 6.1절·9.7절 |

## 6. 테스트와 완료 조건

완료 정의 전체는 `06_AGENT_PLAN.md` 7장. 기능 작업은 자기 디렉토리 단위 테스트만 쓰고, `e2e/`·`tests/`·`desk/e2e/`는 테스트 작업이 소유한다.

| 명령 | 기대 |
|---|---|
| `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` | 통과 |
| `pnpm --filter ./apps/desktop tauri build` | 개발·릴리스 빌드 성공, 릴리스는 `VITE_AUTH_MODE=live` |
| `cd apps/desktop/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo audit` | 오류 0(변조 라이선스 파일 거부, 임의 경로·SQL 거부 테스트 포함) |
| `pytest apps/api -k arch && ruff check apps/api` | 그래프 평가셋, 출처 0건 차단, 토큰·조직 격리, 라우팅 seed 일치 |
| `supabase db reset` | 오류 0 |
| `node check.mjs --vector mod <0000~0009> seed.sql 2400_arch.sql`(`D:/WorkSpace/platform/docs/products/_tools-sqlcheck`) | OK |
| `node check.mjs --vector mono 0001_core_lite.sql 0002_arch_domain.sql seed.sql` | OK |
| `node scripts/test-rls/run.mjs --target mod` / `--target mono` | `rls_smoke.sql` 전 항목 통과(service RPC 42501, `outsider` 0행, `AR042`) |
| `pnpm --filter ./packages/drafting test:golden` + CI `golden.yml` | 골든 20건 이상 바이트 일치(시각 두 행 제외), ezdxf `audit` 오류 0, 수치 일치 속성 테스트 불일치 0 |
| `pnpm --filter ./packages/rules test` | 신·구 일조사선 신청일 쌍 골든, 근거 없는 판정 행 0 |
| `npx playwright test e2e/billing` | Toss 테스트 키 시나리오(AR-06-045) |
| `npx playwright test e2e/flows` | 상태 페르소나 접근 매트릭스, 실패 주입 환불(AR-06-061) |
| 데스크톱 E2E(`desk/e2e`, WebDriver 기반) | 설치 → Mock 로그인 → 대지 → 매스 → 판정 → DXF·PDF → 오프라인 → 복귀, 3대째 활성화 거부(AR-06-060) |
| 벤치 기록 | 판정 p95 200ms, 시트 1장 p95 1초, PDF 10장 p95 10초, 매스 제안 p95 3초(권장 사양 실기) |

P0 작업은 대응 테스트 작업(`06_AGENT_PLAN.md` 7.1절)이 녹색이어야 완료다. DB·RLS를 바꾼 PR은 스모크 두 대상이 통과해야, 엔진 패키지를 바꾼 PR은 골든 CI가 통과해야 병합한다. 골든 갱신은 엔진 버전을 올리는 PR에서만 한다.

## 7. 금지 패턴

`07_SOURCE_MIGRATION.md` 4장과 `D:/WorkSpace/platform/docs/Tauri/README.md:350-356` 요약.

| 분류 | 금지 |
|---|---|
| 돈·권한 | 크레딧 RPC를 사용자에게 열기, 비원자 차감, Route Handler의 `consume_credits` 직접 호출, `FOR ALL` 정책, 웹훅 서명 생략, 클라이언트가 만든 주문·`customerKey = Date.now()`·orderId 파싱, 클라이언트가 보낸 금액·`org_id`·플랜 신뢰, 결제 딥링크를 확정 근거로 쓰기 |
| 라이선스 | 로컬 SQLite·`localStorage`·`local_settings`로 플랜·크레딧·라이선스·체험 판정, 서명 검증 생략, 다른 PC 라이선스 파일 수용, 시계 되돌림 무시, 체험판 표시를 클라이언트 플래그로, 시리얼 원문 저장·전체 표시 |
| 비밀 | 셸 번들·Rust 바이너리·`tauri.conf.json`에 service_role, LLM·fal 키, 결제 시크릿, 서명 개인키. 허용 목록 밖 `VITE_` 변수, 실키 `.env` 커밋 |
| 런타임 | 원격 URL을 메인 창에 로드하고 IPC 권한 부여, 화면에서 임의 SQL·임의 경로 실행, `shell` 플러그인 임의 명령, 사이드카(Python ezdxf 포함) 동봉, CORS `*`, 무인증 AI 프록시 |
| 도면 무결성 | 비결정 DXF(헤더 밖 시각, 난수 핸들, Map·Set 순회 순서 의존, 부동소수 좌표, 로캘 소수점), 도면 수치를 판정과 따로 계산, 시트에서 형상 수정, 표제란 고지 제거 경로(토글, `A-TTLB` 매핑 제거, 요청 입력), 엔진 버전 없는 내보내기 기록, DIMENSION·VIEWPORT 엔티티, DXF 가져오기 단위 조용히 추정, 가져온 후보를 확정 없이 판정 입력으로 사용 |
| AI·수치 | LLM이 만든 좌표·면적·판정 값·금액 저장, 출처 없는 검토 문장, 데스크톱 JudgmentResult를 검토 입력으로 신뢰, 브라우저·셸에서 Dify·FastAPI·fal 직접 호출, Dify 입력에 토큰·org, 상담 녹음을 상용 제공자로 보내기, 원본 모델·도면을 렌더 입력으로 전송 |
| 파일·글꼴·라이선스 | 화면이 준 경로로 읽기·쓰기, 크기·중첩·압축 해제 상한 없는 파서, GPL·AGPL 번들, 재배포 불가 글꼴 번들·임베딩, DXF에 PC 글꼴 경로 |
| 데이터 | "마지막 쓰기 승리"를 조용히 적용, 동기화·잡 실패를 성공처럼 표시, 공공 API 값을 판정 기준으로 사용, 판정 필수 입력에 추정 기본값 |
| 디자인·문구 | 토큰 밖 색, hex 하드코딩, 이모지 아이콘, "Tailwind"만 적은 지시, "인허가 도면 자동 작성"·"CAD 대체"·"치수 100% 정확"·"허가 가능합니다" 같은 금지 문구, 상표를 "호환" 밖으로 사용, 가상 후기·허위 수치 |
| 인증 단계 | 쿠키·`localStorage` 역할·플랜 Mock, `mock-auth`, `nomad_role`, `nomad_plan`, 가짜 세션, 앱에 박은 개발 계정, 배포 빌드의 개발용 패널, 인증 경로 밖 `AUTH_MODE`·`VITE_AUTH_MODE` 참조, 기능 코드의 `if (tauri)`·`if (mock)` 분기, 임베디드 웹뷰 소셜 로그인, PKCE 없는 OAuth, 시작하지 않은 딥링크 콜백 처리, `next` 무검증 리다이렉트, 딥링크 `code`·토큰 로그 |

변경 기록:

| 날짜 | 변경 |
|---|---|
| 2026-10-16 | 최초 작성(스키마 `arch`, 번호 2400, 도면 자동 생성 9장 반영) |

## 인증 단계 규칙 (확정 결정 22)

정본 `docs/file/03-설계/공용코어/AUTH_ROADMAP.md`, 이 제품 반영은 `01_PRD.md` AR-F-027·8.2절(`:59`, `:314-326`), `02_ARCHITECTURE.md` 9절(`:466-512`), `03_SCREENS_UX.md` 3.1절, `04_API.md` 2.1절, `06_AGENT_PLAN.md` 008·062·063·064, `07_SOURCE_MIGRATION.md` 4.2절. 매트릭스 행은 `AUTH_ROADMAP.md:339`(open 가입, B Google + 이메일, C1·C2 P2 선택).

| 항목 | 규칙 |
|---|---|
| 지금 단계 | Stage A(Mock 로그인). 웹 로컬 `.env.local`은 `AUTH_MODE=mock`, `DEV_SEED_PASSWORD`. 데스크톱 개발 빌드는 `VITE_AUTH_MODE=mock`. 배포 환경(Vercel 미리보기 포함)은 항상 `AUTH_MODE=live`, 데스크톱 릴리스는 `VITE_AUTH_MODE=live`(아니면 빌드 실패) |
| 단계 순서 | A(AR-06-008) → G1 → B(Google + 이메일, AR-06-062, P0, 사전예약 판매·공개 베타 전 필수) → G2 → C1 카카오(AR-06-063, P2 선택)·C2 네이버(AR-06-064, P2 선택) |
| 단계 분기 위치 | `AUTH_MODE`·`VITE_AUTH_MODE`·제공자 목록을 읽는 코드는 3장 끝의 인증 경로에만. 기능 코드·`proxy.ts`·`wk/`·`api/`·엔진 패키지는 `requireSession('arch')`·`session_context('arch')`만 쓴다 |
| 데스크톱 Mock | 개발 빌드에서만 로컬 시드 계정 `signInWithPassword`. Mock 패널은 `import.meta.env.DEV`와 `VITE_AUTH_MODE=mock`이 모두 참일 때만 번들에 들어간다. 비밀번호는 번들에 넣지 않고 개발자가 입력해 키체인에 둔다(`02_ARCHITECTURE.md:388`) |
| 데스크톱 B | 시스템 브라우저 + PKCE + `archstudio://auth/callback` 딥링크(막히면 루프백, D-15), 이메일은 앱 안 폼. 교환 직후 `POST /api/auth/finish`(T-C8). 시작하지 않은 콜백 무시, 세션은 키체인에만 |
| 페르소나 사용법 | `supabase start` → `supabase db reset` → `node scripts/dev/seed-users.mjs --app arch` → 웹 `/login` 개발용 패널 또는 데스크톱 개발 빌드 로그인 패널. 추가 페르소나: 체험 중·체험 만료, 영구(업데이트 유효·만료 폴백), 월 구독, 기기 2대 활성화 완료, `outsider`(`AUTH_ROADMAP.md:339`). 권한 확인은 페르소나를 바꿔 로그인해서 한다 |
| E2E | Playwright `globalSetup`이 페르소나마다 `/api/dev/login`을 호출해 `storageState`를 저장한다. 데스크톱 E2E는 개발 빌드 Mock 패널로 로그인한다. Google·카카오·네이버 실로그인은 자동화하지 않고 사람이 수동 점검표로 확인한다(B-5) |
| 단계 전환 | 에이전트가 단계를 스스로 바꾸지 않는다. 사람(대표님)이 G1(`AUTH_ROADMAP.md:177-184`)·G2(`:223-229`)를 판정하고 task `log.md`에 `[DECISION] G1 통과`, `[DECISION] G2 통과`로 기록한 뒤에 B·C 작업을 시작한다 |
| "mock" 단어 구분 | 2장 "mock 금지"는 렌더·검토·동기화 실패를 가짜 성공으로 숨기는 것을 금지한다. 이 절의 Mock 로그인은 로컬 시드 계정으로 실제 Supabase JWT를 받는 개발 수단이라 그 금지에 해당하지 않는다 |

## 설득형 랜딩 규칙 (2026-10-17, 검토용)

정본 `docs/file/03-설계/디자인/LANDING_PERSUASION.md`, 이 제품 반영은 01장 10장, 03장 7장, 06장 8장.

| 항목 | 규칙 |
|---|---|
| 주장 장부 | 랜딩 문장은 `docs/file/05-검증/실험/claims-ledger.md`에서 "검증"인 것만. 문구 상수와 장부가 다르면 `scripts/proof/check-claims.mjs`가 CI를 실패시킨다 |
| 비교 표시 | 대안은 범주 이름만(D-27). CAD·모델링 도구·법규 검토 서비스 이름과 로고 금지. 상표는 "파일 호환"만 |
| 증거 | 샘플 도면은 골든 출력 CI 복사(033 기존 규칙), 화면 기록은 실제 앱의 편집 없는 녹화 |
| 계산기·도입 단계 | 요금 값은 요금 상수 import(하드코딩 금지), 입력값 수집 금지, 시간 절감 수치는 V1 측정 전 쓰지 않는다 |
| 외부 랜딩 자료 | 다른 회사 랜딩의 문구·수치·단계 이름과 다크 글래스 비주얼 금지(`LANDING_PERSUASION.md` 1장). 단계 이름은 01장 4장 요금 구조에서 |
| 컴포넌트 경계 | `web/src/components/marketing/**`은 웹 `(marketing)` 경로에서만. 데스크톱 앱 공용 `packages/ui`에 넣지 않는다 |
| 소유 경로 | 065 `web/src/features/landing-proof/**`, `web/public/proof/**`, `scripts/proof/**`. 066 `docs/file/05-검증/실험/`. 067 `web/src/features/adoption-steps/**`. 068 `web/src/app/(marketing)/tools/**`, `web/src/features/proposal-time/**`. 069 `web/src/components/marketing/**` |


## 대시보드 셸·GNB 규칙 (2026-10-19)

정본: 03장 8장, 결정 대기 01장 11장(D-31~D-34). Arch Studio 전용이며 `_design-guide` 공용 패턴과 다른 제품 문서를 고치지 않는다. 셸은 데스크톱 앱 창(Tauri)이고 웹(`web/`)에는 이 셸이 없다.

| 항목 | 규칙 |
|---|---|
| 메뉴 순서 | 03장 8.3절 표가 정본: 프로젝트 / 법규(법규 채팅, 법규 위키) / 아래 고정(크레딧, 라이선스, 설정). 메뉴 배열은 `desk/src/routes/` 옆 한 곳(예: `nav.ts`, 제안, AR-06-004)에 두고 화면마다 따로 만들지 않는다. GNB의 모든 경로는 03장 1절 표에 있는 것만 쓴다 |
| 프로젝트 화면 | 프로젝트 안 화면 8개는 GNB 메뉴가 아니라 상단 탭이다. D-31 결정 전에는 GNB를 64px 레일로 접고 셸 헤더 한 줄에 탭을 둔다(03장 8.4절) |
| 잠금 | 메뉴를 숨기지 않는다(03장 1절 :37). 로컬 기능은 Rust `license.rs`가 검증한 라이선스 파일, 클라우드 기능은 호출마다 서버 `arch.org_features`로만 판정한다. GNB 접기 상태 외의 상태·플랜·권한을 `local_settings`·`localStorage`에 쓰지 않는다(2장 "로컬 SQLite는 권한을 정하지 않는다") |
| 로그인·오프라인 | 로그인 없이 쓰는 PC와 오프라인에서도 클라우드 메뉴를 숨기지 않고 "로그인"·"오프라인" 배지로 보인다. 프로젝트·라이선스 상태 보기·설정은 막지 않는다 |
| 브라우저 화면 | 결제·구매·`/account/*`는 셸 안에 넣지 않고 `openExternal`로만 연다 |
| 없는 메뉴 | 사주·운세 메뉴(FortuneDocs 원본 기능)를 만들지 않는다. 이식하는 것은 "결정적 수치는 엔진, LLM은 서술만" 원칙뿐이다(03장 8.7절) |
| 색·수치 | 4.3절 토큰만. 엔벨로프 청록은 셸에 쓰지 않고, 콘크리트는 글자·아이콘에 쓰지 않는다. 홈에 큰 숫자 KPI 카드와 크레딧 잔액 칸을 두지 않고, 데이터가 없으면 칩을 숨기거나 빈 상태 문구를 쓴다. 진행률은 서버가 보고한 단계만 |
