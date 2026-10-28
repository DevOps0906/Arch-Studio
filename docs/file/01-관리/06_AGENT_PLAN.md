# 06 에이전트 작업 계획: Arch Studio (arch-studio)

작성일 2026-10-16. 작업 64개(`AR-06-001`~`AR-06-064`) + 공용모듈 V2 작업 2개(`AR-V2-01`, `AR-V2-02`), 합계 66개. 도면 엔진 작업은 연속 블록 `AR-06-019`~`AR-06-033`이고 첫 작업이 2일 스파이크(PRD 9.10절 1단계)다. 모델 기준은 `docs/file/03-설계/공용코어/DOC_TEMPLATE.md:27-34`(Fable 결제·권한·RLS·데이터 모델·라이선스, Opus 기능·API·테스트 설계, Sonnet UI·랜딩·문서, Haiku 보일러플레이트), 작업 표 열과 필수 작업은 같은 파일 `:262-266`, 데스크톱 작업 템플릿은 `D:/WorkSpace/platform/docs/Tauri/README.md:307-326`이다. 기능 정본은 `01_PRD.md`(AR-F-001~038), 모듈 경계 정본은 `02_ARCHITECTURE.md:30-55`이며 이 문서는 그 경계를 작업 소유로 나눌 뿐 재정의하지 않는다.

표기: 같은 폴더 문서는 `01_PRD.md:줄`처럼 줄여 쓴다(= `docs/file/02-요구사항/01_PRD.md:줄`). 경로 약어 `web/` = `apps/web/`, `desk/` = `apps/desktop/`, `rust/` = `apps/desktop/src-tauri/`, `api/` = `apps/api/`, `wk/` = `workers/arch-jobs/`, `feat/` = `packages/features/src/`, `draft/` = `packages/drafting/`. 선행 작업 열의 숫자는 `AR-06-` 번호다. 05장(`05_DATA_MODEL.md`)은 같은 날 병행 작성 중이라 테이블·RPC 이름은 공통 계약 이름(`arch.start_ai_run(p_org, p_actor, p_kind, p_variant, p_request_id, p_project_ref, p_options)`, `arch.activate_plan_device`, `arch.proposals` 등)을 쓴다.

## 1. 원칙과 소유 경계

| 원칙 | 내용 |
|---|---|
| 디렉토리 소유 | 작업마다 소유 경로를 디렉토리 단위로 나눈다. 같은 파일을 두 작업이 만지지 않는다. 남의 경로가 필요하면 그 작업에 한 줄 요청을 남긴다(task `log.md`). 근거 `docs/file/03-설계/공용코어/DOC_TEMPLATE.md:252` |
| 스키마 | `supabase/**`와 모듈러 조각 `2400_arch.sql`은 AR-06-001만 바꾼다(compliance 변환본·seed compliance 절은 AR-V2-01). 모놀리스는 변환 스크립트로만 만든다 |
| 계약 우선 | DesignModel·SheetSpec·JudgmentResult·DraftingProfile(04장 4.7절, `04_API.md:276-366`)은 AR-06-013(TS)이 먼저 만들고, Python 사본은 AR-06-046이 만들며 동치 테스트로 묶는다. 다른 작업은 import만 한다 |
| 화면 경로 | `desk/src/routes/**`는 AR-06-004가 03장 경로 전부를 `feat/<기능>` 진입점 지연 로드로 만든다. 기능 작업은 `feat/<기능>/**`만 쓴다. 공용 설정(`package.json`, `eslint.config.mjs`, `tsconfig.base.json`)은 AR-06-003에 요청한다 |
| 도면 블록 소유 | `draft/src/{sheet,titleblock,layers,annotate}/**` = 020, `draft/src/writers/dxf/**`·`draft/golden/{_harness,writer-*}/**`·`.github/workflows/golden.yml` = 021, `draft/src/writers/{svg,png,pdf}/**` = 022, `draft/src/views/<kind>/**`와 `draft/golden/<kind>-*/**` = 뷰 작업(023~026). 뷰 생성기는 법규 값을 다시 계산하지 않고 JudgmentResult와 `packages/geometry`만 읽는다(`02_ARCHITECTURE.md:164`) |
| 스파이크 코드 | `spikes/drafting/**`(AR-06-019)는 버리는 코드다. 패키지가 import하면 린트 실패. 스파이크 결과는 `[DECISION]`으로만 다음 작업에 넘긴다 |
| 디자인 순서 | 화면 작업(W4 이후)은 디자인 시스템 4단계(AR-06-012)가 끝난 뒤 시작한다(`docs/file/03-설계/디자인/DESIGN_SYSTEM.md:48`). 3단계(AR-06-011)는 사람이 판정한다 |
| 코어 | `D:/WorkSpace/platform/docs/products/_platform-core/`, `D:/WorkSpace/platform/docs/products/_design-guide/`, `_supabase-modular/`의 다른 파일, `packages/core-*`, 공용 ai-service 원본을 고치지 않는다. 필요하면 6장 요청 |
| 테스트 짝 | 모든 P0 작업은 수용 기준을 확인하는 테스트를 같은 작업 안에 두거나 테스트 작업(002, 021, 045, 049, 059, 060, 061)이 덮는다. 대응표는 7.1절 |
| 인증 단계 | 단계 분기 코드는 인증 경로(`02_ARCHITECTURE.md:50`)에만. A(008) → G1 → B(062) → G2 → C1(063)·C2(064). 단계 전환은 사람이 판정한다(`docs/file/03-설계/공용코어/AUTH_ROADMAP.md:173-184`, `:221-229`) |

## 2. 작업 목록

| ID | 작업 | 소유 파일/디렉토리 | 선행 작업 | 우선순위 | 규모 | 권장 모델 | 수용 기준 | 출처 |
|---|---|---|---|---|---|---|---|---|
| AR-06-001 | DB 조각 `2400_arch.sql` 적용, 모놀리스 변환, seed(앱 `arch`, 플랜 3, 팩 3, `license_skus`, `ai_routing_settings` app `arch`), 타입 생성 | `supabase/**`(tests·compliance 변환본 제외), `scripts/db/**`, `packages/domain/src/db/supabase.gen.ts`, `web/src/types/supabase.ts` | 없음 | P0 | M | Fable | `supabase db reset` 오류 0. `check.mjs --vector` 모듈러·모놀리스 OK. 변환 스크립트 재실행 diff 0. 모든 `arch` 테이블 RLS 켜짐, DEFINER 함수 `set search_path = ''` | 05장, `01_PRD.md 8.1절`(C-4), `docs/file/03-설계/공용코어/DB_CONVENTIONS.md:43` |
| AR-06-002 | RLS·권한 회귀 스모크(모듈러·모놀리스) | `supabase/tests/**`, `scripts/test-rls/**` | 001 | P0 | M | Fable | `rls_smoke.sql` 전 항목 통과(두 대상, CI 잡). authenticated로 `start_ai_run`·`issue_license`·`activate_license`·`activate_plan_device`·`consume_credits` 호출 시 42501. `outsider`가 다른 조직 `licenses`·`renders`·`cloud_projects` 0행. `FOR ALL` 정책 0. member의 `upsert_drafting_profile`은 `AR042` | `docs/file/03-설계/공용코어/DOC_TEMPLATE.md:266`, `02_ARCHITECTURE.md:378-379`(위험 #4·#5), `07_SOURCE_MIGRATION.md:131` |
| AR-06-003 | 모노레포·web 골격: pnpm workspace, tsconfig base, ESLint flat(경로별 import 제한), `proxy.ts`, env zod 검증, 로거, 서버 클라이언트 2종 | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `web/src/{proxy.ts,lib/**}`(`lib/auth`·`lib/compliance` 제외), `web/next.config.ts`, `web/src/app/layout.tsx` | 없음 | P0 | M | Opus | 02장 8절 "기동 실패" 변수 누락 시 기동 실패. service 클라이언트를 `web/src/server/**` 밖에서 import하면 린트 실패. `@tauri-apps/api`는 `packages/shell-bridge` 밖, three.js는 `hero3d/`·`feat/modeler/` 밖 import 시 린트 실패. 엔진 패키지의 `Date`·`Math.random`·`fetch`·`process.env` 금지 규칙 | `02_ARCHITECTURE.md:426-464`, `:44`, `:51`, `:121`, `D:/WorkSpace/platform/docs/Tauri/README.md:234` |
| AR-06-004 | T-001 셸 골격: Vite + React 19 + React Router(03장 경로 지연 로드), `src-tauri` 최소, capability, CSP | `desk/{index.html,vite.config.ts,src/main.tsx,src/routes/**}`, `rust/{Cargo.toml,tauri.conf.json,build.rs,src/main.rs,src/lib.rs}`, `rust/capabilities/**` | 없음 | P0 | M | Haiku | Windows에서 빈 창 실행, CSP 위반 0(02장 7절 지시어), 허용 명령 밖 invoke 거부. `envPrefix: 'VITE_'`, 허용 목록(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, `VITE_AUTH_MODE`) 밖 변수가 있으면 빌드 실패 | `D:/WorkSpace/platform/docs/Tauri/README.md:313`, `02_ARCHITECTURE.md:412-424`, `:457-458` |
| AR-06-005 | T-002·T-003 shell-bridge: NativeBridge(Tauri + 웹 대체), Exporter·LicenseClient 인터페이스, SecureStore(키체인) + Supabase 클라이언트(PKCE, `detectSessionInUrl: false`) | `packages/shell-bridge/src/**`(`src/auth/**` 제외), `rust/src/commands/secrets.rs` | 004 | P0 | L | Opus | 같은 화면 코드가 웹 대체·Tauri 구현 양쪽에서 동작(단위 테스트 양쪽). 토큰 `localStorage` 0건, 재시작 후 세션 유지, 로그아웃 시 키체인 항목 삭제 | `D:/WorkSpace/platform/docs/Tauri/README.md:314-315`, `:141-152`, `02_ARCHITECTURE.md:44` |
| AR-06-006 | T-005 Rust 로컬 명령: `local_db_*` 이름 붙은 쿼리(B 분류 11테이블), 로컬 마이그레이션·업데이트 전 스냅샷, `fs.rs`(대화상자 경로·크기 상한), `export.rs`(저장 대화상자 경로만) | `rust/src/commands/{local_db,fs,export}.rs`, `desk/migrations/**` | 004 | P0 | M | Opus | 화면이 준 문자열 경로·임의 SQL 거부(테스트). 마이그레이션 재실행 멱등, 필드 추가만. DXF 20MB·IFC/.3dm 100MB 초과는 읽기 전 `AR055`, 쓰기 실패 `AR052`. `cargo test` 통과 | `D:/WorkSpace/platform/docs/Tauri/README.md:317`, `:104`, `02_ARCHITECTURE.md:92`, `:387`(위험 #13) |
| AR-06-007 | T-006 클라우드 API 클라이언트(Bearer, 재시도 대기열, 오류 코드 매핑) | `feat/api-client/**` | 005 | P0 | M | Opus | 오프라인 요청이 복귀 후 순서대로 처리되고 실패가 화면에 보인다. 금액·`org_id` 필드를 보내는 호출 0(타입으로 금지). 04장 7절 코드 → 03장 5.2절 문구 매핑 테스트. 코어 요청 R-A6·R-A7 반영 전 Route Handler 호출 머지 보류 | `D:/WorkSpace/platform/docs/Tauri/README.md:318`, `:304`, `:353`, `04_API.md:508` |
| AR-06-008 | 인증 Stage A: 인증 모듈 경계, 웹 Mock 패널 + `POST /api/dev/login`, 시드 스크립트(`--app arch`, PRD 4.3절 상태 페르소나), 데스크톱 개발 빌드 Mock(`signInWithPassword`), `POST /api/auth/finish`(finishLogin), `/onboarding` 골격(국외 이전 동의 포함) | `web/src/lib/auth/`, `web/src/app/(auth)/`, `web/src/app/api/dev/login/`, `web/src/app/api/auth/finish/`, `scripts/dev/`, `packages/shell-bridge/src/auth/**`, `feat/auth/**` | 001, 003, 005 | P0 | M | Opus | `owner` 로그인 → `session_context('arch')` `entitled=true`, 플랜 `trial`, 잔액 30, 재로그인 3회 뒤 가입 크레딧 원장 1행. 원격·배포에서 `/api/dev/login` 404, 데스크톱 릴리스 번들에 Mock 패널·시드 이메일 0. 인증 경로 밖 `AUTH_MODE`·`VITE_AUTH_MODE` 참조 0 | `01_PRD.md 3절`, `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:347`, `02_ARCHITECTURE.md:474`, `:388`(위험 #14) |
| AR-06-009 | 디자인 레퍼런스 확정(1단계) | `docs/file/03-설계/디자인/DESIGN.md` 1절 | 없음 | P0 | S | Sonnet | 03장 3.19절 주 레퍼런스(Atlassian + Primer, AI 화면 Astryx 패턴만)와 4.1절 랜딩 레퍼런스 반영, 고문(Fable) 검토 기록 | `docs/file/03-설계/디자인/DESIGN_SYSTEM.md:43`, `03_SCREENS_UX.md:511-521` |
| AR-06-010 | 디자인 시스템 2단계: `packages/ui/tokens.css`(라이트·다크, 컴팩트·기본, 3D·도면 미리보기 색 토큰) + 기본 컴포넌트 + CAD형 컴포넌트(03장 3.19절 목록) + `/dev/components` | `packages/ui/tokens.css`, `packages/ui/src/**`, `web/src/app/dev/components/**` | 009 | P0 | L | Sonnet | 3.19절 배리언트 전부, 라이트/다크 x 컴팩트/기본 스크린샷, 대비 AA(axe), `tailwind.config.js` 없음, hex 직접 사용 0(린트). DXF 색은 토큰이 아니라 ACI 고정 | `DESIGN_SYSTEM.md:44`, `:67-72`, `03_SCREENS_UX.md:513-521` |
| AR-06-011 | 비주얼 검토(3단계, 판정은 사람) | (산출물) 스크린샷 표, 수정 기록 | 010 | P0 | M | Sonnet | Sonnet은 스크린샷 표와 수정 기록 양식만 준비한다. 상태·크기 배리언트별 수치 판정과 수정 결정은 사람(대표님)이 하고 기록을 남긴다 | `DESIGN_SYSTEM.md:45` |
| AR-06-012 | 정답 확정(4단계) | `docs/file/03-설계/디자인/{DESIGN,COMPONENTS}.md` | 011 | P0 | S | Opus | 문서가 `packages/ui` 코드 토큰·컴포넌트와 일치(다르면 코드 기준으로 문서 수정). 완료가 화면 작업 진입 조건 | `DESIGN_SYSTEM.md:46` |
| AR-06-013 | 도메인 계약: DesignModel v1·SheetSpec·JudgmentResult·DraftingProfile zod 스키마, `schema_version` 이주 함수, mm 정수·면적 표시 유틸 | `packages/domain/src/**`(`src/db/` 제외) | 없음 | P0 | M | Opus | 04장 4.7절 필드와 일치(스키마 스냅샷 테스트). 판정 필수 필드(`north_angle_deg`, 도로 폭, 용도지역) 누락 시 검증 실패. 이주 함수 없이 `schema_version`을 올리면 CI 실패 | `04_API.md:276-366`, `02_ARCHITECTURE.md:376-377`(위험 #2·#3) |
| AR-06-014 | 지오메트리 2D: 다각형 합집합·오프셋·면적·최단거리, 압출, 반올림 규칙 고정. 첫 단계에서 AR-02-D1(라이브러리 라이선스) 확정 | `packages/geometry/src/**`(`src/solid/` 제외) | 013 | P0 | L | Opus | 속성 테스트(fast-check): 결과 정수, 같은 입력 같은 출력, half-away-from-zero. `[DECISION] AR-02-D1`(확인 실패 시 정수 좌표 자체 구현) | `02_ARCHITECTURE.md:12`, `:24`, `:36`, `:205` |
| AR-06-015 | 판정 엔진: 건폐율·용적률·높이·이격·주차·대상 여부, 규칙 팩 로더·선택(신청 예정일), 초기 규칙 팩(PRD 6.2절 범위), 팩 서명 매니페스트 생성 스크립트, 골든 | `packages/rules/src/**`(`src/envelope/` 제외), `packages/rules/packs/**`, `packages/rules/golden/**`(`golden/envelope/` 제외), `scripts/rule-packs/**` | 013, 014 | P0 | L | Opus | 판정 행마다 근거 조항·시행일·팩 버전, 근거 없는 행 0(테스트). 매스 변경 → 판정 p95 200ms(벤치 기록). 조례 미확인 지자체 경고. 허가 도서 평가셋 30건 정량 항목 98%(KPI 제안) 측정 기록 | `01_PRD.md 3절`, `:279`, `02_ARCHITECTURE.md:37`, `:375`(위험 #1) |
| AR-06-016 | 법규 엔벨로프: 건폐율 바닥, 높이 제한, 정북 일조사선(신·구), 이격 한계 함수 + Manifold 솔리드 래퍼 | `packages/rules/src/envelope/**`, `packages/rules/golden/envelope/**`, `packages/geometry/src/solid/**` | 014, 015(팩 로더) | P0 | L | Opus | 대지 꼭짓점 200개 이하 p95 2초. 신청 예정일을 시행일 전후로 바꾸면 일조사선이 구·신 기준으로 바뀐다(골든 쌍). Manifold WASM 버전 고정 | `01_PRD.md 3절`, `:47`, `02_ARCHITECTURE.md:12` |
| AR-06-017 | 엔진 워커: `engine.worker.ts`·`drafting.worker.ts`, 메시지 프로토콜(레인별 최신만 유효, 취소, 장애 재생성), 규칙 팩 로드 | `desk/src/workers/**` | 004, 013 | P0 | M | Opus | 같은 레인 새 요청 시 이전 요청 `superseded`. `export` 레인은 끝까지 실행. 워커 종료 후 재생성·레인별 마지막 요청 재전송. 메시지 본문 로그 0 | `02_ARCHITECTURE.md:237-266`, `04_API.md:401` |
| AR-06-018 | 프로그램·공사비: 체크리스트 → 실 프로그램·면적표(잠금 행 보존), 개략 공사비(단가 카탈로그 x 면적, 부가세) | `packages/program/src/**` | 013 | P0 | M | Opus | 같은 입력 같은 출력(속성 테스트), 잠금 행 덮어쓰기 0. 합계·부가세 = 엔진 계산값, 단가 출처·기준일 포함 | `01_PRD.md 3절` |
| AR-06-019 | 도면 스파이크 2일(PRD 9.10절 1단계): 샘플 대지 3건 배치도·면적 산정도 DXF를 TS 작성기로 생성, AC1027 최소 구조, jsPDF·svg2pdf.js 라이선스·워커 동작(D-23) | `spikes/drafting/**`(버리는 코드) | 없음 | P0 | M | Opus | 한글 포함 3건이 LibreCAD·ezdxf audit에서 오류 0, AutoCAD 확인은 사람(라이선스 보유 PC)이 수행, 치수 일치. `[DECISION] D-20`, `[DECISION] D-23`, AC1027 필수 TABLES·OBJECTS 목록을 `log.md`에 기록. 실패하면 020~022 착수 전 사람에게 보고 | `01_PRD.md 9.10절`, `:479`, `:482`, `02_ARCHITECTURE.md:195`, `:239` |
| AR-06-020 | 시트 모델: `sheet/validate`·`sheet/fit`(축척 자동 선택)·`sheet/assemble`, `titleblock`(고정 고지·체험판·"이후 개정 n건"), `layers`(9.6절 표준), `annotate`(분해 치수, `anno_id`, 덮어쓰기) | `draft/src/{sheet,titleblock,layers,annotate}/**`, `draft/package.json` | 013, 014, 019 | P0 | L | Opus | 용지에 맞는 가장 큰 축척, 안 맞으면 `AR058`(고정 축척도 조용히 바꾸지 않음). 고지가 DraftingProfile·덮어쓰기로 바뀌지 않음(테스트). 수치 TEXT는 `source_ref` 필수, 값 덮어쓰기 불가. 시트 1장 p95 1초(매스 50, 실 200) | `01_PRD.md 9.3절`, `02_ARCHITECTURE.md:150-188`, `:229` |
| AR-06-021 | DXF 작성기(ASCII AC1027, 엔티티 부분집합, 결정성 규칙, `layer_map`, 문자 스타일 `ARCH-KR`) + 골든 하네스 + CI ezdxf audit | `draft/src/writers/dxf/**`, `draft/golden/{_harness,writer-*}/**`, `scripts/golden/**`, `.github/workflows/golden.yml` | 019, 020 | P0 | L | Opus | 같은 입력 두 번 생성한 DXF가 `$TDCREATE`·`$TDUPDATE` 행을 빼고 바이트 동일. 골든 20건 이상(뷰 케이스 포함) ezdxf audit(버전 고정) 오류 0, 실패 시 머지 불가. 시트 1장 쓰기 p95 2초·20MB 이하. 골든 갱신은 엔진 버전 올림 PR에서만 | `01_PRD.md 9.3절`, `:471`, `02_ARCHITECTURE.md:190-223` |
| AR-06-022 | SVG 작성기(표준 레이어 `<g id>`), PNG 미리보기, 로컬 벡터 PDF(D-23 라이브러리, 시트 묶음), 글꼴 폭 표(빌드 시 생성) | `draft/src/writers/{svg,png,pdf}/**`, `draft/fonts/**`, `scripts/font-metrics/**` | 020, 021 | P0 | L | Opus | 화면 미리보기 SVG = 내보낸 SVG(바이트). 시트 10장 PDF p95 10초. 글꼴 없으면 대체 + `AR057`, PDF 실패 `AR056`. 재배포 가능 글꼴(SIL OFL 등)만, 라이선스 파일 동봉 | `01_PRD.md 9.3절`, `:418`, `:453`, `02_ARCHITECTURE.md:212` |
| AR-06-023 | 배치도 뷰(`site_plan`)와 골든 | `draft/src/views/site_plan/**`, `draft/golden/site_plan-*/**` | 016, 020 | P0 | M | Opus | 이격 치수·주차대수가 판정 값과 1mm·1대 단위로 같다(속성 테스트). FAIL 항목에 "검토 필요" 기호. 주차 자리 부족 시 대수 유지 + 경고 | `01_PRD.md 9.3절`, `02_ARCHITECTURE.md:168`, `:222` |
| AR-06-024 | 면적 산정도·면적표 뷰(`area_plan`)와 골든 | `draft/src/views/area_plan/**`, `draft/golden/area_plan-*/**` | 015, 020 | P0 | M | Opus | 면적표 값 = 판정 엔진 값(㎡ 소수 둘째 자리). 규칙 팩 버전·산정 기준(중심선 가정) 표시 | `01_PRD.md 9.3절`, `02_ARCHITECTURE.md:169` |
| AR-06-025 | 일조사선 단면 뷰(`sunlight_section`, 무게중심 기본, `section_line`)와 골든 | `draft/src/views/sunlight_section/**`, `draft/golden/sunlight_section-*/**` | 016, 020 | P0 | M | Opus | 시행일 전후 신청일 쌍에서 사선과 라벨이 함께 바뀐다(골든). 사선 초과 구간 표시 | `01_PRD.md 9.3절`, `02_ARCHITECTURE.md:170` |
| AR-06-026 | 평면 개략도 뷰(`floor_plan`) + `packages/layout`(겹침·외곽 검사, 벽 두께, 문·창 위치). Phase 2 솔버는 인터페이스만 | `draft/src/views/floor_plan/**`, `draft/golden/floor_plan-*/**`, `packages/layout/src/**` | 014, 020 | P1 | L | Opus | 겹침·외곽 이탈은 저장 전 `AR051`, `AR051` 모델은 시트 생성 거부. 경계 이동 후 면적·목표 차이 p95 100ms(layout만). 문·창 INSERT 블록이 DXF로 나온다 | `01_PRD.md 9.3절`, `:415`, `02_ARCHITECTURE.md:40`, `:171` |
| AR-06-027 | 평면 개략도 편집기 `/projects/:id/plans`(스냅 100mm, 드래그·분할·병합, 문·창 배치, 목표 차이 표시) | `feat/plans/**` | 012, 017, 026 | P1 | L | Opus | 03장 3.7절, 키보드 조작(03장 6.1절), 실행취소, 열람 상태 편집 잠금 | `03_SCREENS_UX.md:273`, `01_PRD.md 9.3절` |
| AR-06-028 | 매스 자동 제안 3안(D-26 결정적 격자 탐색) + 모델러 제안 패널 | `packages/massing/src/**`, `feat/modeler/suggest/**` | 015, 016, 036 | P1 | M | Opus | 후보 모두 판정 PASS(FAIL 후보 0, 테스트). p95 3초. 목표 미달이면 "엔벨로프 안에서 최대 <값>㎡". 같은 입력 같은 후보 | `01_PRD.md 9.3절`, `:485`, `02_ARCHITECTURE.md:39` |
| AR-06-029 | DXF 가져오기 파서(대지 경계 후보, 단위 판별, 미지원 엔티티, 엔티티 수·중첩 상한) | `packages/io/src/dxf-import/**` | 013, 017 | P1 | M | Opus | 단위 판별 실패 시 사용자 질문(`AR053`, 조용한 추정 0). 미지원 엔티티 경고 후 무시(`AR054`). 결과는 후보이고 확정 전 DesignModel 반영 0. 중첩 깊이 8(제안) 초과 중단 | `01_PRD.md 3절`, `:379`, `:420`, `02_ARCHITECTURE.md:87`, `:387` |
| AR-06-030 | 도면 시트 화면 `/projects/:id/sheets` + `ExportDialog`(시트·형식·레이어 이름·저장 위치) | `feat/sheets/**` | 006, 012, 017, 021, 022, 023, 024, 025 | P0 | M | Sonnet | 03장 3.8절. 0크레딧·오프라인 출력. 체험은 "체험판" 안내, 체험만료·구독만료는 마지막 시트 다시 내보내기만. `AR050`~`AR059` 문구(03장 5.3절), 엔진 버전 다른 시트 `AR059` 재생성 안내 | `03_SCREENS_UX.md:301-351`, `:678`, `01_PRD.md 9.4절` |
| AR-06-031 | 설정: 표제란·레이어 매핑(`GET\|PUT /api/drafting-profile`, 로고 업로드 URL, 로컬 캐시) + `/settings/general`(국외 이전 owner·admin, 녹음 고지, 오픈소스 고지, 로그아웃) | `web/src/server/drafting-profile/**`, `web/src/app/api/drafting-profile/**`, `feat/settings/**` | 001, 003, 007, 012, 020 | P0 | M | Opus | member 저장 시 `AR042`. `layer_map` 키는 표준 레이어만, 금지 문자 매핑은 표준 이름 유지 + 경고. 로고 PNG 1MB. 변경 감사 행. 오프라인이면 캐시로 시트 생성 | `03_SCREENS_UX.md:399`, `:430`, `04_API.md:27`, `01_PRD.md 9.6절` |
| AR-06-032 | 제안서 PDF(도면 시트 포함): `POST /api/ai/proposal`, 시트 SVG 업로드(`proposal_sheet`), 워커 HTML 조립 → 공용 WeasyPrint, 서술 생성(`arch.proposal_narrative`), `/projects/:id/proposal` | `web/src/server/ai/proposal/**`, `web/src/app/api/ai/proposal/**`, `wk/src/handlers/proposal/**`, `api/app/ai/products/arch/narrative.py`, `feat/proposal/**` | 022, 046, 047, 048 | P0 | L | Opus | 판정·면적·공사비 수치 = 엔진 스냅샷 값, 도면은 로컬 SVG. 꼬리말 "법적 판정 아님". 20쪽 p95 60초, 실패·120초 초과 전액 환불. 서술 10·템플릿 1(같은 버전 재요청 0). R-A5 반영 전 머지 보류 | `01_PRD.md 3절`, `:382`, `02_ARCHITECTURE.md:301`, `04_API.md:234` |
| AR-06-033 | 랜딩 샘플 도면 `/samples`: 골든 3건 DXF·PDF 복사, 익명 다운로드 측정 `POST /api/samples/download-event` | `web/src/app/(marketing)/samples/**`, `web/public/samples/**`, `web/src/app/api/samples/**`, `scripts/samples/**` | 003, 021, 023, 024 | P0 | S | Sonnet | 게시 파일은 CI가 골든 출력에서 복사한 실제 엔진 출력만(손으로 만든 파일 0). 다운로드 이벤트로 9.8절 전환 지표 측정 시작. 금지 문구 0 | `01_PRD.md 9.8절`, `:492`, `02_ARCHITECTURE.md:223`, `03_SCREENS_UX.md:486` |
| AR-06-034 | 프로젝트: `/projects`, 로컬 저장·버전(`model_revisions`), 클라우드 사본(`GET\|POST /api/cloud-projects`, upload-url, `arch.save_cloud_project`) | `feat/projects/**`, `web/src/server/cloud-projects/**`, `web/src/app/api/cloud-projects/**` | 001, 006, 007, 012, 013 | P0 | M | Opus | 상한 초과 `AR040`, 버전 충돌 `AR041`(조용한 덮어쓰기 0). 체험만료·구독만료는 새 프로젝트 불가·열람 | `03_SCREENS_UX.md:19`, `04_API.md:27`, `D:/WorkSpace/platform/docs/Tauri/README.md:356` |
| AR-06-035 | 대지 화면 `/projects/:id/site`(조회·직접 그리기·DXF 가져오기 버튼) + `POST /api/site/lookup`(VWorld 중계, `arch.record_site_lookup`) | `feat/site/**`, `web/src/server/site/**`, `web/src/app/api/site/**` | 001, 007, 012, 013 | P0 | M | Opus | p95 5초. 공공 API 실패 `AR021` → 직접 그리기로 이어짐. 일일 상한 `AR020`. 주소 원문 DB 저장 0(지번 해시만). 공공 API 값은 입력 후보이고 판정 기준이 아님. D-14 원문 확인 전 직접 그리기가 기본 | `01_PRD.md 3절`, `:303`, `02_ARCHITECTURE.md:85`, `:375` |
| AR-06-036 | 모델러 `/projects/:id/model`: R3F 뷰포트, 매스·층·코어·발코니·지붕 편집, 엔벨로프 표시, 실행취소 100단계, 렌더용 깊이·윤곽 캡처 함수 | `feat/modeler/**`(`suggest/` 제외) | 012, 016, 017 | P0 | L | Opus | 착수 첫 주에 R3F + Manifold WASM 성능 스파이크로 최소 사양(RAM 8GB, WebGL2) 30fps를 먼저 확인(`D:/WorkSpace/platform/docs/Tauri/README.md:290`, 미달 시 지오메트리 단순화 방침을 log.md에 [DECISION]). 매스 50개·삼각형 20만 개 권장 사양 60fps(실기 측정 기록). 실행취소 100단계. 열람 상태 편집 잠금. 판정은 `judge` 레인으로만 요청 | `01_PRD.md 3절`, `03_SCREENS_UX.md:201` |
| AR-06-037 | 판정 패널: 근거 조항·시행일·팩 버전, 대상 여부, 폴백 "이후 개정 n건"·"개정 확인 필요" 배너 | `feat/judgment/**` | 012, 015, 017 | P0 | M | Sonnet | 근거 없는 행 표시 0. 상태는 배지 + 텍스트(색만 금지). 폴백·30일 미확인(제안) 배너 | `01_PRD.md 3절`, `:62`, `02_ARCHITECTURE.md:385` |
| AR-06-038 | 프로그램 화면 `/projects/:id/program`: 체크리스트·면적표·개략 공사비(대화형 패널 자리만) | `feat/program/**`(`intake/` 제외) | 012, 018, 042 | P0 | M | Sonnet | 03장 3.6절, 사용자 수정 행 잠금 표시, 단가 출처·기준일 표시 | `03_SCREENS_UX.md:241`, `01_PRD.md 3절` |
| AR-06-039 | 3D 파일 입출력: glTF·IFC(web-ifc)·.3dm 내보내기, .3dm 가져오기(후보). 첫 단계 AR-02-D2 확정 | `packages/io/src/{ifc,gltf,rhino}/**` | 013, 036 | P0 | M | Opus | 내보낸 IFC가 무료 IFC 뷰어에서 열림(수동 점검 기록). 압축 해제 상한 원본 10배(제안)·시간 상한. 상표는 "호환" 표기만. `[DECISION] AR-02-D2`(미확인이면 .3dm 보류) | `01_PRD.md 3절`, `02_ARCHITECTURE.md:14`, `:24`, `:387` |
| AR-06-040 | 라이선스 서버: `POST /api/license/{activate,deactivate,refresh}`, `GET /api/license/list`, Ed25519 서명 라이선스 파일(`features`, `offline_valid_until`), 플랜 기기 활성화(`arch.activate_plan_device`), IP당 10회/시간 | `web/src/server/licenses/**`, `web/src/app/api/license/**` | 001, 003 | P0 | L | Fable | 3대째 `AR001`, 다른 조직 시리얼 `AR006`(`outsider`), 정지·환불 `AR003`, 셀프 해제 30일 3회 초과 `AR004`. 서명 키는 web 서버에만, `AI_TOKEN_PRIVATE_KEY`와 다른 키. 화면 시리얼은 끝 5자만 | `01_PRD.md 4.4절`, `:60-61`, `04_API.md:91`, `02_ARCHITECTURE.md:101-117` |
| AR-06-041 | T-007 Rust 라이선스: `license.rs`(`kid`별 공개키, `device_hash`·`app_id` 검증, 시계 되돌림, `offline_valid_until`), `device.rs`(앱별 솔트 해시), 규칙 팩 매니페스트 서명·자격 검사 | `rust/src/commands/{license,device}.rs`, `rust/keys/**`(공개키 상수) | 006, 040 | P0 | M | Fable | 변조·다른 PC 파일 거부(미활성). SQLite 다른 값·`local_settings`로 권한 판정 0. 시계 되돌림 시 만료 처리. 자격 밖 팩 엔진 전달 0. `cargo test` 변조 케이스 | `D:/WorkSpace/platform/docs/Tauri/README.md:319`, `02_ARCHITECTURE.md:96-99`, `:380-381`(위험 #6·#7) |
| AR-06-042 | T-008 업데이트·배포: `updater.rs`(서명 검증), `GET /api/updates/...`(`arch.eligible_build`, 서명 URL 15분, 자격 없으면 204), `GET /api/rule-packs`·`/download`, `GET /api/cost-catalogs/latest` | `rust/src/commands/updater.rs`, `web/src/server/{updates,rule-packs}/**`(단가표 포함), `web/src/app/api/{updates,rule-packs,cost-catalogs}/**` | 040, 041 | P0 | L | Fable | 만료 라이선스에 새 빌드 미제공, 마지막 자격 버전 설치·실행 유지. 서명 불일치 업데이트 거부. 자격 없는 팩 `AR011`, 기간 밖 빌드 `AR010` | `D:/WorkSpace/platform/docs/Tauri/README.md:320`, `01_PRD.md 3절`, `02_ARCHITECTURE.md:408`, `04_API.md:69` |
| AR-06-043 | 결제: `POST /api/checkout`(license_sku·plan·credit_pack, 서버 생성 주문), `POST /api/webhooks/toss`(원시 본문 서명, `core.webhook_events` 멱등 → `issue_license`·`extend_updates`·플랜·팩), 시리얼 메일, `/checkout/result` | `web/src/server/billing/**`, `web/src/app/api/{checkout,webhooks}/**`, `web/src/app/(account)/checkout/**` | 001, 003, 040 | P0 | L | Fable | 서명 없는 웹훅 401. 금액·SKU는 서버 주문만. 이메일 미확인 계정 구매 `AR005`. 결제 확정 후 1분 안 시리얼(메일·계정). R-A1(C-1) 반영 전 영구 라이선스 결제 머지 보류 | `01_PRD.md 3절`, `:292`, `02_ARCHITECTURE.md:277-278`, `07_SOURCE_MIGRATION.md:133-134` |
| AR-06-044 | T-009 라이선스·크레딧 화면: 데스크톱 `/license`·`/credits`(시스템 브라우저 결제 → 웹훅 → Realtime), 웹 `/account/{licenses,devices,credits}` | `feat/{license,credits}/**`, `web/src/app/(account)/{licenses,devices,credits}/**` | 007, 012, 040, 043 | P0 | M | Opus | 딥링크 없이 결제 결과 1분 안 반영. 3대째 `AR001` → 해제 화면 안내. 환불 내역 1분 안 표시. 마지막 자격 버전 내려받기 | `D:/WorkSpace/platform/docs/Tauri/README.md:321`, `03_SCREENS_UX.md:434`, `:465`, `01_PRD.md 3절`, `:63` |
| AR-06-045 | 결제 E2E(Toss 테스트 키) | `e2e/billing/**` | 043, 044, 061 | P0 | M | Opus | 영구 SKU 결제 → 시리얼·라이선스 행. `updates_yearly` → `updates_until` 연장. 팩 → 잔액. 금액 위조 → 실패. 웹훅 재전송 멱등 | `docs/file/03-설계/공용코어/DOC_TEMPLATE.md:266` |
| AR-06-046 | AI 서비스 설치(공용) + arch 확장 골격, pydantic 스키마(intake·review·layout 결과, DesignModel 사본), zod·pydantic 동치 테스트 | `api/**`(공용 설치분), `api/app/ai/products/arch/{__init__,schema}.py`, `tests/contract/**` | 001, 013 | P0 | M | Opus | 서명·잡 토큰 없으면 401. 조직 격리 테스트. 동치 테스트 통과(추가 필드 거부 포함) | `02_ARCHITECTURE.md:52`, `:377` |
| AR-06-047 | AI 게이트: 서명 토큰, `POST /api/internal/ai-token`, 크레딧 상수 `pricing.ts`, `arch.start_ai_run` 호출 헬퍼, `POST /api/uploads/sign`(경로 서버 생성), `GET /api/jobs/{id}` | `web/src/server/ai/{gateway,token}/**`, `web/src/server/ai/pricing.ts`, `web/src/app/api/internal/**`, `web/src/server/{uploads,jobs}/**`, `web/src/app/api/{uploads,jobs}/**` | 003, 046 | P0 | L | Fable | 잡 토큰은 running 잡의 org·user로만. 요청 본문의 금액·`org_id` 무시. Storage 경로 `<org_id>/arch/<purpose>/<uuid>.<ext>`만. Route Handler의 `consume_credits` 직접 호출 0(검색) | `02_ARCHITECTURE.md:57`, `:276`, `:294`, `D:/WorkSpace/platform/docs/Tauri/README.md:173` |
| AR-06-048 | 워커 골격: `core.claim_jobs` 루프, 잡 토큰 클라이언트, 실패 순서(`fail_job` → `arch.fail_ai_run`), 타임아웃, 크론 | `wk/src/{index.ts,core/**,cron/**}`, `wk/package.json` | 001 | P0 | M | Opus | 빈 잡 성공·실패 처리, 실패 시 환불 원장 1행. 02장 4절 스케줄(reap 10분, 정산 5분, 녹음 삭제 1시간, 렌더 90일) 동작 | `02_ARCHITECTURE.md:294`, `:310-316` |
| AR-06-049 | 라우팅 seed 검증 + AI 보안 테스트 + 크레딧 상수 = seed 비교 | `scripts/ai-routing/**`, `api/tests/arch/security/**` | 046, 047 | P0 | M | Fable | 02장 5절 feature 표 = DB 행. 국외 미동의 조직 상용 제공자 0. `arch.intake_consult`·`consult_recording` 오픈소스 강제. 다른 조직 컬렉션 검색 0. `pricing.ts` 값 = seed | `02_ARCHITECTURE.md:320-349` |
| AR-06-050 | RAG 색인(`arch.knowledge`: 법령·지구단위계획·질의회신, 시행 범위 메타데이터) + 평가셋 + 위키 설정(ingest·lint) | `api/app/ai/products/arch/{knowledge,ingest}/**`, `api/app/ai/products/arch/wiki_config.py`, `api/tests/arch/rag/**`, `scripts/arch-ingest/**` | 046 | P0 | L | Opus | `application_date` 시행 범위 필터 테스트. 평가셋 30문항(제안) 재현율 0.8(제안). 위키 페이지마다 출처·확인일. 출처 표기 의무는 D-14 확인 결과 반영 | `01_PRD.md 3절`, `02_ARCHITECTURE.md:345`, `:355` |
| AR-06-051 | 클라우드 법규 검토: `arch.review` 그래프 + `compliance/arch.py` + `POST /api/ai/review`(서버 `packages/rules` 재계산) + 워커 핸들러 | `api/app/ai/graphs/arch_review.py`, `api/app/ai/compliance/arch.py`, `web/src/server/ai/review/**`, `web/src/app/api/ai/review/**`, `wk/src/handlers/review/**` | 015, 047, 048, 050 | P0 | L | Opus | 출처 없는 문장 0(남는 문장 0이면 `AR033` + 환불). 숫자는 자리표시자 치환만. 폴백 `AR012`. 10분 초과 환불. 데스크톱 JudgmentResult 불신(서버 재계산만 저장) | `01_PRD.md 3절`, `02_ARCHITECTURE.md:299`, `:308`, `:355` |
| AR-06-052 | 대화형 설계 입력 + 상담 녹음 후보: `arch.intake` 그래프, `POST /api/ai/intake`(입력 `source`, 04장 2.2절), 워커 핸들러, 대화형 패널(항목별 채택, "AI 추출 후보" 배지), 제3자 녹음 고지 | `api/app/ai/graphs/arch_intake.py`, `web/src/server/ai/intake/**`, `web/src/app/api/ai/intake/**`, `wk/src/handlers/intake/**`, `feat/program/intake/**` | 038, 046, 047, 048, 053 | P1 | L | Opus | 스키마 실패 1회 재시도 후 `AR032` + 환불. 채택 안 한 후보 반영 0. 좌표·면적 필드 0(strict). 텍스트 p95 20초. 상담 녹음은 오픈소스만, 원본 24시간 삭제 | `01_PRD.md 3절`, `:376`, `02_ARCHITECTURE.md:300`, `:356` |
| AR-06-053 | 음성: `POST /api/voice/stt`(받아쓰기 60초), 워커 `arch.stt` 핸들러, 음성 UI(마이크 권한, 녹음 고지, 텍스트 대체), 읽어 주기(OS 음성 합성, 0크레딧) | `web/src/server/voice/**`, `web/src/app/api/voice/**`, `wk/src/handlers/stt/**`, `feat/voice/**` | 012, 047, 048 | P0 | M | Opus | 분당 1 실제 길이 정산, `voice:<request_id>` 멱등. 권한 거부 시 텍스트로 계속. 상담 녹음은 대체 제공자 없음 | `02_ARCHITECTURE.md:302`, `:346-347`, `03_SCREENS_UX.md:379` |
| AR-06-054 | Dify `arch-chat` + `/tools/answer` + `POST /api/ai/chat` 중계(SSE, 턴 1크레딧) | `infra/dify/arch-chat/**`, `api/app/ai/tools/arch/**`, `web/src/server/ai/chat/**`, `web/src/app/api/ai/chat/**` | 047, 050 | P0 | M | Opus | 답변마다 출처 1개 이상, 없으면 "근거를 찾지 못했습니다". Dify 입력에 토큰·org 0. Dify 장애 시 `/tools/answer-direct`. 폴백 상태 턴 0 | `01_PRD.md 3절`, `02_ARCHITECTURE.md:330`, `04_API.md:498` |
| AR-06-055 | AI 화면: `/projects/:id/review`(확인 필요 항목 확인 표시), 채팅 위젯(셸 오른쪽 패널), `/chat`, `/wiki` | `feat/{review,chat,wiki}/**` | 012, 051, 053, 054 | P0 | L | Sonnet | fetch + ReadableStream 스트리밍, 출처 칩, 턴 비용 표시, 위키 출처·확인일, 폴백 잠금 안내 | `03_SCREENS_UX.md:369`, `:379`, `:388` |
| AR-06-056 | AI 렌더: 깊이·윤곽 캡처 → `POST /api/ai/render`(동시 3건 `AR030`, 10MB `AR031`) → 워커 fal(안전 검사, AI 생성 메타데이터) + `/projects/:id/render`. 고품질 제공자 경로 확정 | `web/src/server/ai/render/**`, `web/src/app/api/ai/render/**`, `wk/src/handlers/render/**`, `feat/render/**` | 036, 047, 048 | P0 | L | Opus | 원본 모델·도면 전송 0. p95 60초, 3분 초과·실패 전액 환불. 크레딧 3/5/2. 결과 Storage 복사, 90일 만료. `[DECISION]` 고품질 이미지 제공자(fal 경유 여부) | `01_PRD.md 3절`, `02_ARCHITECTURE.md:298`, `:361-365` |
| AR-06-057 | 랜딩 `/`(3D 히어로, 정지 이미지 대체, 킬 스위치), `/pricing`, `/download`(최신 stable 서명 URL), `/legal/*`. 2026-10-17: 섹션 배치는 03장 7.1절, 추가 섹션은 065·067이 장착 | `web/src/app/(marketing)/**`(`samples/`, `tools/` 제외), `web/src/components/hero3d/**`, `web/public/hero/**`, `web/src/app/legal/**`, `web/src/content/legal/**` | 003, 012, 023 | P0 | L | Sonnet | `HERO_3D.md` 4절 수용 기준, 03장 4.5절 소재(형상은 예시 대지 1 엔진 출력 정적 JSON), 카피 금지 문구 0(PRD 6.1·9.7절), 상표 "호환" 표기만, 01장 6장 법적 고지 반영 | `03_SCREENS_UX.md:597-613`, `:614`, `01_PRD.md 9.7절` |
| AR-06-058 | T-010 CI: `desktop-build`·`desktop-release`(코드 서명, 업데이트 서명, `arch-releases` 업로드, `arch.builds` 등록)·`web`·`api` 워크플로, 비밀 문자열 검사, 인증 금지 문자열 검사 | `.github/workflows/{desktop-build,desktop-release,web,api}.yml`, `scripts/ci/**` | 001, 003, 004 | P0 | L | Sonnet | 태그 푸시로 서명된 NSIS·MSI와 매니페스트 생성. 산출물에서 `service_role` JWT·`BEGIN PRIVATE KEY`·`sk-`·fal 키·시드 이메일 0, 릴리스 `VITE_AUTH_MODE=live` 강제. `mock-auth`·`nomad_role`·`nomad_plan`·인증 경로 밖 `AUTH_MODE` 0. 실패 시 머지·릴리스 불가 | `D:/WorkSpace/platform/docs/Tauri/README.md:322`, `02_ARCHITECTURE.md:382`, `:401-410`, `:510-511` |
| AR-06-059 | T-011 보안 점검(리뷰 전용): capability·CSP·IPC 입력 검증, 라이선스·업데이트·파일 경로·Mock 혼입, 02장 6절 위험 14건 | (산출물) 점검 기록, 발견 사항은 해당 작업에 요청 | 005, 006, 040, 041, 042, 058 | P0 | M | Fable | `D:/WorkSpace/platform/docs/Tauri/README.md` 9장 항목 전부 체크, 위반 0. 위험 #1~#14마다 확인 근거(테스트·코드 위치). 딥링크(위험 #12)는 062 완료 후 재점검 | `D:/WorkSpace/platform/docs/Tauri/README.md:323`, `02_ARCHITECTURE.md:373-388` |
| AR-06-060 | T-012 데스크톱 E2E: 설치 → 로그인(Mock) → 체험 → 대지 → 매스 → 판정 → 시트 DXF·PDF → 오프라인 → 복귀, 3대째 활성화 거부, 폴백 상태 | `desk/e2e/**` | 030, 036, 041, 044 | P0 | M | Sonnet | 시나리오 5개 이상 통과(WebDriver 기반, Windows 도구 선택 `[DECISION]`, 동작 미확인). 오프라인 중 도면 출력 성공, 클라우드 기능은 실패 표시 | `D:/WorkSpace/platform/docs/Tauri/README.md:324`, `03_SCREENS_UX.md:57-147` |
| AR-06-061 | 웹 E2E 페르소나 `globalSetup`(`storageState`) + 잡 흐름 통합(가짜 제공자로 렌더·검토·intake·제안서 → finish·환불) | `e2e/{setup,flows}/**`, `tests/integration/**` | 008, 032, 051, 056 | P0 | M | Opus | 상태 페르소나(체험·만료·영구·폴백·구독)별 접근 매트릭스 통과. 실패 주입 시 환불 원장. `outsider` 거부 | `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:180`, `:352` |
| AR-06-062 | Stage B: 웹 Google + 이메일(가입·인증 메일·재설정, D-19), `GET /auth/callback`, 데스크톱 T-004(시스템 브라우저 + PKCE + `deeplink.rs`, 막히면 루프백), 온보딩 약관 단계(008 경로 이어받기) | `web/src/app/auth/callback/**`, `rust/src/commands/deeplink.rs`, 008의 인증 경로 | G1, 008 | P0 | M | Fable | `AUTH_ROADMAP.md` 5.3절 B-1~B-6. 시작하지 않은 딥링크 콜백 무시, `code`·토큰 로그 0. `[DECISION] D-15` 스파이크 결과 | `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:210-219`, `D:/WorkSpace/platform/docs/Tauri/README.md:316`, `01_PRD.md 8.2절`, `02_ARCHITECTURE.md:479-490` |
| AR-06-063 | Stage C1 카카오(D-17 이메일 정책) | `web/src/lib/auth/providers/kakao.ts`, `feat/auth/login-methods/**` | G2, 062 | P2 | S | Opus | C1-1~C1-5, 데스크톱 앱 복귀 경로 검증 | `AUTH_ROADMAP.md:339`, `:349` |
| AR-06-064 | Stage C2 네이버(스파이크 → `custom:naver` 또는 브리지, D-18) | `web/src/lib/auth/providers/naver.ts`, `web/src/app/auth/naver/**`, `scripts/auth/**` | G2, 062 | P2 | M | Fable | C2-1~C2-6, `[DECISION] NAVER_AUTH_PATH`. 브리지면 R-A10(T-C7) 반영 전 데스크톱 네이버 미제공 | `AUTH_ROADMAP.md:339`, `:350`, `02_ARCHITECTURE.md:477` |
| AR-V2-01 | compliance 적용(SQL 변환본, 주입 파일 `createModule({ appId: 'arch' })`, seed compliance 절, 어댑터), `profileKind: kr_ecommerce` | `web/src/lib/compliance/**`, compliance 변환본 SQL, seed compliance 절 | W0 완료, `@nomad/compliance` 출시 | P0 | M | Sonnet | `develop/_shared/modules/README.md` 5.2절 1~7번. 가입·구매 동의 기록 1행, 새 정책 버전 후 재동의 화면 | `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md:66` |
| AR-V2-02 | V2 전환 점검: 모듈 계약 테스트 CI 연결, 자체 구현 잔재 검사 | `tests/v2/**` | AR-V2-01 | P0 | S | Sonnet | 제품 E2E 녹색, 공용모듈로 옮긴 표·함수를 제품 코드가 직접 쓰는 곳 0 | `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md:67` |

## 3. 웨이브(병렬 실행 순서)

| 웨이브 | 작업 ID | 병렬 수 | 진입 조건 | 산출물 |
|---|---|---|---|---|
| W0 | 001, 003, 004, 009, 013, 019, 066 | 7 | 없음 | 주장 장부·V0 인터뷰 준비(066, 2026-10-17), 로컬 DB, 모노레포·web 골격, 빈 셸 창, 디자인 레퍼런스, 도메인 계약, 도면 스파이크 결과(`[DECISION] D-20`·`D-23`). 스파이크를 W0에 두는 이유: D-20 권고(a)가 스파이크 통과를 전제하고(`01_PRD.md 9.9절`, `:491`) 020~022가 그 결과에 의존한다 |
| W0-D | 010 → 011(사람) → 012 | 1씩 | 009 | 디자인 시스템 2~4단계. 012 완료가 W4 화면 작업의 진입 조건 |
| W1 | AR-V2-01, 002, 005, 006, 014, 018, 046, 048 → 007, 008 | 8 → 2 | W0. 007의 Route Handler 호출 머지는 R-A6·R-A7 반영 후(`D:/WorkSpace/platform/docs/Tauri/README.md:304`) | RLS 스모크, shell-bridge·키체인, 로컬 명령, API 클라이언트, Mock 로그인, 2D 지오메트리, 프로그램 엔진, AI 서비스·워커 골격 |
| W2 | 015 → 016, 020 → 021, 040 → (041, 043), 017, 047, 050, 058 | 8 갈래(작업 11) | W1, 019 통과(020·021) | 판정 엔진·엔벨로프, 시트 모델·DXF·골든 CI, 라이선스 서버·Rust 검증·결제, 엔진 워커, AI 게이트, RAG, CI |
| W3 | 022, 023, 024, 025, 042, 049, 051, 053, 054 | 9 | W2 | SVG·PNG·PDF, 배치도·면적도·일조 단면, 업데이트·규칙 팩 배포, 라우팅 검증, 법규 검토, 음성, 채팅 |
| W4 | 026, 029, 031, 033, 034, 035, 036, 037, 038, 044, 069 → 028 | 11 → 1 | W3 + 012 | 마케팅 컴포넌트(069), 평면 뷰·layout, DXF 가져오기, 설정, 샘플 도면, 프로젝트·대지·모델러·매스 제안, 판정 패널, 프로그램, 라이선스·크레딧 화면 |
| W5 | 027, 030, 032, 039, 052, 055, 056, 057 | 8 | W4 | 평면 편집기, 도면 시트 화면, 제안서, 3D 입출력, 대화형 입력, AI 화면, 렌더, 랜딩 |
| W6 | 059, 060, 061, AR-V2-02, 065, 067 → 045 | 6 → 1 | W5 | 설득 칸·판정표(065)와 도입 단계 탭(067), 보안 점검, 데스크톱·웹 E2E·통합, 결제 E2E(Mock 기준) → G1 판정 자료 |
| W7 | 062 → 060·061 재실행(B-5) | 1 | G1(사람 판정) | Google + 이메일 로그인 → 공개 베타, 사전예약 판매 열기(`01_PRD.md 8.2절`) |
| W8 | 063, 064, 068 | 3 | G2(사람 판정) + 베타 가입 전환 데이터. 068은 공개 베타 뒤 | P2 선택 제공자, 제안 준비 시간 계산기(068) |

웨이브는 W0~W8 9개(+ 디자인 트랙 W0-D)다. PRD 9.10절 2단계(사전예약 랜딩 샘플 다운로드)는 033이 W4에서 맡고, 3단계 인터뷰 5건은 사람이 W2~W4 동안 진행해 D-22 판단 자료를 남긴다(작업 없음).

## 4. 모델별 비율

| 모델 | 작업 수 | 비율 | 규모 가중(S=1, M=2, L=3) 비율 |
|---|---|---|---|
| Fable | 11 | 15.5% | 16.6% (26/157) |
| Opus | 41 | 57.7% | 60.5% (95/157) |
| Sonnet | 17 | 23.9% | 21.0% (33/157) |
| Haiku | 2 | 2.8% | 1.9% (3/157) |
| 합계 | 71 | 100% | 157 |

비율은 소수 첫째 자리 반올림이라 합이 100.0에서 0.1 어긋날 수 있다. 2026-10-17 설득형 랜딩 5개 추가(065 Sonnet M, 066 Haiku S, 067 Sonnet S, 068 Sonnet M, 069 Sonnet S). 그 전 66개는 Fable 16.7%, Opus 62.1%, Sonnet 19.7%, Haiku 1.5%, 가중 150. Opus 비중이 다른 제품(book-trailer 56.7%)보다 높은 이유: 도면 엔진·지오메트리·판정이 결정적 순수 함수 기능 구현이라 Opus 기준(`DOC_TEMPLATE.md:30`)에 해당하고 15개 도면 블록 중 13개가 Opus다. Fable은 결제·권한·RLS·라이선스·업데이트 자격·AI 게이트·인증 B/C2·보안 점검으로 한정했다. AR-06-011은 Sonnet이 준비하고 판정은 사람이 한다.

## 5. 리뷰 작업 흡수표

이 제품은 원본 프로젝트와 리뷰가 없는 신규 제품이다(`02_ARCHITECTURE.md:371`). 그래서 리뷰 5장 대신 (1) PRD 기능 ID, (2) Tauri 작업 템플릿 T-001~T-012, (3) 02장 6절 위험 14건을 작업 ID로 흡수한다.

### 5.1 PRD 기능 → 작업

| 기능 ID | 기능 | 단계 | 흡수 작업 ID |
|---|---|---|---|
| AR-F-001 | 대지 불러오기 | MVP(DXF P1) | 035, 029(DXF) |
| AR-F-002 | 법규 엔벨로프 | MVP | 016, 017, 036 |
| AR-F-003 | 매스 모델러 | MVP | 036 |
| AR-F-004 | 실시간 판정 패널 | MVP | 015, 017, 037 |
| AR-F-005 | 규칙 팩 버전관리 | MVP | 015, 016(신·구 골든), 041, 042 |
| AR-F-006 | 주차대수 산정 | MVP | 015, 023 |
| AR-F-007 | 대상 여부 판정 | MVP | 015, 037 |
| AR-F-008 | 클라우드 법규 검토 | MVP | 050, 051, 055 |
| AR-F-009 | 법규 질의 채팅 | MVP | 050, 054, 055 |
| AR-F-010 | 법규 해설 위키 | MVP | 050, 055 |
| AR-F-011 | 체크리스트 → 실 프로그램 | MVP | 018, 038 |
| AR-F-012 | 개략 공사비 | MVP | 018, 038, 042(단가표) |
| AR-F-013 | AI 렌더 | MVP | 056 |
| AR-F-014 | 제안서 PDF | MVP | 032 |
| AR-F-015 | 상담 녹음 → 요구사항 후보 | MVP(P1) | 052, 053 |
| AR-F-016 | 파일 입출력 | MVP(DXF 가져오기 P1) | 039, 021, 022, 029 |
| AR-F-017 | 시리얼 라이선스 구매·발급 | MVP | 040, 043, 044 |
| AR-F-018 | 기기 활성화·해제 | MVP | 040, 041, 044 |
| AR-F-019 | 업데이트 권한·폴백 | MVP | 041, 042 |
| AR-F-020 | 크레딧 지갑 | MVP | 044, 047, 048 |
| AR-F-021 | 플랜 | MVP | 001(seed), 040(`org_features`), 043 |
| AR-F-022 | 로컬 GPU 렌더 | Phase 2 | 작업 없음(D-9) |
| AR-F-023 | 사용자 키 연결 | Phase 2 | 작업 없음(D-10, R-A2 승인 전) |
| AR-F-024 | SketchUp 매스 전송 | Phase 2(조건부) | 작업 없음 |
| AR-F-025 | 화이트라벨 | Phase 2 | 작업 없음(모놀리스는 001이 유지) |
| AR-F-026 | 시공 단계 문서 | Phase 2 | 작업 없음 |
| AR-F-027 | 가입/로그인·계정 | MVP(A·B), C P2 | 008, 062, 063, 064 |
| AR-F-028 | 도면 엔진 | MVP | 017, 020, 021, 022 |
| AR-F-029 | 배치도 | MVP | 023 |
| AR-F-030 | 면적 산정도·면적표 | MVP | 024 |
| AR-F-031 | 일조사선 단면 개략도 | MVP | 025 |
| AR-F-032 | 층별 평면 개략도와 실 배치 편집기 | MVP(P1) | 026, 027 |
| AR-F-033 | 매스 자동 제안 | MVP(P1) | 028 |
| AR-F-034 | 대화형 설계 입력 | MVP(P1) | 052, 053 |
| AR-F-035 | AI 실 배치 초안 | Phase 2 | 작업 없음(D-25. 026이 솔버 인터페이스 자리만 둔다) |
| AR-F-036 | 입면 개략도 | Phase 2 | 작업 없음(020의 `kind` enum에 `elevation`만 예약) |
| AR-F-037 | 기존 도면 입력 | Phase 2·3 | 작업 없음(Phase 2에 029 파서 재사용) |
| AR-F-038 | 도면 출력 형식 | MVP | 021, 022, 030 |

MVP·P1 기능 29개가 모두 1개 이상의 작업에 매핑된다. 열린 결정 중 06장 작업 안에서 `[DECISION]`으로 닫는 것: D-15(062), D-18(064), D-20·D-23(019), AR-02-D1(014), AR-02-D2(039). 나머지 D-1~D-14, D-16~D-17, D-19, D-21~D-26은 사람 결정이며 결과를 해당 작업 입력으로 쓴다.

### 5.2 Tauri 작업 템플릿 → 작업

| 템플릿 | 내용 | 흡수 작업 ID |
|---|---|---|
| `D:/WorkSpace/platform/docs/Tauri/README.md:313` T-001 | 셸 골격, capability, CSP | AR-06-004 |
| `:314` T-002 | shell-bridge 인터페이스와 웹 대체 | AR-06-005 |
| `:315` T-003 | 키체인 어댑터 + Supabase 클라이언트, A Mock | AR-06-005, 008 |
| `:316` T-004 | 소셜 로그인(B, G1 후) | AR-06-062 |
| `:317` T-005 | 로컬 DB, 마이그레이션, 스냅샷 | AR-06-006 |
| `:318` T-006 | 클라우드 API 클라이언트 | AR-06-007 |
| `:319` T-007 | 라이선스 활성화·검증·기기 해시 | AR-06-041(+ 서버 040) |
| `:320` T-008 | 업데이터, 라이선스 기반 매니페스트 | AR-06-042 |
| `:321` T-009 | 결제 연결(시스템 브라우저 → 웹훅 → Realtime) | AR-06-044(+ 서버 043) |
| `:322` T-010 | CI: 빌드·서명·매니페스트 | AR-06-058 |
| `:323` T-011 | 보안 점검 | AR-06-059 |
| `:324` T-012 | E2E 설치 → 로그인 → 핵심 기능 → 오프라인 → 복귀 | AR-06-060 |

템플릿의 ID 형식 `AR-T-###`(`D:/WorkSpace/platform/docs/Tauri/README.md:309`)은 따로 만들지 않고 이 표로 대응시킨다(공통 계약의 `AR-06-###` 단일 체계).

### 5.3 02장 6절 위험 → 작업

| 위험 | 요약 | 흡수 작업 ID |
|---|---|---|
| 위험 #1(`02_ARCHITECTURE.md:375`) | 외부 API 값 경계 오판 | 015, 016, 035, 051 |
| 위험 #2(`:376`) | 필수 입력 NULL, 계산 불가 | 013, 015, 020(`AR050`) |
| 위험 #3(`:377`) | 입력 모델과 저장 스키마 불일치 | 013, 006, 046 |
| 위험 #4(`:378`) | `FOR ALL`로 결과 행 직접 쓰기 | 001, 002 |
| 위험 #5(`:379`) | 비원자 차감, 환불 없음 | 001, 002, 047, 048 |
| 위험 #6(`:380`) | 라이선스 파일 위조 | 040, 041, 059 |
| 위험 #7(`:381`) | 로컬 SQLite로 오프라인 권한 판정 | 041, 059 |
| 위험 #8(`:382`) | 데스크톱 번들 비밀 노출 | 004, 058, 059 |
| 위험 #9(`:383`) | 도면 수치와 판정 수치 불일치 | 020, 021, 023, 024 |
| 위험 #10(`:384`) | LLM이 만든 좌표·수치 | 018, 026, 051, 052 |
| 위험 #11(`:385`) | 낡은 규칙 팩을 최신으로 오인 | 015, 020(표제란), 037, 042 |
| 위험 #12(`:386`) | 딥링크 콜백 주입 | 062, 005, 059 |
| 위험 #13(`:387`) | 가져오기 경로 조작·과대 파일 | 006, 029, 039 |
| 위험 #14(`:388`) | Mock 로그인 배포 빌드 혼입 | 008, 058 |

### 5.4 디자인 단계·인증 단계·린 검증 → 작업

| 항목 | 출처 | 작업 ID | 게이트·비고 |
|---|---|---|---|
| 디자인 1단계 레퍼런스 | `docs/file/03-설계/디자인/DESIGN_SYSTEM.md:43` | 009 | W0 |
| 디자인 2단계 토큰·컴포넌트 | `:44` | 010 | W0-D |
| 디자인 3단계 비주얼 검토 | `:45` | 011 | 사람 판정 |
| 디자인 4단계 정답 확정 | `:46` | 012 | 화면 작업 진입 조건 |
| 인증 A Mock | `docs/file/03-설계/공용코어/AUTH_ROADMAP.md:347` | 008 | W1, P0, Opus |
| 인증 B Google + 이메일 | `:348` | 062 | G1, P0, Fable |
| 인증 C1 카카오 | `:349`, 매트릭스 `:339`(P2 선택) | 063 | G2, P2, Opus |
| 인증 C2 네이버 | `:350` | 064 | G2, P2, Fable |
| PRD 9.10절 1단계 스파이크 | `01_PRD.md` 9.10절 | 019 | W0 |
| PRD 9.10절 2단계 샘플 다운로드 | `01_PRD.md` 9.10절 | 033(+ 057 랜딩) | W4 |
| PRD 9.10절 3단계 인터뷰 | `01_PRD.md` 9.10절 | 작업 없음(사람) | D-22 자료 |
| 공용모듈 V2 | `D:/WorkSpace/platform/docs/develop_V2/arch-studio/arch-studio_develop_v2.md:66-67` | AR-V2-01, AR-V2-02 | W1 맨 앞, E2E 웨이브 |

## 6. 공용 모듈 요청

| # | 요청 | 대상 | 이유 | 시점(막는 작업) |
|---|---|---|---|---|
| R-A1 | C-1 = T-C3: `payment_orders.kind`에 일회성 상품 결제 종류, 상품 참조와 금액 검증 | `_supabase-modular/migrations/0002_core_billing.sql`, `CORE_SPEC.md` | 영구 라이선스 결제(D-3, `01_PRD.md 8.1절`, `D:/WorkSpace/platform/docs/Tauri/README.md:374`) | W2(043 영구 SKU 경로) |
| R-A2 | C-2 = T-C5: BYOK 데스크톱 예외 여부 | `SECURITY_BASELINE.md` | AR-F-023(D-10). MVP는 BYOK 없이 설계 | Phase 2 |
| R-A3 | C-3 = T-C4: 라이선스 서명 키 규격(`kid`, 교체, 공개키 배포)과 업데이트 서명키 관리 | `_platform-core`(신규 절) | `01_PRD.md 8.1절`, `D:/WorkSpace/platform/docs/Tauri/README.md:375` | W2(040, 041, 042) |
| R-A4 | C-4: app `arch`, 플랜 3종, 크레딧팩 3종 seed | `_supabase-modular/seed.sql` | `01_PRD.md 8.1절`. 반영 전에는 조각 seed 절이 do nothing으로 넣는다 | W0(001) |
| R-A5 | C-5: 공용 WeasyPrint 렌더 계약 `app_id`에 `arch` 추가 | `SHARED_MODULES.md:280`(`'publishing' \| 'astro'`), 소유 flora-publishing | 제안서 PDF(`02_ARCHITECTURE.md:284`) | W3(032 머지) |
| R-A6 | T-C1: `requireSession`이 `Authorization: Bearer` 검증 | `SHARED_MODULES.md` auth, `packages/core-auth` | 셸은 쿠키 세션이 없다(`D:/WorkSpace/platform/docs/Tauri/README.md:372`) | W1(007, 008) |
| R-A7 | T-C2: Route Handler CORS 허용 목록 규격(셸 출처, 와일드카드 금지) | 같음 | `D:/WorkSpace/platform/docs/Tauri/README.md:373` | W1(007) |
| R-A8 | T-C6: Supabase Redirect URLs에 앱 스킴(`archstudio://auth/callback`)·루프백 등록 절차 | `AUTH_ROADMAP.md` | D-15 미확인 항목(`01_PRD.md 8.2절`) | G1 전(062) |
| R-A9 | T-C8: 셸용 로그인 마무리 엔드포인트(`finishLogin`) | `packages/core-auth` | `POST /api/auth/finish`가 웹 콜백과 같은 검사를 쓰게 한다(`D:/WorkSpace/platform/docs/Tauri/README.md:378`) | W1(008) |
| R-A10 | T-C7: 네이버 브리지용 1회용 교환 코드 | `packages/core-auth`, `AUTH_ROADMAP.md` 7.2절 | D-18이 브리지일 때만 | W8(064) |
| R-A11 | `DB_CONVENTIONS.md` 2장 번호 표 2400 행을 "PRD 초안, 조각 없음" → "조각 있음(`2400_arch.sql`)"으로, 1장 SQLSTATE `AR`의 "(제안)" 해제 | `docs/file/03-설계/공용코어/DB_CONVENTIONS.md:43`, `:22` | 05장 조각 작성 완료 반영 | W0(001) |
| R-A12 | `HERO_3D.md` 5장 제품별 3D 소재 표에 arch-studio 행 추가(대지 → 엔벨로프 솟음·일조사선 깎임 → 매스 적층 → 배치도 선, 모바일 절충: 엔벨로프 1회 + 매스 1개) | `docs/file/03-설계/디자인/HERO_3D.md:77-94` | 03장 4.5절 확정 소재(`03_SCREENS_UX.md:603`)가 공용 표에 없다 | W0-D(057 전) |
| R-A13 | `AUTH_ROADMAP.md` 8장 arch 행의 `arch`(제안) 확정, 11장 적용 순서 표에 arch-studio 추가 | `AUTH_ROADMAP.md:339`, 11장 | 매트릭스 행은 있으나 적용 순서가 없다 | W1(008) |
| R-A14 | `REFERENCES.md`에 arch-studio 절 추가(CAD·건축 도구 레퍼런스 URL 확인 후) | `docs/file/03-설계/디자인/REFERENCES.md` | 지금은 다른 제품 절만 인용한다(제안: 3.19절 패턴 출처를 한곳에 둔다) | W0-D(009) |

반영 현황(2026-10-16): R-A1~R-A14 모두 남음. R-A13은 매트릭스 행만 이미 있다(`AUTH_ROADMAP.md:339`).

## 7. 완료 정의

| 항목 | 기준 |
|---|---|
| 빌드·타입·린트 | `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` 통과(웹 `pnpm --filter ./apps/web build`, 데스크톱 `pnpm --filter ./apps/desktop tauri build` 포함) |
| Rust | `apps/desktop/src-tauri`에서 `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo audit` 오류 0 |
| Python | `pytest apps/api -k arch && ruff check apps/api` 통과(그래프 평가셋, 토큰·조직 격리, 라우팅) |
| DB | `supabase db reset` 오류 0, `node check.mjs --vector` 모듈러·모놀리스 OK(`D:/WorkSpace/platform/docs/products/_tools-sqlcheck`), `node scripts/test-rls/run.mjs --target mod` / `--target mono`에서 `rls_smoke.sql` 전 항목 통과 |
| 도면 | `pnpm --filter ./packages/drafting test:golden`(바이트 비교) + `golden.yml`의 ezdxf `audit` 오류 0(골든 20건 이상), 수치 일치 속성 테스트 불일치 0, 성능 예산(시트 1장 p95 1초, PDF 10장 p95 10초) 측정 기록 |
| 판정 | 규칙 팩 골든(신·구 일조사선 쌍 포함) 통과, 평가셋 정량 98%(제안) 기록 |
| 결제 | AR-06-045 `npx playwright test e2e/billing`(Toss 테스트 키) 통과 |
| E2E | AR-06-061 `npx playwright test e2e/flows`, AR-06-060 데스크톱 E2E 시나리오 5개 이상 통과(Mock 페르소나) |
| 보안·배포 | AR-06-059 위반 0, AR-06-058 비밀·인증 금지 문자열 검사 0건, 서명된 설치 파일·업데이트 매니페스트 생성 |
| 디자인 | 4단계 완료(011 사람 판정 기록 포함), `DESIGN_PRINCIPLES.md` 체크리스트, 3D 히어로 `HERO_3D.md` 4절 |
| 법·문구 | PRD 6.1·9.7절 금지 문구 0건(랜딩·화면·제안서·표제란), 표제란 고지 제거 경로 0 |
| 인증 | G1: `AUTH_ROADMAP.md:177-184` 6조건(MVP P0 완료, Mock E2E 녹색, RLS 스모크·`outsider` 거부, 결제 E2E, 단계 분기 0, 외부 준비)을 사람이 판정해 `[DECISION] G1 통과` → 062 → B-1~B-6. G2: `:223-229`(Google 2주, 오류율 1% 미만 제안, 미엔타이틀먼트 0, 제공자 준비) 판정 `[DECISION] G2 통과` → 063·064 |
| 작업 | 2장 P0 작업 전부 완료, 각 수용 기준 확인 기록. P1(026~029, 052)은 MVP 출시 직후 |

### 7.1 P0 작업 ↔ 테스트 대응

| P0 작업 | 테스트(같은 작업 안 / 테스트 작업) |
|---|---|
| 001 | 002 RLS 스모크, sqlcheck |
| 003, 004 | 058 CI(린트 경로 규칙, CSP·`VITE_` 허용 목록 빌드 검사) |
| 005, 006, 007, 017 | 자체 단위·`cargo test`, 060 데스크톱 E2E |
| 008 | 061 페르소나 E2E, 058 금지 문자열 검사 |
| 009~012 | 010 axe·스크린샷, 011 사람 판정 기록 |
| 013 | 자체 스키마 스냅샷, 046 동치 테스트 |
| 014, 015, 016, 018 | 자체 속성·골든 테스트, 판정 벤치 |
| 019 | 스파이크 통과 기준(3건 열림, 치수 일치) |
| 020~025 | 021 골든 CI(ezdxf audit, 바이트 비교), 수치 일치 속성 테스트 |
| 030, 034, 035, 036, 037, 038, 039 | 060 데스크톱 E2E, 자체 컴포넌트 테스트 |
| 031 | 002(`AR042`), 자체 Route Handler 테스트 |
| 032, 051, 053, 054, 056 | 061 통합(가짜 제공자, 환불), 049 AI 보안 |
| 033 | 058 CI 복사 검증(골든 해시 = 게시 파일 해시) |
| 040, 041, 042, 043, 044 | 045 결제 E2E, 002, 059 보안 점검, 060(3대째 거부·폴백) |
| 046, 047, 048, 049, 050 | 049 보안·라우팅, 050 평가셋, 061 |
| 055, 057 | 060·061 화면 흐름, `HERO_3D.md` 4절 점검 |
| 058, 059, 060, 061, 045, 062 | 그 자체가 검증 작업. 062는 B-1~B-6 + 060·061 재실행 |
| AR-V2-01, AR-V2-02 | V2 문서 6장 검증 항목, 채택 모듈 계약 테스트 |

## 8. 설득형 랜딩·플랫폼 검증 작업 (2026-10-17, 검토용)

요구는 01장 10.1절(AR-F-039~042), 결정은 01장 10.3절(D-27~D-30), 화면은 03장 7장, 공용 규칙은 `docs/file/03-설계/디자인/LANDING_PERSUASION.md`다. DB 변경과 코어 요청은 없다. 1~7장은 그대로 두고(줄 번호 인용 보호) 추가분을 이 장에 모았다.

### 8.1 작업 목록 (2절과 같은 열)

| ID | 작업 | 소유 파일/디렉토리 | 선행 작업 | 우선순위 | 규모 | 권장 모델 | 수용 기준 | 출처 |
|---|---|---|---|---|---|---|---|---|
| AR-06-065 | 랜딩 설득 칸("막히는 지점과 원인", "왜 Arch Studio인가" 판정표), 판정 갱신 화면 기록 게시(예시 대지 1), 057 랜딩에 장착 요청(1줄) | `web/src/features/landing-proof/**`, `web/public/proof/**`, `scripts/proof/**` | 057, 033, 036, 037, 069, 066(장부 상태), 01장 D-27·D-30 확정 | P0 | M | Sonnet | 01장 AR-F-039 수용 기준. 게시 문장이 장부 "검증"과 일치(`scripts/proof/check-claims.mjs`, CI). 화면 기록은 실제 앱(예시 대지 1) 편집 없는 녹화. 우리 열 △ 1개 이상. 01장 6.1·9.7·10.2절 금지 문구 0, 도구 이름·로고 0, 다른 회사 랜딩 문구 0 | AR-F-039 |
| AR-06-066 | 주장 장부와 필요성 검증: 장부(03장 7.3절 초안 이관), V0 질문지(PRD 9.10절 3단계 인터뷰에 제안 준비 질문 추가), V1 측정 양식(베타 5명, 예시 대지). 인터뷰·측정 진행은 대표님(사람) | `docs/arch-studio/experiments/claims-ledger.md`, `docs/arch-studio/experiments/v0-interviews.md`, `docs/arch-studio/experiments/v1-task-timing.md` | 없음(V0). V1은 060 E2E 녹색 뒤 같은 task를 다시 연다 | P0(장부·V0), P1(V1) | S | Haiku | 장부 열이 `LANDING_PERSUASION.md` 3.4절과 같다. V0 결과를 `[DECISION]`으로 기록(D-22 자료와 같은 기록에), 판정 기준 확정. 참여 사무소 실명 기록 0 | AR-F-040 |
| AR-06-067 | 도입 단계 탭(`/pricing` 위쪽): 4단계 두 줄 타임라인, 구독·영구 교차점 표. 057의 `/pricing`에 장착 요청(1줄) | `web/src/features/adoption-steps/**` | 057, 069, 01장 D-29 | P1 | S | Sonnet | 01장 AR-F-041 수용 기준. 가격·크레딧이 요금 상수와 일치(하드코딩 0), 체험 만료 후 열람·내보내기 유지 문구, 탭 키보드 이동 | AR-F-041 |
| AR-06-068 | 제안 준비 시간 비교 계산기 `/tools/proposal-time` | `web/src/app/(marketing)/tools/**`, `web/src/features/proposal-time/**` | 057, 069, 01장 D-28 | P1 | M | Sonnet | 01장 AR-F-042 수용 기준. 계산 함수 단위 테스트(01장 4.2절 교차점 18·19개월, 2·3년 총액), 입력값 전송 0(E2E 요청 본문 검사), 출처 없는 기본값 0, 큰 숫자 타일 0 | AR-F-042 |
| AR-06-069 | 마케팅 컴포넌트 8종(문의 버튼 제외) | `web/src/components/marketing/**` | 012 | P0 | S | Sonnet | 03장 7.7절, `DESIGN_SYSTEM.md` 8장 템플릿, 토큰 밖 색 0, `packages/ui`에 넣지 않음, 표는 `<table>`·`scope`, 키보드 접근 | 03장 7.7절 |

### 8.2 웨이브

| 작업 | 웨이브 | 이유 |
|---|---|---|
| 066 | W0 | 질문지·장부는 개발 없이 준비. 인터뷰는 PRD 9.10절 3단계(W2~W4)와 한 번에 진행. V1은 060 뒤 |
| 069 | W4 | 012(W0-D) 뒤, 화면 작업과 병렬 |
| 065, 067 | W6 | 057(W5) 뒤. 065는 공개 베타 전 필요(P0) |
| 068 | W8 | P1, 공개 베타 뒤 |

### 8.3 기존 작업과 달라진 점

| 작업 | 이전 | 지금 |
|---|---|---|
| 057 | 랜딩 5섹션, `(marketing)/**` 소유(`samples/` 제외) | 7섹션 배치(03장 7.1절), 추가 섹션은 065·067이 장착. 소유에서 `tools/` 제외 |
| 5.4절 PRD 9.10절 3단계 인터뷰 | 작업 없음(사람) | 066이 질문지·기록 양식을 맡고 인터뷰는 그대로 사람이 진행 |
| 코어 요청 | - | 없음 |

## 9. 웹·설치형 하이브리드 작업 (2026-10-28, ADR-001)

결정은 `docs/file/03-설계/ADR-001_DELIVERY_AND_LICENSING.md`(이하 ADR-001), 제안 ID는 ADR-001 7장이다. 이 장은 1~8장을 고치지 않고 추가분만 둔다(줄 번호 인용 보호). 작업 합계는 기존 71개 + 13개 = 84개다. ADR-001의 070~079에 `071a`(스파이크)가 있고, 좌석 관리(D-H1)·휴대폰 본인인증(D-H2)은 ADR-001 7장에 ID가 없어 `074a`·`074b`로 부여했다(팀장 확인 필요). `미확인` 표시는 근거 확인 전 값이다.

### 9.1 작업 목록 (2절과 같은 열)

| ID | 작업 | 소유 파일/디렉토리 | 선행 작업 | 우선순위 | 규모 | 권장 모델 | 수용 기준 | 출처 |
|---|---|---|---|---|---|---|---|---|
| AR-06-070 | 플랫폼 어댑터 5종 인터페이스(`ProjectStore`·`FileGateway`·`SecureStore`·`EntitlementClient`·`Updater`) + `capabilities` + 설치형(`tauri/`) 구현 이전. 005의 `packages/shell-bridge/src/**` 소유를 이어받음(task `log.md` 1줄 요청) | `packages/shell-bridge/src/{adapters,tauri}/**` | 005, 006 | P0 | M | Opus | 화면 코드가 `platform === 'web'` 직접 검사 0(린트). `capabilities`로만 분기. 설치형 기존 단위 테스트 통과, 어댑터 5종 계약 테스트가 `tauri/`·`web/` 양쪽에 같은 케이스를 돌릴 수 있는 하네스 | ADR-001 2.1절, 7장 |
| AR-06-071a | W0 스파이크 1주: `packages/features` 라우트 정의를 Vite(설치형)와 Next.js `(studio)`가 공유하는지 확인. 실패 시 Vite SPA 하나 + web 어댑터 + 정적 호스팅 | `spikes/studio-shell/**`(버리는 코드, 019와 같은 규칙) | 003, 004 | P0 | S | Opus | `[DECISION]` 1건(공유 가능 / SPA 대안)과 근거 측정(번들 크기·라우터 차이 흡수 방법). 071의 구조가 이 결정에 의존. 실현 가능성 `미확인` | ADR-001 2장 경계 규칙 |
| AR-06-071 | 웹 스튜디오 셸 `(studio)`: 별도 서브도메인(`app.`, 기본값)·라우트 그룹·엔진 워커 생성·스튜디오 전용 CSP(`wasm-unsafe-eval`만, `unsafe-eval`·`unsafe-inline` 스크립트 금지)·쿠키 세션 시 CSRF·SVG 정화 | `web/src/app/(studio)/**`, `web/src/lib/studio/**`(`lib/auth` 제외), `web/next.config.ts`의 스튜디오 헤더(003에 1줄 요청) | 070, 071a, 003, 008 | P0 | L | Fable | 마케팅·계정 페이지 CSP에 `wasm-unsafe-eval` 0. 스튜디오 번들에 비밀 0(`VITE_`/`NEXT_PUBLIC_` 허용 목록 검사 확대). 쿠키 세션과 Bearer 혼용 0. 로그인 없이 `(studio)` 접근 시 거부. 노출 면 위협 메모는 ADR-001 5장 표를 따름. 서브도메인 vs 같은 출처는 예외로 팀장 승인 | ADR-001 2장, 5장 |
| AR-06-072 | 웹 어댑터(`web/`): `ProjectStore`(클라우드 + IndexedDB 읽기 캐시), `FileGateway`(`<input type=file>`·File System Access API·다운로드 Blob, 크기 상한 DXF 20MB·IFC/.3dm 100MB 동일), `SecureStore`(메모리 + httpOnly 쿠키), `EntitlementClient`(서버 조회), `Updater`(없음) | `packages/shell-bridge/src/web/**` | 070, 073 | P0 | M | Opus | 070 계약 테스트 5종 통과(웹 쪽). IndexedDB는 읽기 캐시만, 편집 캐시를 서버로 올리는 호출 0. 로그아웃 시 캐시 삭제. 토큰 `localStorage` 0건. 크기 상한 초과는 읽기 전 거부 | ADR-001 2.1절, 3.1절 |
| AR-06-073 | 클라우드 프로젝트 blob 저장: `arch.cloud_projects`(단일 blob, `project_uuid` 정본, `local_id` nullable), 업서트 `(org_id, project_uuid)` + `expected_version` 충돌 거절, 목록·열기 API, RLS. 스키마 변경은 001 소유 규칙(1장)의 예외이므로 팀장 결정 필요 | `supabase/**` 신규 번호 조각(적용된 파일 수정 0), `web/src/server/cloud-projects/**`, `web/src/app/api/cloud-projects/**` | 001, 002, 003 | P0 | M | Fable | `expected_version` 불일치 시 거절 + 저장 안 됨(테스트). 다른 조직 행 0건(RLS 스모크에 추가). 본문 크기 상한, 본문 로그 0. 충돌 대화상자 선택지 2개("내 변경을 사본으로 저장"·"서버 최신 열기")를 API가 지원. 용량 한도 값은 Q4 전 `미확정` | ADR-001 3장, 5장 표 2행, 7장 |
| AR-06-074 | 라이선스 3종(영구·기간제·구독) 서버 판정: `license_skus`에 `term_*`·연 구독 코드, `licenses.term_ends_at`(제안 이름), 웹 `arch.org_features` 판정(영구는 업데이트 유효 기간 포함), 라이선스 파일 `sku` 코드·`offline_valid_until ≤ 종료일` clamp, 동시 보유 우선순위(영구 > 구독 > 기간제 > 체험), 결제 화면 영구-웹 안내·동의 체크(D-H4) | `supabase/**` 신규 번호 조각, `web/src/server/{licenses,checkout}/**`, `rust/src/license.rs`의 필드(041에 요청), 결제 화면 문구 | 040, 041, 043, 073 | P0 | L | Fable | 상태별 접근 매트릭스(영구 유효·영구 업데이트 만료·기간제·구독·체험 x 설치형·웹) 통과. 만료 후 열람·내보내기 유지, 웹 편집 거부. 시계 조작 수용(D-H3), 오프라인 AI·클라우드 불가. 가격·전환·환불 값은 Q3 전 `미확정`, 하드코딩 0 | ADR-001 4.1~4.5절, 7장 |
| AR-06-074a | 좌석 관리(D-H1): `licenses`/`org_features`에 `seats` 컬럼(판매 시작 전 스키마), 조직 멤버 좌석 배정·회수, 좌석 초과 시 웹 로그인·설치형 활성화 거부 판정, 추가 좌석 구매 경로 | `supabase/**` 신규 번호 조각, `web/src/server/seats/**`, `feat/seats/**` | 074 | P0 | M | Fable | 라이선스 1개 = 사용자 1명(웹 + PC 2대) 판정 테스트. 미배정 멤버 거부, 회수 후 재배정, `outsider` 거부(RLS). 좌석 변경은 `member`가 못 한다(42501). 웹 동시 세션 수·캐시 TTL은 Q6 전 `미확정` | ADR-001 4.1절, 9장 D-H1 |
| AR-06-074b | 휴대폰 본인인증 크레딧(D-H2): 체험은 이메일로 시작, 가입 크레딧 30은 본인인증 1회당 1번만 지급(멱등 키), 인증 제공자 연동. 제공자·비용·개인정보 보관 형태(번호 원문 금지, 식별값 해시 여부)는 `미확인`·팀장 결정 필요 | `web/src/lib/auth/phone/**`, `web/src/app/api/auth/phone/**`, `supabase/**` 신규 번호 조각(원장 지급 RPC) | 008, 074, 새 의존성 `secscan license` | P0 | M | Fable | 같은 인증 식별값으로 재가입 시 크레딧 원장 추가 0행. 지급 요청 재전송이 멱등. 번호·식별값 로그 0, 인증 코드·토큰 로그 0. 미인증 계정은 체험 가능, 가입 크레딧 0. 개인정보 분류는 `09_SECURITY_PLAN.md` 2장 | ADR-001 9장 D-H2 |
| AR-06-075 | 규칙 팩 서버 분리 + 웹 자격 게이트: 팩을 엔진 패키지 밖(서버 배포 데이터)으로 분리, 서명 URL 15분, 팩 다운로드 레이트 리밋(수치 `미확정`), 운영 소스맵 비공개. CI 번들 검사에 "엔진 번들에 팩 0바이트" 추가 | `packages/rules/src/loader/**`(015에 요청), `scripts/rule-packs/**`, `web/src/server/rule-packs/**`, `.github/workflows/bundle-check.yml`, `scripts/ci/bundle-check.mjs` | 015, 042, 071 | P0 | M | Fable | 엔진 번들 분석에서 팩 바이트 0(CI 실패 조건). 자격 없는 계정의 팩 요청 거부(체험은 허용). 운영 소스맵 공개 경로 0. 팩 자체는 평문 노출이 전제이므로 복제 억제는 최신성·서버 기능에 한정(ADR-001 5장 사실 정정). 비로그인 체험 범위는 Q7 전 로그인 필수 | ADR-001 5장 |
| AR-06-076 | `/download` 페이지·릴리스 채널: 듀얼 CTA("Windows용 다운로드(x64)"·"웹에서 바로 시작"), OS 감지(Mac·Linux "준비 중", 모바일 "웹 열기" + PC로 링크 보내기), `latest.json`(Tauri updater 형식) 버전·배포일·크기·릴리스 노트, SHA-256 체크섬 + Authenticode 게시자명, 시스템 요구사항 펼침 | `web/src/app/(marketing)/download/**`, `web/src/features/download/**`, `scripts/release/latest-json.mjs` | 057, 058, 069 | P0 | M | Sonnet | `latest.json`이 058 릴리스 산출물과 일치(CI 비교). 체크섬 표시가 실제 파일과 일치. 두 CTA 같은 무게(받은 시안 정본, 057 랜딩 CTA 교체 요청 1줄). 01장 6.1절 금지 문구 0. 메모리 요구 기준 `미확인` | ADR-001 6장 |
| AR-06-077 | 로컬 ↔ 클라우드 수동 업로드·내려받기(설치형): 최초 1회 새 `project_uuid` 발급(사본), 이후 같은 `local_id`는 업서트. 자동 양방향 동기화는 Phase 2 | `feat/cloud-sync/**`, `rust/src/commands/local_db.rs`의 `local_id` 매핑(006에 요청) | 034, 073, 072 | P1 | M | Opus | 업로드 후 원본 유지, 재업로드는 같은 행 `version+1`. 충돌 시 거절 + 2선택. 설치형 클라우드 모드 오프라인은 읽기 전용 + "로컬로 복사해 편집" 안내. 만료 후 클라우드 → 로컬 내려받기 허용. 전체 프로젝트 일괄 내려받기(zip, MVP, 승인 2026-10-28): 진행률 표시(실제 처리 건수, 가짜 진행률 금지), 실패 시 재시도(실패 항목만), 만료·폴백·미배정·회수 사용자도 402 없이 성공 | ADR-001 3장, 3.1·3.3절 |
| AR-06-078 | Excel/CSV 내보내기(`AR-F-044`): 면적표·판정표·공사비 표 등 PRD 13장 044 범위.(MVP 확정 2026-10-28) | `packages/io/src/tabular/**`, `feat/export-table/**` | 038, 015, 072 | P0 | M | Opus | 웹·설치형 같은 파일 출력(바이트 동일 골든). CSV 수식 주입 방어(`=`·`+`·`-`·`@` 접두 처리). 한글 깨짐 0(BOM 정책 `[DECISION]`). 043·045·046은 Phase 2라 포함 0 | ADR-001 1장 ⑤, 9장 Q1 |
| AR-06-079 | 웹 E2E·브라우저 매트릭스: Playwright(웹) + WebDriver(설치형) 동등성 시나리오, 지원 브라우저 Chrome·Edge·Safari·Firefox 최신 2개 버전(제안), 브라우저 간 PDF·PNG·폰트 골든 비교 기준 신설 | `e2e/web-parity/**`, `tests/browser-matrix/**` | 060, 061, 071, 072, 074 | P0 | L | Sonnet | 동등성 시나리오(로그인 → 대지 → 매스 → 판정 → 시트 → 내보내기)가 웹·설치형 양쪽 통과. 매트릭스 4개 브라우저 x 최신 2개 버전 결과표. 골든 비교 허용 오차 `[DECISION]`. 실패 주입 시 같은 화면 문구 | ADR-001 7장 QA 행 |

### 9.2 웨이브

| 작업 | 웨이브 | 이유 |
|---|---|---|
| 071a | W0 | 071 구조를 정하는 스파이크(1주). 019와 병렬 |
| 070 | W1 | 005·006 뒤. W4 화면 작업이 어댑터 주입 지점을 쓰기 전에 끝나야 함 |
| 073 → 072, 071 | W2 | 073(저장 정본) 뒤 072. 071은 070·071a 뒤 |
| 074 → 074a, 074b, 075 | W3 | 074는 040·041·043(W2) 뒤. 074a·074b는 074 뒤. 075는 015·042·071 뒤 |
| 077, 078 | W5 | 077은 034(W4)·073 뒤, 078은 038(W4) 뒤 |
| 076, 079 | W6 | 076은 057(W5)·058 뒤. 079는 060·061 뒤이며 045와 병렬 |

### 9.3 기존 작업 영향

| 대상 | 변경 |
|---|---|
| W4 화면 작업 026, 028, 029, 031, 034, 035, 036, 037, 038, 044 (10건) | 데이터·파일 접근을 070 어댑터 주입으로만 한다(`packages/features`가 `apps/*`·Tauri·Supabase를 직접 import하면 린트 실패). 웹 셸에서 화면이 열리는 확인 1건씩 추가. 034는 클라우드 사본·저장 모드, 044는 3종·좌석 상태를 표시 |
| W5 화면 작업 027, 030, 032, 039, 052, 055, 056 (7건) | 같은 추가. 030 ExportDialog는 `FileGateway`만 쓴다. 039의 3D 입출력은 웹 파일 크기 상한 동일 |
| 057 | `/download` 듀얼 CTA 장착 요청(076) |
| W6 E2E 060, 061 | 웹 E2E는 `(studio)` 진입 포함. 060·061 위에 079가 동등성·브라우저 매트릭스를 얹음 |
| 001, 002, 040, 041, 043 | 스키마 변경(073·074·074a·074b)에 따라 RLS 스모크(002)에 `cloud_projects`·`seats` 추가, 041의 라이선스 파일 필드 확장. 1장 "스키마는 001만" 규칙 예외는 팀장 결정 필요 |
| 일정 | ADR-001 7장 표시: W4·W5 화면 작업에 웹 어댑터·E2E 추가 부담(위 17건, ADR-001의 "약 20건"과 차이는 기능 화면 판정 기준 차이로 팀장 확인 필요). 일정 재산정 `미확인` |
| 일정 영향 없는 작업 | 069, 033, 065, 067, 068(마케팅·랜딩)은 영향 없음 |
