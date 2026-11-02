# 02 아키텍처: Arch Studio (arch-studio)

작성일 2026-10-16. 데스크톱 공통 구조·인증·라이선스·보안의 정본은 `D:/WorkSpace/platform/docs/Tauri/README.md`, AI 계층·음성·위키의 정본은 `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md`, `VOICE_ARCHITECTURE.md`, `LLM_WIKI.md`이고, 이 문서는 그것을 인용하며 arch-studio 고유의 패키지 경계, 도면 엔진, 잡, 그래프, 배포만 정한다. 기능 정본은 `docs/file/02-요구사항/01_PRD.md`(AR-F-001~038, D-1~D-26)이며 여기서 재정의하지 않는다. 코드 블록은 계약 예시이고 구현 파일이 아니다. 06장 작업 ID(`AR-06-###`)는 06장이 정본이라 이 문서는 모듈 이름과 06장 5.3절 매핑표(위험 → 작업 ID)로 가리킨다.

## 1. 스택

| 레이어 | 기술 | 버전 | 근거 |
|---|---|---|---|
| 데스크톱 셸 | Tauri 2.x + Rust 코어(`apps/desktop/src-tauri`). 플러그인: deep-link, updater, dialog, single-instance(딥링크를 실행 중 인스턴스로 넘김, Windows 동작 미확인) | 2.x 최신 고정(tauri 2.12.3, 2026-10-10 확인) | `D:/WorkSpace/platform/docs/Tauri/README.md:22`, `:24` |
| 데스크톱 화면 | Vite + React 19 + React Router(정적 번들), Tailwind CSS v4(`@import "tailwindcss"`, `@theme`, 4.x 고정, v3 문법 금지), shadcn/ui(Tailwind CSS v4 지원 버전) | 구현 시 고정, `latest` 금지 | `D:/WorkSpace/platform/docs/Tauri/README.md:232`, `:362`, `docs/file/03-설계/디자인/DESIGN_SYSTEM.md:67` |
| 3D 뷰포트 | three.js + React Three Fiber + drei. WebGL2 기준, WebGPU 미사용 | React 19 호환(구현 시 확인) | `D:/WorkSpace/platform/docs/Tauri/README.md:258`, `01_PRD.md 3절` |
| 지오메트리 | Manifold WASM(Apache-2.0, 3D 불리언·압출). 2D 다각형 연산은 Clipper2 계열 후보(라이선스 미확인, AR-02-D1) | 구현 시 고정 | `01_PRD.md 6절`, `D:/WorkSpace/platform/docs/Tauri/README.md:290`(1주 스파이크) |
| 도면 엔진 | 자체 TS 패키지 `packages/drafting`: 시트 모델 + 자체 DXF 작성기(D-20 (a)) + SVG 작성기 + 로컬 벡터 PDF(후보 jsPDF + svg2pdf.js, 라이선스 미확인, D-23) + PNG(WebView 캔버스 래스터화) | 자체 코드 | `01_PRD.md 9.9절`, `:482` |
| 파일 입출력 | `packages/io` 자체 작성기: glTF 2.0(.gltf, 버퍼 data URI)·IFC4 STEP(IfcTriangulatedFaceSet) — 결정적 순수 함수, 런타임 의존성 없음. web-ifc 0.0.78(MPL-2.0)은 번들 제외·테스트 왕복 검증 전용. rhino3dm 8.35.0(.3dm, MIT, AR-02-D2 확인)은 다음 단계. DXF 가져오기 자체 파서(P1, 엔티티 부분집합) | AR-06-039 고정 | `01_PRD.md 3절`, `:232` |
| 로컬 DB | SQLite(`rusqlite` bundled). 화면은 이름 붙은 Rust 명령 `local_db_*`만 | 구현 시 고정 | `D:/WorkSpace/platform/docs/Tauri/README.md:111` |
| 클라우드 웹 | Next.js 16.2.x App Router + React 19.2(`apps/web`), Tailwind CSS v4, three.js 히어로 | 16.2.x | 확정 결정 3, `D:/WorkSpace/platform/docs/Tauri/README.md:218` |
| 웹 스튜디오 셸 (추가 2026-10-28) | `apps/desktop`의 Vite 앱을 웹 빌드 모드(web 어댑터)로 `app.` 서브도메인 정적 호스트에 배포(D-071a; 출처·스토리지를 마케팅 도메인과 분리, 같은 출처는 팀장 승인 예외). 엔진은 웹 워커에서 그대로 실행. 라우팅·워커 생성·CSP는 이 셸이 소유 | Vite(설치형과 동일 앱) | `ADR-001_DELIVERY_AND_LICENSING.md` 2·5장 |
| AI 서비스 | FastAPI(Python) `apps/api`, LangChain, LangGraph + `langgraph-checkpoint-postgres`(`ai_runtime`), pgvector RAG(HNSW, 1024차원) | Python 3.12(제안), pgvector 0.8 이상 | `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md` 4~6장 |
| 채팅·음성·이미지 | 공용 Dify 앱 `arch-chat`, `packages/core-voice`(STT), fal(렌더) | 설치 버전 확인 | `docs/file/03-설계/공용코어/SHARED_MODULES.md:502-506`, `:241` |
| 워커 | Node 20 TS `workers/arch-jobs`, 큐는 `core.jobs`(`claim_jobs`)만 | Node 20 | `docs/file/03-설계/공용코어/CORE_SPEC.md:308` |
| DB | Supabase(Postgres 15) 모듈러 스키마 `arch`(2400~2499, SQLSTATE `AR`). 단독 배포용 monolith 동시 작성 | PG 15 | `README.md` 5장, `docs/file/03-설계/공용코어/DB_CONVENTIONS.md:42` |
| 결제 | Toss Payments(코어). 영구 라이선스는 코어 요청 C-1 후 | API v1 | `01_PRD.md 4.1절` |
| 테스트·검증 | Vitest + 속성 테스트(fast-check, 제안), pytest, Playwright(web), WebDriver E2E(desktop, T-012), Python ezdxf `audit`(CI 전용, 버전 고정, 런타임 미포함), `cargo audit` | 고정 | `01_PRD.md 9.3절`, `D:/WorkSpace/platform/docs/Tauri/README.md:212` |

열린 기술 결정(이 문서에서 추가, 1주 스파이크에서 확정): AR-02-D1 2D 다각형 라이브러리 선택과 라이선스(후보 Clipper2 계열, 확인 실패 시 정수 좌표 자체 구현), AR-02-D2 rhino3dm 라이선스(확인 실패 시 .3dm은 MVP에서 내보내기만 보류). D-23의 jsPDF·svg2pdf.js 라이선스도 같은 스파이크에서 확인한다.

W0 공유 스파이크 (추가 2026-10-28, `ADR-001_DELIVERY_AND_LICENSING.md` 2장): AR-06-071a, 1주. 질문 = `packages/features` 라우트 정의를 Vite(`apps/desktop`)와 Next.js App Router가 공유할 수 있는가. 결과(D-071a, 2026-10-29): 공유안 불채택, Vite SPA 하나에 `web` 어댑터를 붙여 정적 호스팅하고 Next(`apps/web`)는 마케팅·계정·API만 맡는다. 별도 `apps/studio-web` 없음(Q8 닫힘).

## 2. 모듈 경계

모노레포 구조는 `D:/WorkSpace/platform/docs/Tauri/README.md` 10장을 따르되, 같은 장의 `packages/engine` 하나(`:225`)를 책임별 패키지(domain, geometry, rules, program, massing, layout, drafting, io)로 나눈다. 이유: 도면·판정·매스가 같은 타입과 같은 지오메트리 함수를 써야 수치가 하나의 출처에서 나온다(2.3절). 06장 소유 경계의 기준이다.

| 모듈 | 디렉토리 | 책임 | 계약 |
|---|---|---|---|
| desktop-shell | `apps/desktop/src/{main.tsx,routes/**}`, `apps/desktop/index.html`, `apps/desktop/vite.config.ts` | 라우팅(03장 화면 경로), 워커 생성, CSP, `envPrefix: 'VITE_'` | `packages/features`, `packages/shell-bridge` |
| desktop-rust | `apps/desktop/src-tauri/**`(`fs.rs`, `local_db.rs`, `secrets.rs`, `license.rs`, `device.rs`, `updater.rs`, `deeplink.rs`, `export.rs`), `capabilities/` | OS 접점만: 대화상자 경로 파일 읽기·쓰기, SQLite, 키체인, 라이선스 서명 검증, 기기 해시, 업데이트, 딥링크 수신 | 명령 인자 전부 검증(`D:/WorkSpace/platform/docs/Tauri/README.md:208`). 비즈니스 규칙 없음(`:74`) |
| local-migrations | `apps/desktop/migrations/**` | 로컬 SQLite(B 분류 테이블) 마이그레이션, 업데이트 전 스냅샷 | 필드 추가만 허용(`D:/WorkSpace/platform/docs/Tauri/README.md:104`) |
| domain | `packages/domain/src/**` | DesignModel·SheetSpec·JudgmentResult·DraftingProfile 타입, zod 스키마, `schema_version` 이주 함수 | 모든 패키지가 import. Python 쪽은 pydantic 동치 테스트 |
| geometry | `packages/geometry/src/**` | 2D 다각형(합집합, 오프셋, 면적, 최단거리), 압출, 엔벨로프 솔리드(Manifold 래퍼). mm 정수 | 순수 함수. 면적·거리 함수는 rules와 drafting이 같은 것을 쓴다 |
| rules | `packages/rules/src/**`, `packages/rules/golden/**` (규칙 팩 `packs/**`는 엔진 밖, 아래 rule-pack-data 행) | 판정 엔진, 규칙 팩 로더·선택(신청 예정일), 엔벨로프 한계, 주차·대상 여부 | 입력 DesignModel + 규칙 팩 → JudgmentResult. 판정 행마다 근거 조항·시행일·팩 버전(AR-F-004). CI 번들 검사: 엔진 번들에 팩 0바이트(`ADR-001` 5장) |
| rule-pack-data (추가 2026-10-28) | 서버 배포 데이터: 버킷 `arch-releases` `rule-packs/<version>/pack.json`(05장 2.15). 소스 저장소 경로는 `팀장 결정 필요` | 규칙 팩(법령 데이터). `packages/rules/packs/**`에서 이동 | 서버가 `arch.eligible_rule_packs()`로 자격 확인 후 서명 URL로만 제공(웹·데스크톱 공통, 04장 2.1). 체험에도 내려가며 브라우저에서 평문이라 팩 자체는 비밀 아님 |
| program | `packages/program/src/**` | 체크리스트 → 실 프로그램·면적표(AR-F-011), 개략 공사비(AR-F-012) | 결정적 순수 함수, 사용자 잠금 행 보존 |
| massing | `packages/massing/src/**` | 매스 후보 3안(AR-F-033, D-26 결정적 격자 탐색) | 후보는 rules로 판정 PASS인 것만 반환 |
| layout | `packages/layout/src/**` | 실 배치 편집 규칙(겹침·외곽 검사 AR051, 벽 두께, 문·창 위치), Phase 2 배치 솔버 | 입력 실 인접 의도 JSON + 층 외곽 → 실 다각형 3안 |
| drafting | `packages/drafting/src/{sheet,views,annotate,titleblock,layers,writers/dxf,writers/svg,writers/pdf,writers/png}/**`, `packages/drafting/golden/**` | 도면 엔진(AR-F-028~032, 036, 038). 2.3절 | 2.3절 계약 |
| io | `packages/io/src/{ifc,gltf,rhino,dxf-import}/**` | AR-F-016 내보내기·가져오기, AR-F-037 | 가져오기 결과는 "후보"이고 사용자가 확정해야 DesignModel에 들어간다 |
| engine-worker | `apps/desktop/src/workers/**`(`engine.worker.ts` 판정·엔벨로프·매스, `drafting.worker.ts` 시트·작성기·가져오기, 이름은 제안) | 무거운 계산을 UI 스레드 밖에서 실행 | 2.4절 메시지 프로토콜 |
| web-studio (추가 2026-10-28) | `apps/desktop`의 Vite 앱 웹 빌드(`app.` 정적 호스트, D-071a), 웹 워커 경로 `apps/desktop/src/workers`(설치형과 공용, D-071a·AR-06-071 결정 1) | 로그인 후 스튜디오 셸: 설치형 화면 17개와 같은 기능(설계·판정·도면·AI·표제란 설정, 화면 매핑 03장 1.3.2절), 라우팅, 워커 생성, CSP(`wasm-unsafe-eval`은 여기에만, `unsafe-eval`·`unsafe-inline` 금지), SVG 정화 | `packages/features`, `packages/shell-bridge`의 `web/` 구현. Next의 `(marketing)`·`(account)`와 별도 앱(D-071a). 같은 `EngineRequest/Response`(2.4절). `packages/features`는 `apps/*`를 import하지 않는다 |
| shell-bridge | `packages/shell-bridge/src/{tauri,web}/**`(구현 2벌) | 플랫폼 어댑터 5종 `ProjectStore`·`FileGateway`·`SecureStore`·`EntitlementClient`·`Updater`(+`capabilities`, 계약 `ADR-001` 2.1). 기존 NativeBridge·LicenseClient·Exporter는 `tauri/` 구현 안으로 들어가고 웹 대체는 `web/`이 맡는다(제안). 데스크톱 인증 흐름(`src/auth/**`). 기능 코드는 `capabilities`로 분기하고 `platform === 'web'` 직접 검사 금지 | `D:/WorkSpace/platform/docs/Tauri/README.md:237-249`. 화면은 Tauri API를 직접 import하지 않는다(`:234`) |
| features | `packages/features/src/{auth,projects,site,modeler,judgment,program,plans,sheets,render,proposal,review,chat,wiki,voice,license,credits,settings,api-client}/**` | 화면 기능 단위. 데이터 접근은 주입받은 클라이언트로만 | api-client: Bearer, 재시도 대기열(`D:/WorkSpace/platform/docs/Tauri/README.md:318`) |
| ui | `packages/ui/src/**`, `packages/ui/tokens.css` | 디자인 시스템 컴포넌트, Tailwind CSS v4 `@theme` 토큰(웹·데스크톱 공유) | 03장 |
| web-public | `apps/web/src/app/(marketing)/**`, `apps/web/src/app/legal/**` | 랜딩, 가격, 다운로드, 샘플 도면 | 샘플 DXF·PDF는 골든 케이스 출력물을 CI가 복사(실제 엔진 출력만 게시, 제안) |
| web-account | `apps/web/src/app/(account)/**` | 계정 화면: 라이선스·좌석·기기·크레딧·결제 결과(마케팅 도메인). 설계 화면과 표제란 설정은 여기가 아니라 web-studio와 데스크톱이 같은 `packages/features` 화면으로 제공(ADR-001 1장 ① 기능 동등) | `requireSession('arch')` |
| web-api | `apps/web/src/app/api/**` → `apps/web/src/server/{licenses,updates,rule-packs,site,cloud-projects,drafting-profile,billing,ai,voice,jobs,account}/**` | Route Handler(얇게), 라이선스 서명, 업데이트 매니페스트, VWorld 중계, 크레딧 선차감 RPC 호출, 서명 URL | 04장 2절. 데스크톱 요청은 Bearer(T-C1), CORS 셸 출처만(T-C2). 스튜디오(`app.` 출처)는 Bearer만, 쿠키·CSRF 경로 없음(04장 1절, D-071a) |
| auth | `apps/web/src/lib/auth/`, `apps/web/src/app/(auth)/`, `apps/web/src/app/auth/`, `apps/web/src/app/api/dev/login/`, 데스크톱 `packages/shell-bridge/src/auth/**` + `packages/features/src/auth/**` | 로그인 단계 분기(A/B/C)와 데스크톱 앱 복귀(9절) | 단계 분기는 이 경로에서만(`AUTH_ROADMAP.md` 3.1절). 기능 코드는 `session_context`만 |
| hero3d | `apps/web/src/components/hero3d/**`, `apps/web/public/hero/**` | 랜딩 3D 히어로 | three.js import는 여기와 `features/modeler`만 |
| ai-service | `apps/api/app/ai/graphs/arch_{review,intake,layout}.py`, `apps/api/app/ai/compliance/arch.py`, `apps/api/app/ai/products/arch/**` | 그래프 3종, 제품 compliance 규칙, 제안서 서술 생성, 법령 RAG 수집 | 서명 토큰·잡 토큰만 신뢰(`AI_ARCHITECTURE.md` 2.1절) |
| workers | `workers/arch-jobs/src/**` | 모든 `arch.*` 큐의 단일 소비자: 렌더(fal), 제안서 PDF(공용 WeasyPrint), 그래프 잡 실행 요청(잡 토큰), 결과 정리 | `core.claim_jobs`, `arch.finish_ai_run`/`fail_ai_run` |
| db | `supabase/**` | `arch` 스키마, RLS, seed(`ai_routing_settings` 포함) | 05장 |
| ci | `.github/workflows/{desktop-build,desktop-release,web,api,golden}.yml` | 빌드·서명·매니페스트, 골든·ezdxf audit, 비밀 문자열 검사 | 7절 |

AI 모듈 경계(`AI_ARCHITECTURE.md` 1~3장 인용): 데스크톱과 웹 화면은 `/api/ai/*`, `/api/voice/*`만 부른다(`D:/WorkSpace/platform/docs/Tauri/README.md:171`). Next.js ↔ FastAPI는 EdDSA 서명 토큰(`iss=arch`, `aud=platform-ai:arch`), 워커 ↔ FastAPI는 잡 토큰(`sub=job:<id>`)이다. 잡 토큰 발급 경로는 코어 ai-gateway 표준 내부 경로 `POST /api/internal/ai-token`(워커 키 인증)을 쓴다(04장 6.3절).

```
┌──────────────────────────── 사용자 PC (Windows 10/11 x64) ─────────────────────────────┐
│ WebView2: apps/desktop (Vite + React 19) + packages/features, ui (Tailwind CSS v4)      │
│   3D 뷰포트(three.js/R3F)      판정 패널      시트 미리보기(SVG)                          │
│      │ postMessage(EngineRequest / EngineResponse, 2.4절)                               │
│      ├──▶ engine.worker   : rules, massing, geometry(Manifold WASM)                      │
│      └──▶ drafting.worker : drafting(SheetModel → dxf/svg/pdf/png), io(dxf-import 등)     │
│      │ NativeBridge(packages/shell-bridge): invoke() / 이벤트                            │
│      ▼                                                                                  │
│ Rust 코어: fs, local_db(SQLite B 분류), secrets(키체인), license(Ed25519 검증),           │
│            device(device_hash), updater(서명 검증), deeplink, export                     │
└───────┬───────────────────────────────────────────┬────────────────────────────────────┘
        │ HTTPS Bearer JWT / 서명 라이선스 파일       │ supabase-js(RLS 읽기), Realtime(core.jobs)
        ▼                                           ▼
 apps/web(Vercel) Route Handler ──서명 토큰──▶ apps/api(Railway) ◀──내부 키── Dify arch-chat(공용)
   license, updates, rule-packs, site(VWorld),        │ LLM 라우터, RAG(arch.knowledge), 그래프
   ai/*, voice/*, webhooks/toss                       │
        │ service RPC(arch.start_ai_run 등)            │ 잡 토큰
        ▼                                             │
 Supabase(core + arch, Storage) ◀── claim_jobs ── workers/arch-jobs(Railway) ──▶ fal, WeasyPrint(공용, private)
```

### 2.1 입력 경로와 모듈 (PRD 9.1절)

| 입력 경로 | 모듈 흐름 | 단계 |
|---|---|---|
| 도면 없음(기본) | features/site → `POST /api/site/lookup`(web-api site → VWorld, `arch.record_site_lookup` 일일 상한) 또는 직접 그리기 → engine.worker rules(엔벨로프) → features/modeler(직접) 또는 massing(AR-F-033) → features/plans + layout(AR-F-032) → drafting.worker(시트) | MVP |
| 대화·음성 요구 | features/program·voice → `POST /api/ai/intake`(음성은 `POST /api/voice/stt` 선행) → 그래프 `arch.intake` → 후보 JSON → 사용자 항목별 채택 → program(면적표) → 위 흐름 | MVP(P1) |
| DXF 도면 있음 | features/site → `files.pickOpen`(Rust `fs.rs`가 크기 20MB 검사, AR055) → drafting.worker io/dxf-import(대지 경계 후보, 단위 판별 실패 시 질문 AR053, 미지원 엔티티 경고 AR054) → 사용자 확정 → DesignModel.site. 평면 참조 레이어(`A-REFR`)는 Phase 2이며 판정·면적 입력이 아니다 | 대지 P1, 참조 Phase 2 |
| 스캔·사진 도면 | io 확장 후보(이미지 → 벽·실 벡터 후보 → 사용자 검수). 런타임(로컬/클라우드 잡)과 크레딧은 미정 | Phase 3 |

### 2.2 데이터 배치와 라이선스 경계

데이터 분류는 `D:/WorkSpace/platform/docs/Tauri/README.md` 4.1절 A~D를 그대로 쓴다. 로컬 정본(B)은 `projects`, `model_revisions`, `sheets`, `judgment_snapshots`, `exports`, `render_items`, `local_settings`, `license_store`, `rule_pack_cache`, `cost_catalog_cache`, `drafting_profile_cache`이고, 클라우드에는 사용자가 클라우드 기능을 실행할 때 필요한 부분만 올린다(`D:/WorkSpace/platform/docs/Tauri/README.md:91`). 동기화(C)는 MVP에 없다.

| 판정 | 위치 | 규칙 |
|---|---|---|
| 로컬 기능 권한(모델러, 시트 출력, 체험판 표시) | Rust `license.rs` | `license_store`의 서명 파일만 믿는다. SQLite의 다른 값·`local_settings`로 판정하지 않는다(`D:/WorkSpace/platform/docs/Tauri/README.md:90`, `:353`) |
| 클라우드 기능 권한(검토, 렌더, 규칙 팩, 업데이트) | 서버 `arch.org_features` | 호출마다 서버가 판정(`01_PRD.md 4.4절`). 라이선스 파일의 `features`는 화면 표시용 |
| 규칙 팩 사용 자격 | Rust + 서버 | 서버는 `arch.eligible_rule_packs()`로 목록·서명 URL을 준다. Rust는 팩 매니페스트 서명과 `published_at <= updates_until`을 확인한 팩만 엔진에 넘긴다 |
| 빌드 자격 | 서버 `arch.eligible_build` + Rust | 업데이터는 `build_date <= updates_until` 빌드만 받는다. 자격 밖 빌드를 직접 설치하면 실행 시 라이선스 화면으로 안내(`01_PRD.md 4.4절`) |

라이선스 파일(`D:/WorkSpace/platform/docs/Tauri/README.md:193` 필드 + PRD 9.4절 `features`, `01_PRD.md 9.4절`). PRD 4.4절 필드 목록(`01_PRD.md 4.4절`)과 같은 필드이고, 직렬화·서명 형식은 04장 2.4절이 정본이다.

```ts
// packages/shell-bridge (계약 예시) — Rust license.rs가 검증한 결과만 화면에 전달
interface LicenseFilePayload {
  v: 1; license_id: string | null    // 체험·월 구독(source 'plan')은 null
  org_id: string; app_id: 'arch'; sku: string; source: 'license' | 'plan'   // sku: perpetual_* 또는 플랜 코드(trial, sub_monthly)
  updates_until: string | null       // 'YYYY-MM-DD'
  activation_id: string; device_hash: string
  features: { drafting_watermark: boolean; rule_pack_updates: boolean; cloud_review: boolean; ai_render: boolean }   // 표시용, 클라우드 판정은 서버
  offline_valid_until: string | null // 제안: 체험·월 구독은 발급 시각 + 7일. 영구는 null(구독 등과 합성 시 clamp). 영구 편집 권리의 오프라인 한도는 `rights_expiry`(발급 + 30일, D-H5 ②가 D-7(a) 대체, 변경 2026-10-29)
  issued_at: string; kid: string
}
// 파일 = { payload: base64url(JSON), sig: base64url(Ed25519(payload)) }
```

`offline_valid_until`은 이 문서가 더한 필드다(제안). 이유: PRD는 영구 라이선스의 오프라인 무기한(D-7, 2026-10-29 D-H5 ②로 30일 재확인으로 대체)만 정하고 체험·월 구독의 오프라인 허용 기간을 정하지 않았으며, Tauri 가이드는 이를 제품 PRD가 정하게 한다(`D:/WorkSpace/platform/docs/Tauri/README.md:199`). 제안값은 발급 후 7일(이유: 상담 출장 1주를 버티되 해지 후 장기 사용을 막는다). 체험·월 구독의 기기 활성화는 `arch.activate_plan_device(p_org, p_user, p_device_hash)`(service_role, 한도 `org_features.max_activations` = 1)가 `arch.license_activations`에 `license_id` null, `source='plan'`, `org_id` 행을 만들고 같은 형식의 파일을 받는다(04장 2.1절, 05장).

### 2.3 도면 엔진(packages/drafting) 설계

원칙은 PRD 9.1절(모델이 정본, 결정적 출력, LLM은 선을 그리지 않음, 고정 고지, 오프라인, `01_PRD.md 9.1절`)이다. 엔진은 TS 순수 함수 패키지 하나이고 화면 미리보기·내보내기·제안서가 같은 결과를 쓴다(`01_PRD.md 9.3절`). `Date`, `Math.random`, 네트워크, 환경변수 접근은 린트로 금지한다.

```ts
// packages/drafting (계약 예시)
type Mm = number          // 정수 mm(모델 좌표)
type PaperUm = number     // 정수 0.01mm(용지 좌표). 04장 4.7.4절과 같은 정밀도 단위(아래 설명)
interface DraftingInput {
  model: DesignModel; judgment: JudgmentResult; sheet: SheetSpec
  profile: DraftingProfile; license: { drafting_watermark: boolean; fallback_revisions?: number }
  engine_version: string
}
interface SheetModel {
  sheet_id: string; kind: SheetSpec['kind']; engine_version: string; input_hash: string  // 입력 정규화 JSON의 sha256
  paper: { size: 'A3' | 'A2' | 'A1'; orientation: 'landscape' | 'portrait'; w: PaperUm; h: PaperUm }
  scale: 100 | 200 | 300 | 500 | 600
  views: Array<{ view_id: string; origin: [PaperUm, PaperUm]; prims: Prim<Mm>[] }>  // 모델 좌표 + 배치(회전 없음)
  paper_prims: Prim<PaperUm>[]       // 표제란, 도곽, 방위표, 축척 막대, 면적표
  annotations: Annotation[]          // 치수·라벨·경고. anno_id로 덮어쓰기 대상
  blocks: BlockDef[]                 // 문·창 심볼
  warnings: Array<{ code: 'AR057' | 'AR058'; detail: string }>; title_block: TitleBlockValues; checks: SheetChecks   // 두 타입은 04장 4.7.4절
}
type Prim<U> = { layer: StdLayer; key: string } & (
  | { t: 'line'; a: [U, U]; b: [U, U] } | { t: 'pline'; pts: [U, U][]; closed: boolean }
  | { t: 'arc'; c: [U, U]; r: U; a0: number; a1: number } | { t: 'circle'; c: [U, U]; r: U }
  | { t: 'text'; at: [U, U]; h: PaperUm; s: string; align: 'l' | 'c' | 'r'; source_ref?: string } | { t: 'mtext'; at: [U, U]; h: PaperUm; width: PaperUm; s: string }
  | { t: 'hatch'; loops: [U, U][][]; pattern: 'SOLID' | 'ANSI31' } | { t: 'insert'; block: string; at: [U, U]; rot_deg: 0 | 90 | 180 | 270 })
interface Annotation { anno_id: string; kind: 'dim' | 'label' | 'warning' | 'note'; prims: Prim<Mm | PaperUm>[]; overridable: Array<'offset' | 'hide'> }
```

정밀도 설명: 1/600 시트에서 용지 1mm는 실제 600mm라 "용지 mm 정수"만으로는 PRD의 mm 정수 좌표(`01_PRD.md 9.5절`)를 지킬 수 없다. 그래서 뷰 안 형상은 모델 mm 정수와 뷰 배치(용지 원점, 축척)로 두고, 용지에 고정된 요소만 0.01mm 정수로 둔다. 작성기가 출력 직전에 한 번만 변환한다.

파이프라인:

| 단계 | 함수(모듈) | 입력 → 출력 | 비고 |
|---|---|---|---|
| 1 검증 | `sheet/validate` | DraftingInput → 오류 또는 정규화 입력 | zod 실패, 층 없음, 판정 미완료 → AR050. 엔진 버전과 시트 저장 버전이 다르면 AR059 안내 후 재생성 |
| 2 뷰 생성 | `views/<kind>` | 정규화 입력 → ViewModel(모델 mm) | 아래 표 |
| 3 축척·배치 | `sheet/fit` | ViewModel 범위 + 용지 → scale, origin | 아래 알고리즘 |
| 4 주석 | `annotate` | ViewModel + JudgmentResult → Annotation[] | 치수·라벨·경고, 덮어쓰기 적용 |
| 5 표제란 | `titleblock` | profile + sheet + 라이선스 표시 → paper_prims | 고정 고지 |
| 6 조립 | `sheet/assemble` | → SheetModel | 정렬·키 부여(결정성 규칙) |
| 7 출력 | `writers/{dxf,svg,pdf,png}` | SheetModel(+ `layer_map`) → 바이트 | DXF·SVG는 drafting.worker, PDF·PNG는 2.4절 |

뷰 생성기(입력 데이터는 모두 DesignModel 또는 JudgmentResult에서 오고, 생성기가 법규 값을 다시 계산하지 않는다):

| 시트 종류 | 생성기가 그리는 것 | 데이터 출처 | 단계 |
|---|---|---|---|
| `site_plan` | 대지 경계·지번, 도로와 폭, 건축선·이격선, 일조사선 1층 한계선, 매스 최외곽(층 외곽 합집합 투영), 최단 이격 치수, 간이 주차구획, 건폐율·용적률 요약표 | 이격 치수는 rules가 판정에 쓴 최단거리 점 쌍(`JudgmentResult`의 근거 점) 그대로. 주차 대수는 rules 값, 구획 배치는 결정적 배치(도로 접한 가장 긴 여유 띠부터 일반 2.5x5.0m·장애인 3.3x5.0m, 제안). 자리가 모자라면 대수는 그대로 두고 "배치 공간 부족" 경고 | MVP(AR-F-029) |
| `area_plan` | 층별 바닥면적 구획(매스 외곽 = 외벽 중심선 가정), 해치, 건축면적·연면적·용적률 산정 연면적, 층별·용도별 면적표, 표 아래 규칙 팩 버전과 산정 기준 | 면적표 행은 JudgmentResult 면적 항목을 그대로 표로 옮긴다 | MVP(AR-F-030) |
| `sunlight_section` | 정북 방향 단면(기본: 매스 무게중심 통과, `SheetSpec.section_line`이 있으면 그것), 엔벨로프 사선, 매스 단면, 층고·최고 높이 치수, 적용 기준 라벨(신·구), 초과 구간 표시 | 사선 함수와 초과 구간은 rules 결과, 단면 교차는 geometry | MVP(AR-F-031) |
| `floor_plan` | 실 다각형, 벽(외벽 200·내벽 100mm 오프셋, 제안), 문·창 블록(INSERT), 실명·면적 라벨 | `floor_layouts`(layout 검사 통과분만, AR051이면 시트 생성 거부), 실 면적은 geometry 면적 함수 | MVP(P1, AR-F-032) |
| `elevation` | 4면 입면 외곽, 층선, 지붕, 단순 창, 높이 치수 | 매스·층 | Phase 2(AR-F-036) |

축척 자동 선택(`scale: 'auto'`, AR-F-028):

| 순서 | 처리 |
|---|---|
| 1 | 사용 가능 영역 = 용지 − 여백(제안: 철하는 쪽 25mm, 나머지 10mm) − 표제란(제안: 하단 띠 높이 40mm) − 시트 종류별 예약 영역(면적표·요약표 폭) |
| 2 | 뷰 범위 = ViewModel 경계 상자(모델 mm) + 주석 띠(제안: 사방 용지 15mm, 치수 2단 기준) |
| 3 | 후보 `[100, 200, 300, 500, 600]`을 분모 오름차순(큰 축척 먼저)으로 보며 `범위 / 분모 + 주석 띠 <= 사용 가능 영역`(가로·세로 모두)인 첫 값을 고른다 |
| 4 | 맞는 값이 없으면 AR058과 함께 "용지를 A2·A1로 바꾸거나 방향을 바꾸세요"를 돌려준다. 사용자가 고정한 축척이 맞지 않을 때도 AR058(조용히 바꾸지 않는다) |
| 5 | 뷰 원점은 사용 가능 영역 중앙 정렬, 0.01mm 정수로 내림. 뷰는 회전하지 않고 방위표가 `north_angle_deg`를 표시한다(모델 좌표를 CAD에서 그대로 이어 쓰게 하려는 선택) |

주석과 치수: 주석은 모두 엔진이 만들고 의미 키에서 나온 안정적인 `anno_id`(예: `dim:setback:edge3:mass-<id>`)를 갖는다. `SheetSpec.annotation_overrides[]`는 `anno_id`별 위치 이동(`offset`)·숨김(`hide`)과 자유 메모(`note`, `A-ANNO-TEXT`)만 허용하고, 치수·면적 문자 값은 바꿀 수 없다(PRD 9.1절 "주석만 고친다"). 모델이 바뀌어 없어진 `anno_id`의 덮어쓰기는 버리고 화면에 "적용되지 않은 주석 수정 n건"으로 알린다. 치수는 분해형이다: 치수선·보조선·45도 눈금은 LINE, 값은 TEXT(정수 mm, 천 단위 쉼표 없음, 제안), 레이어 `A-ANNO-DIMS`(`01_PRD.md 9.3절`). 수치를 가진 TEXT는 `source_ref`(JudgmentResult 경로 또는 geometry 측정 키)를 반드시 가진다.

표제란: 사무소명, 프로젝트명, 도면명, 축척, 작성일, 규칙 팩 버전, 고지 "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다"(`01_PRD.md 9.1절`). 고지 문자열은 `titleblock` 상수이고 DraftingProfile·덮어쓰기 대상이 아니다. 네 작성기는 출력 직전에 고지 엔티티 존재를 다시 확인하고 없으면 예외를 낸다(지우는 경로 0, AR-F-028 수용 기준). 같은 방식으로 `drafting_watermark=true`면 "체험판"(D-21 (a)), 폴백 상태면 규칙 팩 버전 옆 "이후 개정 n건"을 넣는다(`01_PRD.md 9.4절`). 건축사 날인·서명란은 만들지 않는다(`01_PRD.md 9.7절`). 작성일은 엔진이 시각을 읽지 않으므로 호출자가 입력(`SheetSpec` 저장 시각의 날짜)으로 넘긴다.

레이어: SheetModel은 PRD 9.6절 표준 이름(`A-SITE-BNDY` ~ `A-REFR`, 색·선 종류 포함)만 쓴다. `DraftingProfile.layer_map`은 DXF 작성기에서만 적용한다(SVG는 표준 이름을 `<g id>`로). 매핑 이름이 DXF 레이어 이름 규칙(금지 문자 `<>/\":;?*|=,`)을 어기면 표준 이름으로 두고 경고한다. 두 표준 레이어를 한 이름으로 합치는 매핑은 허용하고 색·선 종류는 표 순서상 앞 레이어를 따른다(제안).

DXF 작성기(D-20 (a), AR-F-038):

| 항목 | 규칙 |
|---|---|
| 형식 | ASCII, `$ACADVER = AC1027`(AutoCAD 2013, PRD 제안), UTF-8, 줄 끝 `\r\n` 고정, `$INSUNITS = 4`(mm) |
| 구조 | HEADER, CLASSES(빈), TABLES(VPORT, LTYPE: CONTINUOUS·DASHED·DASHDOT, LAYER, STYLE, VIEW, UCS, APPID, DIMSTYLE 최소, BLOCK_RECORD), BLOCKS(`*Model_Space`, `*Paper_Space`, 문·창 블록), ENTITIES, OBJECTS(루트 사전 최소). AC1027에 필요한 최소 구조는 PRD 9.10절 2일 스파이크에서 ezdxf audit과 AutoCAD·LibreCAD로 확정(`01_PRD.md 9.10절`) |
| 엔티티 | LINE, LWPOLYLINE, ARC, CIRCLE, TEXT, MTEXT, HATCH, INSERT/BLOCK만. DIMENSION, VIEWPORT, 레이아웃 탭은 쓰지 않는다 |
| 좌표 배치 | 모델 공간 1:1(실제 mm)에 뷰 형상을 그대로 쓰고, 용지 요소(도곽·표제란·표)는 축척 분모를 곱해 모델 공간에 놓는다(국내 실무의 "축척 배율 도곽" 방식, 제안). 사용자가 자기 CAD에서 실제 치수로 이어 작업하게 하려는 선택 |
| 문자 | STYLE 1개(`ARCH-KR`, 제안)가 `DraftingProfile.font_family`에 대응하는 TTF 파일 이름만 참조하고 글꼴 파일을 넣지 않는다(`01_PRD.md 9.7절`). 한 줄은 TEXT, 여러 줄 메모만 MTEXT. MTEXT 서식 코드는 쓰지 않고 `\`, `{`, `}`를 이스케이프, 제어 문자 제거 |
| 크기 | 시트 1장 20MB 초과 시 AR052 대신 쓰기 전 차단 경고(해치 단순화 안내) |

결정성 규칙(같은 입력, 같은 엔진 버전 → 같은 바이트, `01_PRD.md 9.1절`):

| 규칙 | 내용 |
|---|---|
| 좌표 | 모델 mm 정수, 용지 0.01mm 정수. 실수 연산은 geometry 안에서 끝내고 결과를 정수로 반올림(반올림 규칙 고정: half-away-from-zero) |
| 숫자 출력 | 지수 표기 금지, 소수 최대 3자리, 끝 0 제거, `-0`은 `0` |
| 순서 | 레이어 표 순서 → 뷰 순서 → 엔티티 종류 → `key` 사전순. Map·Set 순회 순서에 의존하지 않는다 |
| 핸들 | TABLES → BLOCKS → ENTITIES → OBJECTS 순회 순서로 고정 시작값부터 16진 순차 할당, `$HANDSEED`는 다음 값 |
| 시각 | `$TDCREATE`, `$TDUPDATE`만 생성 시각을 쓴다(골든 비교에서 이 두 행을 가린다). SVG·PDF 메타데이터의 생성 시각은 고정값 또는 비움(PDF 라이브러리 지원 여부 미확인, 안 되면 비교에서 가림) |
| 기록 | 로컬 `exports`에 형식, `engine_version`, `input_hash`, 경로 해시 저장 |

한글 처리: 앱 화면·SVG·PDF는 앱에 넣은 재배포 가능 한글 글꼴(SIL OFL 등)만 쓴다. 표·라벨 배치에 필요한 글자 폭은 빌드 시 그 글꼴 파일에서 뽑은 고정 폭 표(한글 음절, 영숫자)로 계산해 WebView 글꼴 렌더러에 의존하지 않는다(결정성). 글꼴 파일을 못 찾으면 대체 글꼴로 출력하고 AR057. AutoCAD의 한글 TTF 스타일 표시는 미확인이라 내보내기 대화상자에 "CAD에 같은 글꼴이 없으면 대체 글꼴로 보입니다"를 표시한다.

골든 테스트와 CI:

| 항목 | 규칙 |
|---|---|
| 배치 | `packages/drafting/golden/<case-id>/{input.json, judgment.json, sheet-<kind>.dxf, sheet-<kind>.svg, sheets.pdf, meta.json}`. `input.json` = DesignModel + SheetSpec + DraftingProfile + 규칙 팩 버전, `meta.json` = 엔진 버전, 대상 기능 ID |
| 범위 | 20건 이상(AR-F-028): 샘플 대지 3종 x 시트 종류, 일조사선 신·구 경계 신청일 쌍(AR-F-031), 한글 긴 실명, 1/600 큰 대지, AR058 실패 케이스, 체험판·폴백 표제란 |
| 비교 | DXF는 시각 두 행을 가린 바이트 비교, SVG는 바이트 비교, PDF는 가린 바이트 또는 텍스트·벡터 추출 비교 |
| CI | `golden.yml`: 생성 → Python ezdxf `audit`(버전 고정) 오류 0 → 바이트 비교. 실패하면 머지 불가. 골든 갱신은 엔진 버전 올림과 같은 PR에서만(옛 시트는 AR059 안내) |
| 수치 일치 | 속성 테스트: 무작위 유효 DesignModel → `rules.evaluate` → `drafting.build` → `source_ref`가 있는 모든 TEXT를 JudgmentResult의 같은 경로 값의 표시 형식과 비교(이격 1mm, 주차 1대, 면적 소수 둘째 자리, `01_PRD.md 9.3절`). 불일치 0(`01_PRD.md 9.8절`) |
| 랜딩 샘플 | 골든 케이스 3건의 DXF·PDF를 CI가 `apps/web/public/samples/`(제안 경로)로 복사 |

성능 예산(PRD 9.5절, `01_PRD.md 9.5절`, 기준 기기는 권장 사양):

| 작업 | 예산 | 내부 배분(제안) |
|---|---|---|
| 시트 1장 생성(매스 50, 실 200) | p95 1초 | 뷰 생성 500ms, 축척·배치 50ms, 주석 250ms, 조립 100ms, 여유 100ms |
| 평면 편집 반영 | p95 100ms | layout 검사·면적만(시트 재생성 안 함) |
| 매스 자동 제안 | p95 3초 | 격자 탐색 + 후보당 판정 |
| DXF 쓰기 | 시트 1장 p95 2초, 20MB 이하 | - |
| PDF 묶음 | 10장 p95 10초 | 시트별 SVG 재사용 |

벤치마크는 CI에서 회귀만 기록하고(절대값은 실기 측정), 예산 초과가 2회 연속이면 06장 성능 작업으로 넘긴다(제안).

### 2.4 엔진 워커 메시지 프로토콜

판정 갱신 p95 200ms(`01_PRD.md 5절`)를 지키려고 워커를 둘로 나눈다. `engine.worker`는 빠른 판정·엔벨로프·매스 제안만, `drafting.worker`는 시트·작성기·가져오기를 맡아 무거운 시트 작업이 판정을 막지 않게 한다. PDF·PNG는 WebView 캔버스·DOM이 필요할 수 있어(jsPDF·svg2pdf.js의 워커 동작 미확인, D-23 스파이크) 메인 스레드 유휴 시간에 시트 단위로 나눠 실행하는 대안을 둔다.

```ts
// apps/desktop/src/workers (계약 예시)
type Lane = 'judge' | 'suggest' | 'layout' | 'sheet' | 'export' | 'import'   // engine.worker: judge·suggest·layout, drafting.worker: sheet·export·import
type EngineRequest =
  | { op: 'load_rule_pack'; req_id: string; version: string; sha256: string; pack: unknown }
  | { op: 'judge'; req_id: string; lane: 'judge'; seq: number; model_rev: string; model: DesignModel }
  | { op: 'suggest_mass'; req_id: string; lane: 'suggest'; seq: number; model: DesignModel; targets: unknown }
  | { op: 'build_sheet'; req_id: string; lane: 'sheet'; seq: number; input: DraftingInput }
  | { op: 'write'; req_id: string; lane: 'export'; format: 'dxf' | 'svg' | 'pdf' | 'png'; sheets: SheetModel[]; layer_map: Record<string, string>; bundle: boolean; project_name: string; date: string }  // 결과 형식은 04장 4.7.5절
  | { op: 'import_dxf'; req_id: string; lane: 'import'; bytes: ArrayBuffer; unit_hint?: 'mm' | 'm'; purpose: 'site_boundary' | 'reference' } | { op: 'validate_layout'; req_id: string; lane: 'layout'; seq: number; model: DesignModel; floor_id: string }
  | { op: 'cancel'; req_id: string }
type EngineResponse =
  | { req_id: string; seq?: number; ok: true; op: string; result: unknown; engine_version: string; elapsed_ms: number }
  | { req_id: string; seq?: number; ok: false; code: LocalErrorCode; detail: string }   // AR050~AR059(04장 7.3절)
  | { req_id: string; status: 'superseded' | 'canceled' }
  | { req_id: string; status: 'progress'; pct: number }
```

| 규칙 | 내용 |
|---|---|
| 최신만 유효 | `judge`·`suggest`·`layout`·`sheet` 레인은 레인마다 `seq`를 올려 보낸다. 워커는 대기열에 같은 레인의 새 요청이 오면 이전 요청을 실행하지 않고 `superseded`로 답한다. UI는 받은 응답의 `seq`가 레인 최신값보다 작으면 버린다 |
| 실행 중 취소 | JS 순수 함수는 중간에 멈출 수 없으므로 시트 생성·매스 탐색은 단계(뷰, 주석, 후보)마다 취소 플래그를 확인하고 이벤트 루프에 양보한다 |
| 내보내기 | `export` 레인은 최신만 유효 규칙을 쓰지 않는다(사용자가 시작한 출력은 끝까지). 결과 바이트는 Transferable `ArrayBuffer`로 넘기고 shell-bridge Exporter → Rust `export.rs`가 사용자가 고른 경로에 쓴다(실패 AR052) |
| 규칙 팩 | Rust가 서명·자격을 확인한 팩만 `load_rule_pack`으로 넘긴다. 워커는 `sha256`이 같으면 다시 파싱하지 않는다 |
| 장애 | 워커 오류·종료 시 재생성하고 레인별 마지막 요청만 다시 보낸다. 실패를 성공처럼 표시하지 않는다 |
| 로그 | 메시지 본문(좌표, 표제란 정보)을 로그에 남기지 않는다. `op`, `elapsed_ms`, 오류 코드만(`01_PRD.md 9.5절`) |

## 3. 공용 모듈 사용

재정의하지 않고 인용만 한다(`docs/file/03-설계/공용코어/SHARED_MODULES.md` 1장 `:32-56`, 18~19장). 데스크톱에는 코어 서버 패키지를 넣지 않는다(`createAdminClient` 금지, `SHARED_MODULES.md:71`).

| 공용 모듈 | 용도 | 호출 위치 | 비고 |
|---|---|---|---|
| auth | 가입(`signup_app='arch'`), 세션, `requireSession('arch')`, 단계 분기 | `apps/web/src/lib/auth/`, 모든 Route Handler, 데스크톱 `shell-bridge/src/auth` → `POST /api/auth/finish` | Bearer 검증은 코어 요청 T-C1, finishLogin 경로는 T-C8(`D:/WorkSpace/platform/docs/Tauri/README.md:372`, `:378`). PRD 코어 요청 C-6이 T-C1·T-C2·T-C6·T-C8을 묶는다 |
| org | 개인 조직(첫 로그인), 라이선스·크레딧의 소유 단위 | 세션 컨텍스트, `arch.deactivate_activation`(owner/admin) | `SHARED_MODULES.md:86` |
| credits | 선차감·환불. 차감은 `arch.start_ai_run` 안에서만, 실패 환불은 `fail_job` → `arch.fail_ai_run` | web-api ai·voice, 워커 | 데스크톱은 금액을 보내지 않는다(`D:/WorkSpace/platform/docs/Tauri/README.md:173`) |
| toss | 라이선스 SKU·플랜·크레딧팩 주문, confirm | `apps/web/src/server/billing`, 시스템 브라우저 결제(`D:/WorkSpace/platform/docs/Tauri/README.md:182`) | 영구 라이선스는 C-1 후 |
| webhooks | Toss 수신(원시 본문 서명, `core.webhook_events` 멱등) → `arch.issue_license`, `arch.extend_updates` | `POST /api/webhooks/toss` | `SHARED_MODULES.md:165` |
| storage | 렌더 결과(`org-files`, fal URL 복사), 제안서 PDF(`exports`), 사용자 업로드(클라우드 사본·렌더 입력·제안서 시트 SVG·로고, 제품 비공개 버킷 `arch-user`), 상담 녹음(코어 `voice-audio`), 빌드·규칙 팩·단가표(제품 비공개 버킷 `arch-releases`) | web-api 서명 URL(`POST /api/uploads/sign`), Rust 스트리밍 업로드(`D:/WorkSpace/platform/docs/Tauri/README.md:175`) | 경로 `<org_id>/arch/<purpose>/<uuid>.<ext>`(서버 생성, `SHARED_MODULES.md:378`) |
| audit | 활성화·해제, 라이선스 발급·정지, 표제란 설정 변경, 국외 이전 동의, 녹음 고지 확인 | RPC 내부, 서버 경로 | `SHARED_MODULES.md:401` |
| jobs | 클라우드 AI 작업 상태 정본, Realtime 진행률 | 워커, 데스크톱 Realtime 구독 | 큐 = job_type(4절), `SHARED_MODULES.md:417` |
| compliance | 그래프 마지막 노드의 규칙 사전 + 제품 규칙(`apps/api/app/ai/compliance/arch.py`). 법정 표기·동의·라벨은 V2 공용모듈 `@nomad/compliance`(`profileKind: kr_ecommerce`) | ai-service, web 가입·구매 약관 | `SHARED_MODULES.md:355`, `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md:28-36`(AR-V2-01·02, `:57-58`) |
| fal client | AI 렌더·업스케일, `enable_safety_checker=true` | 워커 `arch.render` | `SHARED_MODULES.md:241`. 웹훅 서명 방식 미확인(`:262`) |
| weasyprint render | 제안서 PDF(`arch.proposal_pdf`). 도면 PDF는 쓰지 않는다(D-23 (a)) | 워커 → 공용 렌더(private) | `SHARED_MODULES.md:264`. 소비자 `app_id`에 `arch` 추가는 소유자(flora-publishing) 요청(PRD 코어 요청 C-5) |
| ai-gateway | 대화 매핑, 서명·잡 토큰, 턴 선차감·정산, Dify 중계 | `apps/web/src/server/ai`, `/api/ai/*`, `/api/internal/ai-token` | `SHARED_MODULES.md:502` |
| ai-service | 라우터, RAG(`arch.knowledge`), 위키, 그래프 3종, `/tools/answer` | `apps/api` | `SHARED_MODULES.md:503` |
| dify | `arch-chat`(법규 질의, 출처 필수) | `POST /api/ai/chat` | `SHARED_MODULES.md:504`. Dify 로그 30일 |
| core-voice | 대화형 입력 음성 STT, 상담 녹음 STT(오픈소스 강제, 원본 24시간 삭제) | `POST /api/voice/stt`, 워커 `arch.stt` | `SHARED_MODULES.md:505`, `docs/file/03-설계/공용코어/VOICE_ARCHITECTURE.md:85-95` |
| llm-wiki | 법규 해설 위키(조례 차이, 질의회신 요약, 출처·확인일) | `apps/api`(ingest, lint), features/wiki | `SHARED_MODULES.md:506`, `docs/file/03-설계/공용코어/LLM_WIKI.md:37` |
| 쓰지 않음 | oauth(외부 계정 연동 없음), sns uploader, affiliate, automation-core, llm gateway TS 본체 | - | V2 보류: media, search(`arch-studio_develop_v2.md:38-43`) |

## 4. 잡과 워커

원칙: 클라우드 AI 요청 1건 = 제품 실행 행(`arch.renders`·`arch.reviews`·`arch.intake_runs`·`arch.proposals`) 1행 + `core.jobs` 1행. Route Handler가 입력 검사(크기 AR031, 기능 `arch.org_features`, 폴백 상태 검토 AR012, 렌더 동시 3건 AR030) 후 `arch.start_ai_run(p_org, p_actor, p_kind, p_variant, p_request_id, p_project_ref, p_options)`이 variant 단가(서버 상수 `apps/web/src/server/ai/pricing.ts`, seed와 같은 값)로 선차감과 enqueue를 한 트랜잭션으로 한다. 이 함수는 차감 전에 일일 플랫폼 크레딧 상한(`arch.runtime_config.daily_credit_cap`, 베타 비용 서킷 브레이커, 0이면 끔)을 넘으면 `AR034`로 거부하고(Route Handler는 `AI_DAILY_LIMIT` 429, 차감 없음), `layout`·`walkthrough`(Phase 2)는 실행 테이블이 생길 때까지 22023으로 거부한다. 워커가 결과를 Storage에 올린 뒤 `arch.finish_ai_run`, 실패는 `core.fail_job`(재시도 또는 최종 실패 환불) 다음 `arch.fail_ai_run`. 큐 이름은 job_type과 같고 소비자는 `workers/arch-jobs` 하나다(큐마다 소비자 하나). 그래프 잡은 워커가 잡 토큰으로 FastAPI `POST /graphs/<name>/runs`를 부른다. 페이로드 스키마는 04장 4절이고 payload에는 id만 둔다(좌표·문장·비밀 금지).

| `job_type` | 큐 | 런타임 | 크레딧 선차감 | 재시도 | 환불 조건 |
|---|---|---|---|---|---|
| `arch.render` | `arch.render` | TS 워커 → fal(입력: 뷰포트 깊이·윤곽 이미지 + 프리셋, 원본 모델 미전송) | 표준 3 / 고품질 5 / 업스케일 2 | 1회(제출 오류·네트워크). 안전 필터 거부는 재시도 없음 | 3분 초과, 실패, 결과 미전달 시 전액(`01_PRD.md 3절`) |
| `arch.review` | `arch.review` | TS 워커 → FastAPI 그래프 `arch.review`(잡 토큰) | 15 | 1회(제공자 오류·타임아웃, 같은 thread로 재개) | 10분 초과, AR033(출처 없는 결과), 최종 실패 시 전액 |
| `arch.intake` | `arch.intake` | TS 워커 → FastAPI 그래프 `arch.intake` | `source='chat'`(텍스트·음성 대화, AR-F-034) `intake_text` 2, `source='consult'`(상담 녹음 전사본, AR-F-015) `intake_consult` 5(PRD 4.5절). STT는 `arch.stt` 분당 1 별도 | 그래프 안 스키마 재시도 1회, 잡 재시도 1회(제공자 오류만) | AR032, 최종 실패 시 전액 |
| `arch.proposal_pdf` | `arch.proposal_pdf` | TS 워커: FastAPI 서술 생성(잡 토큰, `arch.proposal_narrative`) → 서버 HTML 조립(판정·면적·공사비는 엔진 스냅샷 값, 도면은 `POST /api/uploads/sign` purpose `proposal_sheet`로 올라와 sanitize된 SVG 인라인) → 공용 WeasyPrint → `arch.proposals` | `proposal` 10(서술 포함), `doc_template` 1(같은 버전 재요청 0). 렌더 이미지는 별도 | 1회(네트워크·타임아웃·429) | 실패·120초 렌더 타임아웃 시 전액 |
| `arch.stt` | `arch.stt` | TS 워커 → core-voice(상담 녹음은 `oss-voice`만). 짧은 받아쓰기는 `/api/voice/stt` 동기 | 분당 1, 실제 길이로 정산 | 상담 녹음은 대체 없이 1회 | 실패 시 전액. 원본 24시간 후 삭제 |
| `arch.layout`(Phase 2) | `arch.layout` | TS 워커 → FastAPI 그래프 `arch.layout`(의도 JSON만), 배치는 데스크톱 `packages/layout` 솔버 | 5 | 1회 | 의도 JSON 검증 실패, 최종 실패 시 전액 |
| `arch.walkthrough`(Phase 2) | `arch.walkthrough` | TS 워커 | 40 | 미정 | 최종 실패 시 전액 |

도면 생성, DXF·SVG·PDF·PNG 시트 출력, 매스 자동 제안, 판정, 엔벨로프는 잡이 아니다. 데스크톱 로컬 Web Worker에서 0크레딧으로 실행하고 서버를 거치지 않는다(`01_PRD.md 9.4절`). 제안서에 넣는 시트도 로컬에서 만든 SVG를 `POST /api/uploads/sign`(purpose `proposal_sheet`)로 올릴 뿐이고 HTML 조립은 워커(서버)가 한다(`01_PRD.md 9.3절`, `SHARED_MODULES.md:270`).

`arch.start_ai_run`의 `p_kind`(render, review, intake, proposal, layout, walkthrough)와 `p_variant` → 크레딧(render_std 3, render_hq 5, upscale 2, review 15, intake_text 2, intake_consult 5, proposal 10, doc_template 1(같은 버전 재요청 0), layout 5, walkthrough 40)에 STT가 없으므로 `arch.stt` 차감은 core-voice의 `voice:<request_id>` 멱등 키 경로를 쓴다(`AI_ARCHITECTURE.md` 7장). 클라우드 검토는 데스크톱이 보낸 JudgmentResult를 믿지 않는다: Route Handler가 업로드된 DesignModel로 같은 `packages/rules`(서버 번들)를 같은 규칙 팩 버전으로 다시 돌린 결과만 그래프 입력으로 저장한다(결정적 값은 서버 계산, 6절 위험 #1).

| 스케줄(잡 아님, 워커 크론) | 주기(제안) |
|---|---|
| `core.reap_stale_jobs(600)` → 직후 `arch.reconcile_runs(p_org)`(잡만 실패·취소된 실행 행을 failed로, 활성 실행이 있는 조직마다) | 10분 |
| AI 정산(`settled_at is null`) | 5분 |
| 상담 녹음 원본 삭제(`expire_voice_audio`) | 1시간 |
| `arch.purge_expired()`(렌더 결과 90일 만료 표시 → 반환된 Storage 경로 삭제, `site_lookups` 90일, 만료 `intake_runs`) | 매일 |
| `core.run_monthly_credit_grants()`, `core.expire_stale_payment_orders()` | 매일 / 매 시간 |

## 5. AI 라우팅

설계 정본은 `AI_ARCHITECTURE.md` 4장(LLM, `:73-92`), `VOICE_ARCHITECTURE.md` 3장(음성, `:40-48`)이다. 이 절의 기본값은 seed `ai_routing_settings`(org null, app `arch`)와 같아야 한다(05장).

원칙 하나를 먼저 고정한다: LLM은 선을 그리지 않는다(`01_PRD.md 9.1절`). 어떤 그래프도 좌표·치수·면적·판정 값·금액을 만들지 않는다. LLM 출력은 스키마가 고정된 JSON(요구 후보, 실 인접 의도)이나 출처가 붙은 해석 문장까지이고, 숫자는 엔진 값 참조로만 문장에 들어간다.

| purpose(feature 키) | 모델(fast / quality) | 크레딧 | 폴백 |
|---|---|---|---|
| `arch.review` | 표준 / 상위(해석 문장) | 15(그래프) | 체인 다음 제공자. 국외 미동의면 oss-llm |
| `arch.intake` | 표준 / 표준(구조화 출력) | 2(`intake_text`) | 같음 |
| `arch.intake_consult`(상담 녹음 후보) | 표준 / 표준 | 5 | 없음(오픈소스 강제) |
| `arch.proposal_narrative` | 표준 / 상위 | 10에 포함 | 체인 다음 |
| `arch.chat` | Dify 앱 내부 | 1/턴 | Dify 장애 시 `/tools/answer-direct` |
| `arch.layout`(P2) | 표준 / 상위 | 5 | 체인 다음 |
| `arch.compliance` | 경량 / 경량 | 그래프에 포함 | 규칙 단계만으로 WARN(`SHARED_MODULES.md:355` 실패 규칙) |

| feature | kind | 모드 | 대체 체인 | 강제 오픈소스 | 쓰는 곳 |
|---|---|---|---|---|---|
| `arch.review` | llm | auto | anthropic → openai → google → oss-llm | 아니오 | 그래프 `arch.review`. 입력은 판정 값·법령 조각뿐(주소·건축주 정보 미전송) |
| `arch.intake` | llm | auto | anthropic → openai → oss-llm | 아니오 | 그래프 `arch.intake`, `source='chat'`(텍스트·본인 음성) |
| `arch.intake_consult` | llm | open_source | oss-llm | 예(제3자 발언) | 같은 그래프 `arch.intake`, `source='consult'`(상담 녹음 전사본 → 후보, `01_PRD.md 3절`) |
| `arch.proposal_narrative` | llm | auto | anthropic → openai → google → oss-llm | 아니오 | 제안서 서술 섹션 |
| `arch.chat` | llm | auto | anthropic → openai → google → oss-llm | 아니오 | `/tools/answer` |
| `arch.layout`(P2) | llm | auto | anthropic → openai → oss-llm | 아니오 | 그래프 `arch.layout`(층 외곽·면적표만 전송, `01_PRD.md 9.7절`) |
| `arch.compliance` | llm | auto | oss-llm → anthropic | 아니오 | 그래프 compliance 노드 LLM 보조 |
| `wiki.ingest`, `wiki.query`, `wiki.lint` | llm | auto | oss-llm → anthropic | 아니오 | 법규 해설 위키 |
| `dify.aux` | llm | open_source | oss-llm | 예 | Dify 질문 분류 노드 |
| `arch.knowledge` | embedding | open_source | oss-embed | 아니오(컬렉션 모델 고정) | 법령·지구단위계획·질의회신 컬렉션(플랫폼 공통 지식) |
| `consult_recording` | stt | open_source | oss-voice | 예(제3자 음성) | 상담 녹음 |
| `voice_chat` | stt | auto | oss-voice → elevenlabs | 아니오 | 대화형 입력 본인 음성, 채팅 음성 질문 |

국외 이전 미동의 조직은 `resolve_ai_route`가 상용 제공자를 빼므로 모든 llm 기능이 oss-llm만 쓰고 정액 작업 가격은 같다(`AI_ARCHITECTURE.md:86`, `01_PRD.md 4.9절`). TTS(채팅 답변 읽어 주기, 03장 3.12절)는 OS 음성 합성으로 0크레딧이며 서버 라우팅 기능을 두지 않는다(제안).

LangGraph 그래프(`apps/api/app/ai/graphs/arch_*.py`, compliance는 마지막 생성 노드이고 뒤에는 output만, `AI_ARCHITECTURE.md:117`):

| 그래프 | 노드 순서 | 사람 승인 | compliance |
|---|---|---|---|
| `arch.review` | `load_snapshot`(서버 재계산 JudgmentResult + `rule_context`) → `select_items`(결정적: FAIL, 여유 5% 이내(제안), "조례 미확인" 항목) → `retrieve`(RAG `arch.knowledge` + 위키, `application_date` 기준 시행 범위 필터) → `interpret`(LLM: 항목별 해석·확인 필요 사항, 숫자는 `{ref:<판정 경로>}` 자리표시자로만) → `cite_check`(결정적: 문장마다 출처 청크 id, 없는 문장 제거, 남는 문장 0이면 AR033) → `resolve_refs`(결정적: 자리표시자를 엔진 값으로 치환, 문장에 직접 쓴 숫자가 엔진 값 집합 밖이면 그 문장 1회 재작성 후 제거) → `compliance` → `output`(`arch.finish_ai_run`) | 그래프 안 interrupt 없음. 결과는 되돌릴 수 있는 참고 자료이고, 최종 판단은 사용자가 "확인 필요" 항목마다 확인 표시를 남기는 화면에서 한다(PRD 6.2절 3계층의 사람 확인) | 있음: 인허가 보장, 적법성 단정("허가 가능합니다"), 전문가 대체, 공공기관 보증, 근거 없는 수치 |
| `arch.intake` | `load`(요구 문장 또는 STT 전사본, 자료 안 지시 무시 고정) → `extract`(LLM 구조화 출력: 체크리스트 답, 실 목록과 목표 면적, 메모) → `validate`(결정적 pydantic strict, 추가 필드 금지, 좌표·면적 계산 필드 없음. 실패 시 `extract` 1회 재시도, 다시 실패면 AR032) → `normalize`(결정적: 체크리스트 키 사전 매핑, 모르는 키 제거, 용도 enum) → `compliance` → `output` | 그래프 밖: 사용자가 후보를 항목별로 채택해야 체크리스트에 반영(AR-F-034, AR-F-015) | 있음 |
| `arch.layout`(P2) | `load`(면적표, 층 외곽, 채광·현관 조건) → `intent`(LLM: 실 인접 그래프, 조닝 공용/사적/서비스, 선호 방향) → `validate`(결정적: 실 id 집합 = 입력 실 id 집합, 좌표·면적 필드 없음) → `compliance` → `output` | 그래프 밖: 데스크톱 솔버가 만든 3안 중 사용자가 하나를 골라 AR-F-032 편집기에서 고친다 | 있음 |

제안서 서술은 그래프가 아니라 FastAPI 제품 확장(`apps/api/app/ai/products/arch/`)의 단건 생성이며, 판정 요약 문장의 숫자도 같은 자리표시자 규칙을 쓴다. 채팅(`arch-chat`)은 출처를 못 찾으면 "근거를 찾지 못했습니다"로 답하고(`01_PRD.md 3절`) 개별 사안 적법성을 단정하지 않는다.

| 이미지·음성 제공자 | 용도 | 호출 위치 | 규칙 |
|---|---|---|---|
| fal(Flux 계열) | 렌더 표준 1024px, 3크레딧(라우팅 키 `arch.render`) | 워커 | 모델 id는 서버 상수, 안전 검사 켬, 결과를 Storage로 복사, 메타데이터 AI 생성 표시 |
| 고품질 이미지(Gemini 이미지 계열) | 렌더 2K, 5크레딧 | 워커 | fal 경유 제공 여부 미확인. 아니면 워커가 google 제공자를 직접 호출하고 키는 워커에만 둔다(06장에서 확정) |
| fal 업스케일 | 4K, 2크레딧 | 워커 | `render_max_px`는 서버 판정 |
| oss-voice | 상담 녹음 STT, 본인 음성 STT 1순위 | 워커, `/api/voice/stt` | 상담 녹음은 대체 금지 |
| ElevenLabs | 본인 음성 STT 대체 | web 서버 | 국외 이전 동의 조직만 |

## 6. 리뷰 "높음" 결함의 차단 설계

이 제품은 원본 리뷰가 없는 신규 제품이다(`README.md` 2장). 그래서 이식 원천 `docs/reference/reviews/FortuneDocs.md` 3장 높음 6건(#1~#6) 중 이식 대상인 "결정적 값은 엔진이 계산한다" 원칙(`docs/reference/reviews/FortuneDocs.md:47`, `README.md` 3장)과 관련된 5건(#1~#5)과 제품 고유 위험 9건을 "위험 #n → 차단 설계"로 둔다. 제외한 #6(Vercel Puppeteer PDF, `docs/reference/reviews/FortuneDocs.md:45`)은 수치 원칙과 무관하지만 이 설계에서도 재발하지 않는다(도면 PDF는 로컬 D-23, 제안서 PDF는 Railway 공용 WeasyPrint). 보안·데이터 성격의 7건(#4, #5, #6, #7, #8, #12, #13)은 05장 7절에서 테이블·RLS·RPC 수준 차단을 다시 적는다. 합계 14 = 차단 설계 14.

| 리뷰 #n | 출처 | 결함 요약 | 차단 설계 | 담당 장/작업 |
|---|---|---|---|---|
| 위험 #1(`docs/reference/reviews/FortuneDocs.md` 3장 #1) | `docs/reference/reviews/FortuneDocs.md:40` | 외부 API 값을 도메인 경계 규칙 없이 그대로 써서 경계 시점 결과가 틀린다 | 공공 API(VWorld)는 대지 형상·용도지역 입력에만 쓰고 판정에 쓰지 않는다. 시행일 경계는 규칙 팩(from·to·지자체)과 신청 예정일로 rules가 고른다(AR-F-005). 골든에 신·구 일조사선 경계 신청일 쌍, 조례 반영 전후 쌍을 넣는다. 클라우드 검토는 서버가 같은 엔진으로 재계산(4절) | rules, `packages/rules/golden/**`, 06장 5.3절의 규칙엔진 작업 |
| 위험 #2(같은 리뷰 #2) | `:41` | 계산 규칙이 없고 필수 입력이 NULL 허용이라 계산 불가 레코드가 생긴다 | DesignModel zod 스키마에서 판정 필수 필드(`north_angle_deg`, 도로 폭, 용도지역)를 필수로 두고, 빠지면 해당 판정 행을 "입력 필요"로 표시해 추정값을 쓰지 않는다. 시트는 AR050으로 거부 | domain, rules |
| 위험 #3(같은 리뷰 #3) | `:42` | 입력 모델과 저장 스키마가 어긋나 옵션이 저장되지 않는다 | DesignModel·SheetSpec 정본은 `packages/domain` 하나. 로컬 SQLite는 JSON + `schema_version`, 클라우드 사본도 같은 JSON. Python 쪽 pydantic은 동치 테스트로 묶고, 버전 이주 함수 없이 스키마를 바꾸면 CI 실패 | domain, local-migrations, 05장 |
| 위험 #4(같은 리뷰 #4) | `:43` | `FOR ALL` 정책으로 사용자가 계산 결과 행을 직접 쓴다 | `arch.reviews`·`arch.renders`·`arch.intake_runs`·`arch.proposals`는 사용자 SELECT만, 쓰기는 service RPC(`start_ai_run`, `finish_ai_run`, `fail_ai_run`)만 | 05장 7절 |
| 위험 #5(같은 리뷰 #5) | `:44` | 비원자 크레딧 차감, 실패 환불 없음 | `arch.start_ai_run` 한 트랜잭션(실행 행 + `enqueue_job` + `consume_credits`), 실패는 `fail_job` 자동 환불. 데스크톱은 금액을 보내지 않는다 | 05장 7절, 4절 |
| 위험 #6(제품: 라이선스 파일 위조) | `01_PRD.md 4.4절`, `D:/WorkSpace/platform/docs/Tauri/README.md:193-194` | 사용자가 라이선스 파일을 고치거나 다른 PC 파일을 복사해 권한을 얻는다 | Rust `license.rs`가 Ed25519 서명(앱에 넣은 `kid`별 공개키)과 `device_hash`(현재 기기에서 다시 계산)·`app_id`를 검증하고 하나라도 틀리면 미활성 상태. 개인키는 web 서버 전용. 클라우드 기능은 파일과 무관하게 서버가 매번 판정. 변조 파일 거부 테스트(T-007) | desktop-rust, web-api licenses, 05장 7절 |
| 위험 #7(제품: 로컬 SQLite로 오프라인 권한 판정) | `D:/WorkSpace/platform/docs/Tauri/README.md:42`, `:90` | 로컬 DB·localStorage 값을 고쳐 체험 만료·폴백을 우회한다 | 권한은 서명 파일만(2.2절). 체험·월 구독은 `offline_valid_until`(제안 7일)을 넘으면 열람·내보내기만. 시계 되돌림은 `license_store`에 남긴 최대 `issued_at`보다 현재 시각이 이르면 만료로 본다. 영구 라이선스는 시각과 무관(빌드 상수 `build_date`와 `updates_until` 비교) | desktop-rust, 05장 7절 |
| 위험 #8(제품: 데스크톱 번들 비밀 노출) | `D:/WorkSpace/platform/docs/Tauri/README.md:172`, `:352` | service_role, LLM·fal 키, 라이선스·업데이트 서명 개인키가 설치 파일에 들어간다 | 데스크톱 빌드 env는 `VITE_` 허용 목록 4개뿐(8절: 공개값 3개 + `VITE_AUTH_MODE`), 그 밖의 `VITE_` 변수가 있으면 빌드 실패. `desktop-release.yml`이 산출물(JS 번들, Rust 바이너리 문자열)에서 JWT `service_role` 클레임, `-----BEGIN PRIVATE KEY`, `sk-`, fal 키 형식, 시드 페르소나 이메일을 검사해 하나라도 있으면 실패 | ci, desktop-shell, 05장 7절 |
| 위험 #9(제품: 도면 수치와 판정 수치 불일치) | `01_PRD.md 9.3절`, `:472` | 도면 치수·면적표가 판정 패널 값과 달라 제안서에 틀린 숫자가 나간다 | drafting은 법규 값을 계산하지 않고 JudgmentResult와 geometry 함수만 읽는다. 수치 TEXT는 `source_ref` 필수, 덮어쓰기로 값 변경 불가. 2.3절 속성 테스트 불일치 0이 CI 조건. 제안서 HTML의 수치도 같은 스냅샷 | drafting, rules, 06장 5.3절의 도면 작업(AR-06-019~033) |
| 위험 #10(제품: LLM이 만든 좌표·수치) | `01_PRD.md 9.1절`, `:376-377` | LLM 출력 좌표·면적이 도면에 들어가 재현 불가 오류가 생긴다 | intake·layout 출력 스키마에 좌표·면적 계산 필드가 없고(strict, 추가 필드 거부) 서버 그래프와 데스크톱 양쪽에서 재검증. 목표 면적은 사용자가 채택해야 반영. review 문장 숫자는 자리표시자 치환만(5절) | ai-service, layout, program |
| 위험 #11(제품: 낡은 규칙 팩을 최신으로 오인) | `01_PRD.md 4.3절`, `:398` | 업데이트 만료·장기 오프라인 사용자가 낡은 기준 판정을 최신으로 믿는다 | 판정 행·표제란·제안서에 팩 버전과 기준일을 항상 표시. 폴백이면 "이후 개정 n건" 배너(온라인일 때 `arch.rule_pack_changes`로 갱신, 오프라인이면 "개정 확인일 <날짜>"). 마지막 확인이 30일(제안)을 넘으면 "개정 확인 필요" 배너. 팩은 서명 매니페스트로만 로드 | rules, features/judgment, drafting titleblock |
| 위험 #12(제품: 딥링크 콜백 주입) | `D:/WorkSpace/platform/docs/Tauri/README.md:128`, `:354` | 다른 앱·웹페이지가 `archstudio://` URL로 가짜 `code`를 넣거나 로그인 흐름을 가로챈다 | Rust `deeplink.rs`가 스킴·호스트·경로 허용 목록(`auth/callback`만)과 길이·문자 검사. shell-bridge는 직전에 시작한 로그인 시도(PKCE verifier 보유, 10분, 1회)에만 교환하고 그 밖은 무시. `code`는 로그·화면 기록 금지. 결제 결과 딥링크는 표시 갱신 트리거일 뿐 확정 근거가 아니다(`D:/WorkSpace/platform/docs/Tauri/README.md:182`) | desktop-rust, shell-bridge auth, 05장 7절 |
| 위험 #13(제품: DXF·3D 가져오기 경로 조작·과대 파일) | `01_PRD.md 5절`, `:420`, `D:/WorkSpace/platform/docs/Tauri/README.md:208` | 화면이 준 경로로 임의 파일을 읽거나, 과대·중첩 파일로 앱이 멈춘다 | Rust `fs.rs`는 OS 대화상자가 돌려준 경로만 연다(화면이 준 문자열 경로 거부, 정규화 후 확인). 크기 상한(DXF 20MB, IFC·.3dm 100MB) 초과는 읽기 전 AR055. 파서는 워커에서 엔티티 수 상한, 블록 중첩 깊이 상한(제안 8), 압축 해제 크기 상한(.3dm·IFC, 제안 원본의 10배)과 시간 상한으로 중단. 가져온 결과는 후보이고 판정 입력이 아니다(AR-F-037) | desktop-rust, io, 05장 7절 |
| 위험 #14(제품: Mock 로그인 배포 빌드 혼입) | `D:/WorkSpace/platform/docs/Tauri/README.md:160`, `01_PRD.md 3절` | 개발용 페르소나 로그인이 서명 배포 빌드에 남는다 | 데스크톱 Mock 패널은 `import.meta.env.DEV`와 `VITE_AUTH_MODE=mock` 둘 다일 때만 번들에 포함(배포 빌드에서 제거). 비밀번호는 번들에 넣지 않고 개발자가 입력해 키체인에 둔다. 릴리스 CI는 `VITE_AUTH_MODE=live`가 아니면 실패하고 위험 #8 검사로 페르소나 문자열을 찾는다 | auth, ci, 9절 |

## 7. 배포 토폴로지

| 구성 | 위치 | 네트워크 경계 |
|---|---|---|
| web(`apps/web`) | Vercel | 공개 HTTPS. 랜딩·계정 포털·결제·Route Handler·업데이트 매니페스트. Supabase(세션, 서버 함수만 service_role), VWorld(서버만), FastAPI(서명 토큰), Dify(앱 키) |
| apps/api | Railway(CPU 1) | 공개 HTTPS지만 서명 토큰·잡 토큰·Dify 내부 키 없으면 401. 상용 LLM, 공용 GPU(`oss-llm`, `oss-embed`, `oss-voice`), Supabase(service_role) |
| workers/arch-jobs | Railway(CPU 1, 동시 4 제안) | 인바운드 없음. Supabase(service_role), fal, `/api/internal/ai-token`(워커 키), FastAPI(잡 토큰), 공용 WeasyPrint(private, `X-Render-Token`) |
| 공용 WeasyPrint, Dify, GPU 서버 | 운영사(공용) | WeasyPrint는 private network만(`SHARED_MODULES.md:272`) |
| Supabase | 모듈러 프로젝트 1개(스키마 `core` + `arch`). 화이트라벨 단독 설치는 monolith | Storage 비공개 버킷 `arch-releases`(빌드·규칙 팩·단가표, 서명 URL만), `arch-user`(사용자 업로드), 코어 `exports`, `org-files`, `voice-audio` |
| 데스크톱 앱 | 사용자 PC | 아래 CSP와 Rust HTTP 허용 목록 밖으로 나가지 않는다 |

빌드·업데이트 파일 배포:

| 항목 | 내용 |
|---|---|
| 설치 형식 | NSIS(기본, 사용자 단위 설치·업데이터용, 제안)와 MSI(기관 일괄 배포) 둘 다 생성(`D:/WorkSpace/platform/docs/Tauri/README.md:255`). WebView2 부트스트랩 포함, 설치 파일 200MB 이하(`01_PRD.md 5절`) |
| 서명 | Windows 코드 서명 인증서(종류·비용 미확인, T-D5, `D:/WorkSpace/platform/docs/Tauri/README.md:211`, `:366`). 업데이트 파일은 Tauri 업데이트 서명키로 별도 서명(라이선스 키·코드 서명과 분리, `:197`) |
| 게시 | `desktop-release.yml`(태그 푸시): 빌드 → 코드 서명 → 업데이트 서명 → `arch-releases/builds/<channel>/<version>/`에 업로드 → `arch.builds` 행(`build_date`, channel `stable`·`beta`, 서명값) 등록. 실키는 GitHub 환경 비밀(job 레벨 `env`)에만 |
| 업데이트 | Rust updater → `GET /api/updates/{target}/{arch}/{current_version}`(Bearer 헤더, 04장 2.3절. 서버는 앱이 보낸 라이선스 파일을 쓰지 않는다). 서버가 `arch.org_features`와 `arch.eligible_build(p_org, p_platform, p_current)`를 확인해 짧은 수명(제안 10분) 서명 URL과 서명값이 든 매니페스트를 준다. 자격 없으면 204 |
| 첫 다운로드 | `/download`는 최신 stable 설치 파일 서명 URL을 서버 컴포넌트에서 만든다(설치는 누구나, 기능은 라이선스·체험으로 판정). 마지막 자격 버전은 `/account/licenses`에서 영구 제공(`01_PRD.md 4.4절`) |
| 서비스 종료 약속 | 온라인 활성화 없이 동작하는 마지막 빌드를 같은 파이프라인의 별도 채널로 만든다(`01_PRD.md 4.4절`, 제안) |

데스크톱 CSP(`D:/WorkSpace/platform/docs/Tauri/README.md:207`, 실제 지시어 동작은 T-001에서 확인):

| 지시어 | 값 |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self' 'wasm-unsafe-eval'`(Manifold·web-ifc WASM. 인라인 스크립트 금지) |
| `worker-src` | `'self'` |
| `connect-src` | `'self'`, Tauri IPC 출처(`ipc:`, `http://ipc.localhost`, 미확인: Tauri가 자동 추가하는지), `https://<web 도메인>`(Route Handler·업데이트 매니페스트), `https://<project-ref>.supabase.co`, `wss://<project-ref>.supabase.co`(Realtime). 로컬 개발만 `http://127.0.0.1:54321` |
| `img-src` | `'self' data: blob: https://<project-ref>.supabase.co`(렌더 결과 서명 URL) |
| `font-src`, `style-src` | `'self'`(번들 글꼴만. 스타일 속성 처리 필요 여부는 T-001에서 확인) |
| 원격 콘텐츠 | 메인 창에 원격 URL 로드 금지, 외부 링크는 시스템 브라우저(`D:/WorkSpace/platform/docs/Tauri/README.md:206`) |

Rust 쪽 HTTP(업데이터, 대용량 업로드)는 같은 두 도메인만 허용한다. CORS 허용 출처는 셸 출처(Windows `http://tauri.localhost`, 구현 시 확인)만, 와일드카드 금지(T-C2, `D:/WorkSpace/platform/docs/Tauri/README.md:137`).

## 8. 환경변수

모든 서버 앱은 기동 시 zod(TS)·pydantic Settings(Python)로 검증하고 "기동 실패" 변수가 없으면 시작하지 않는다. `.env`는 커밋하지 않는다.

| 변수 | 용도 | 공개 여부 | 누락 시 동작 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web 브라우저 클라이언트 | 공개 | 기동 실패 |
| `SUPABASE_SERVICE_ROLE_KEY` | web 서버, 워커, apps/api | 서버 전용 | 기동 실패 |
| `SUPABASE_DB_SCHEMA` | `core`(모듈러) / `public`(모놀리스) | 서버 전용 | 기동 실패 |
| `APP_URL` | 콜백 origin, 결제 성공·실패 URL | 서버 전용 | 기동 실패 |
| `TOSS_SECRET_KEY`, `TOSS_WEBHOOK_SECRET` / `NEXT_PUBLIC_TOSS_CLIENT_KEY` | 결제·웹훅 / 결제창 | 서버 전용 / 공개 | 기동 실패 |
| `LICENSE_SIGNING_PRIVATE_KEY` | 라이선스 파일·규칙 팩 매니페스트 Ed25519 서명 | web 서버 전용(워커·api·데스크톱 금지). `AI_TOKEN_PRIVATE_KEY`와 다른 키(`01_PRD.md 4.4절`) | 기동 실패 |
| `LICENSE_SIGNING_KID` | 현재 서명 키 id(교체는 코어 요청 C-3·T-C4) | 서버 전용 | 기동 실패 |
| `DESKTOP_CORS_ORIGINS` | 셸 출처 허용 목록(제안 이름) | 서버 전용 | 데스크톱 요청 전부 CORS 거부 + 기동 경고 |
| `VWORLD_API_KEY`, `SITE_LOOKUP_HASH_KEY` | 대지 조회 중계(D-14 확인 후 건축HUB·법령 키 추가) / 지번(PNU) HMAC-SHA-256 키(`arch.site_lookups.pnu_hash`, 05장 2.14절, 제안 이름. 단순 SHA-256은 사전 대입으로 되돌릴 수 있다) | web 서버 전용 | VWorld 키 없음: `/api/site/lookup`이 AR021, 화면은 "직접 그리기" / 해시 키 없음: 기동 실패 |
| `AI_TOKEN_PRIVATE_KEY`, `AI_TOKEN_KID` | 서명·잡 토큰 발급 | web 서버 전용 | 기동 실패 |
| `AI_TOKEN_JWKS_URL` | 토큰 검증 | apps/api, 오픈소스 음성 서버 | 기동 실패 |
| `AI_SERVICE_URL` | FastAPI 주소 | web 서버, 워커 | web: AI 기능 오류 표시, 워커: 기동 실패 |
| `ARCH_WORKER_INTERNAL_KEY` | 워커 → `/api/internal/ai-token`, AI 정산 | web 서버, 워커 | 기동 실패 |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | 상용 LLM | apps/api 전용 | 해당 제공자만 체인에서 제외 |
| `OSS_LLM_BASE_URL`, `OSS_EMBED_BASE_URL` | 오픈소스 LLM·임베딩 | apps/api 전용 | 기동 실패(`arch.knowledge`, 강제 오픈소스 경로) |
| `DIFY_API_URL`, `DIFY_APP_KEY_ARCH`, `DIFY_USER_HMAC_SECRET` | `arch-chat` 중계 | web 서버 전용 | 채팅은 `/tools/answer-direct`만 + 운영 알림 |
| `DIFY_INTERNAL_API_KEY` | Dify → apps/api(arch 전용 값) | apps/api, Dify 환경 | apps/api 기동 실패 |
| `OSS_VOICE_BASE_URL` | 오픈소스 음성 서버 | web 서버, 워커 | 기동 실패(상담 녹음은 대체 경로 없음) |
| `ELEVENLABS_API_KEY` | 본인 음성 STT 대체 | web 서버 전용 | 체인에서 제외 |
| `FAL_KEY` | 렌더·업스케일 | 워커 전용 | 기동 실패 |
| `RENDER_SERVICE_URL`, `RENDER_SERVICE_TOKEN` | 공용 WeasyPrint | 워커 전용 | 기동 실패 |
| `AI_CROSS_BORDER_NOTICE_VERSION`, `VOICE_NOTICE_VERSION`, `ARCH_RECORDING_NOTICE_VERSION` | 국외 이전·음성·상담 녹음(제3자) 고지문 버전(`01_PRD.md 6절`) | web 서버 전용 | 기동 실패 |
| `RATE_LIMIT_IP_SALT` | 활성화 API IP당 10회/시간 등 IP 해시 | 서버 전용 | 기동 실패 |
| `NEXT_PUBLIC_HERO3D_ENABLED` | 히어로 CSS/SVG 연출 킬 스위치(D-37: 이름은 유지, 의미는 연출 on/off) | 공개 | 기본 true, false면 정지 이미지. `NEXT_PUBLIC_HERO_VIDEO_ENABLED`는 영상 미채택이라 읽지 않는다 |
| `WORKER_ID`, `WORKER_CONCURRENCY` | 워커 식별·동시성 | 워커 | 기본값 |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` | 데스크톱 빌드 시점 공개값(번들에 들어감) | 공개(아래 `VITE_AUTH_MODE`와 함께 4개만 허용 목록) | 빌드 실패 |
| `VITE_AUTH_MODE` | 데스크톱 인증 단계(`mock`은 개발 빌드만) | 공개 | 기본 `live`. 릴리스 빌드에서 `mock`이면 빌드 실패(9절) |
| 라이선스 공개키(`kid` → 공개키 목록) | Rust 코어에 빌드 시 상수로 넣는다(레포 파일, 비밀 아님) | 공개 | 빌드 실패 |
| 업데이트 공개키 | `tauri.conf.json` updater 설정 | 공개 | 빌드 실패 |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 업데이트 파일 서명(Tauri 2 표준 이름, 구현 시 확인) | CI 전용(GitHub 환경 비밀) | 릴리스 작업 실패 |
| 코드 서명 인증서와 암호(이름은 06장 CI 작업에서 확정) | Windows 코드 서명 | CI 전용 | 릴리스 작업 실패 |

AI 관련 변수는 `AI_ARCHITECTURE.md` 8장 목록을 따르고 `NEXT_PUBLIC_HERO*`를 빼면 모두 서버 전용이다. 이 제품은 `OPENROUTER_API_KEY`, `VOYAGE_API_KEY`를 쓰지 않는다(기본 체인에 없음). 인증 단계 변수(`AUTH_MODE` 등)는 9.3절.

## 9. 인증 단계 (확정 결정 22)

정본은 `docs/file/03-설계/공용코어/AUTH_ROADMAP.md`이고 이 제품 행은 open 가입, B = Google + 이메일, C1·C2 P2 선택이다(`AUTH_ROADMAP.md:339`). 데스크톱 흐름은 `D:/WorkSpace/platform/docs/Tauri/README.md` 5장과 PRD D-15·D-16(`01_PRD.md 8.2절`)을 따른다. 세션은 항상 실제 Supabase JWT, 권한 판정은 `session_context('arch')` 하나다(`AUTH_ROADMAP.md` 0장 불변 조건).

### 9.1 단계표

| 단계 | 웹(`apps/web`) | 데스크톱 | 켜는 조건 | 작업 |
|---|---|---|---|---|
| A | `/login` 개발용 패널, `POST /api/dev/login`(로컬 전용, 판정 거짓이면 404) | 개발 빌드만: 로컬 시드 계정 `signInWithPassword`(5.4절 조건을 빌드 시점에 적용, `D:/WorkSpace/platform/docs/Tauri/README.md:160`) | 로컬 Supabase + `AUTH_MODE=mock` / `VITE_AUTH_MODE=mock` | 06장 5.4절 인증 A 작업 |
| B | Google + 이메일(가입·인증 메일·재설정, D-19), `GET /auth/callback` | Google: 시스템 브라우저 + PKCE + 딥링크. 이메일: 앱 안 폼 `signInWithPassword` | G1(사람 판정). 사전예약 판매는 B 후(`01_PRD.md 8.2절`) | 인증 B(P0) |
| C1 | 카카오 | B와 같은 시스템 브라우저 흐름 | G2 + 베타 전환 데이터로 P1 승격 판단 | 인증 C1(P2 선택) |
| C2 | 네이버(`custom:naver` 또는 브리지, D-18) | `custom:naver`면 B와 같음. 브리지면 D-15 (c) + 1회용 교환 코드(T-C7). 그 전까지 데스크톱은 네이버 미제공 | G2 | 인증 C2(P2 선택) |

### 9.2 데스크톱 로그인 흐름 (D-15 (a), 막히면 (b) 루프백)

| 순서 | 주체 | 동작 |
|---|---|---|
| 1 | shell-bridge auth | supabase-js(`flowType: 'pkce'`, `auth.storage = SecureStore`, `detectSessionInUrl: false`)로 `signInWithOAuth({ provider, options: { redirectTo: 'archstudio://auth/callback', skipBrowserRedirect: true } })`. verifier는 키체인, 시도 기록(시작 시각, 1회)은 메모리 |
| 2 | NativeBridge | `openExternal(url)` → 시스템 브라우저 로그인(임베디드 웹뷰 OAuth 금지, `D:/WorkSpace/platform/docs/Tauri/README.md:37`) |
| 3 | Rust `deeplink.rs` | single-instance로 실행 중 창에 전달, 스킴·경로 허용 목록 검사(6절 위험 #12) 후 화면에 이벤트 |
| 4 | shell-bridge auth | 진행 중 시도가 있고 10분 안이면 `exchangeCodeForSession(code)`, 아니면 무시. 세션은 키체인에만(`localStorage` 0건) |
| 5 | features/auth | `POST /api/auth/finish`(Bearer, T-C8) → 서버 `finishLogin`: 제공자 허용, `bootstrap_app_for_org`(첫 로그인: 개인 조직, `trial` 14일, 가입 크레딧 30), 감사 `auth.login`, 이동 경로(`/onboarding` 또는 `/projects`) |
| 6 | 라이선스 | 활성화는 로그인 계정으로만 `POST /api/license/activate`(D-16 (a)). 이후 로컬 기능은 로그인 없이 동작(D-7) |

루프백(b)은 `127.0.0.1` 임의 포트 콜백이며 Supabase Redirect URLs에 커스텀 스킴·루프백 등록 가능 여부와 Windows 딥링크 동작은 미확인(D-15 스파이크, T-C6). 로그아웃은 키체인·A 분류 캐시를 지우고 로컬 정본(B)은 지우지 않고 묻는다(`D:/WorkSpace/platform/docs/Tauri/README.md:139`). 앱 복귀 URL의 `code`·토큰은 앱·서버 로그에 남기지 않는다(AR-F-027 수용 기준).

### 9.3 환경변수 (`AUTH_ROADMAP.md` 3.3절 중 이 제품 해당분)

| 변수 | 단계 | 배치 | 없으면 |
|---|---|---|---|
| `AUTH_MODE` | A~C | web 서버 전용(워커·api 없음) | `live`. `mock`인데 `isMockAuthAllowed()` 거짓이면 기동 실패 |
| `AUTH_PROVIDERS` | B·C | web 서버 전용. B `google,email` → C 후 `kakao`, `naver` 추가 | live에서 0개면 기동 실패 |
| `DEV_SEED_PASSWORD` | A | 로컬 web 서버와 `scripts/dev/seed-users.mjs --app arch`만. 데스크톱 번들 금지(개발자가 앱에 입력해 키체인 보관) | Mock 모드 기동 실패 |
| `VITE_AUTH_MODE` | A~C | 데스크톱 빌드 | 8절 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | B | 로컬 `supabase/config.toml` `env()`, 원격은 Supabase 대시보드만 | Google 버튼 비활성 |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | C1 | 같은 방식 | 카카오 버튼 비활성 |
| `NAVER_AUTH_PATH`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `AUTH_BRIDGE_SECRET` | C2 | 브리지일 때만 web 서버 전용 | 네이버 버튼 비활성 |

### 9.4 콘솔과 CI 검사

| 항목 | 내용 |
|---|---|
| Supabase Redirect URLs | `https://<도메인>/auth/callback`, `archstudio://auth/callback`(제안 스킴), 루프백(채택 시). 와일드카드 금지(`D:/WorkSpace/platform/docs/Tauri/README.md:161`) |
| Google 콘솔 | 웹 클라이언트 하나(Supabase 콜백). 범위 `openid email profile`, 동의 화면에 `/legal/*` URL |
| CI(웹) | `AUTH_MODE=mock VERCEL_ENV=production` 빌드 실패, live 빌드에서 `/api/dev/login` 404, 인증 모듈 밖 `AUTH_MODE` 참조 0(`AUTH_ROADMAP.md` 2.4절) |
| CI(데스크톱) | 릴리스 빌드 `VITE_AUTH_MODE=live` 강제, 산출물에서 페르소나 키·시드 이메일 문자열 0, 기능 코드에 `if (tauri)`·`if (mock)` 0(`D:/WorkSpace/platform/docs/Tauri/README.md:164`) |
| 로그인 없는 흐름 | 랜딩, `/pricing`, `/download`, `/samples`(익명 다운로드 측정 `POST /api/samples/download-event`), `/legal/*`, Toss 웹훅. 로그인 버튼을 새로 넣지 않는다 |
