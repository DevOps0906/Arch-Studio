# 07 원본 이식과 폐기: Arch Studio (arch-studio)

작성일 2026-10-16.

신규 제품이라 원본 저장소·원본 리뷰가 없다(`docs/products/arch-studio/README.md:19`). 이 장의 "원본"은 README 3장 이식 원천 5개(nomad-docs, flora-publishing, `_platform-core` AI 계층, `_design-guide` 3D 히어로, FortuneDocs 원칙, `README.md:31-37`)다. 원천이 모두 문서라 코드 복사는 없고, 규칙·수치를 옮겨 새로 작성(이식)하거나 패턴만 보고 새로 작성(참고)한다. 원천은 수정하지 않는다(5절).

근거 표기: `PRD:줄` = `docs/products/arch-studio/01_PRD.md:줄`, `README:줄` = 같은 폴더 `README.md`, `Tauri:줄` = `docs/Tauri/README.md:줄`, `SB:줄` = `docs/products/_platform-core/SECURITY_BASELINE.md:줄`, `AI:줄` = `docs/products/_platform-core/AI_ARCHITECTURE.md:줄`, `FD:줄` = `docs/reviews/FortuneDocs.md:줄`, `ND:줄` = `docs/products/nomad-docs/01_PRD.md:줄`, `NDC:줄` = `docs/products/nomad-docs/CLAUDE.md:줄`. 그 밖은 전체 경로. 근거 없는 판단은 "제안"+이유, 확인 안 한 외부 라이선스는 "미확인".

## 1. 원본별 자산 분류

상태(동작/부분/목업/기획만), 처리(이식/참고/폐기)는 `docs/products/_platform-core/DOC_TEMPLATE.md:297` 기준. 원천은 모두 "기획만"이라 상태 열을 생략하지 않고 그대로 둔다. 폐기 행의 근거는 3절 ID.

### 1.1 nomad-docs (설계)

| 자산 | 상태 | 처리 | 대상 위치 | 근거 |
|---|---|---|---|---|
| 효과 엔진 `computeEffects`(TS 순수 함수, LLM 0회, 사용자 수정 행 보존, 멱등) | 기획만 | 참고(원칙·테스트 방식만, 규칙은 건축 도메인으로 신규) | `packages/program/src/**` | ND:178, ND:184, NDC:22, PRD:53 |
| "숫자는 DB가 계산"(클라이언트·LLM 숫자 저장 금지) | 기획만 | 참고(계산 주체를 로컬 엔진으로, 도면 좌표까지 확장) | `packages/{rules,program,drafting}/src/**` | NDC:21, PRD:54, PRD:338 |
| 고위험 문서 템플릿 전용 | 기획만 | 참고(제안서 수치 섹션은 템플릿, 서술만 LLM) | `packages/features/src/proposal/**`, `workers/arch-jobs/src/**` | NDC:20, PRD:56 |
| 문서 묶음 생성 | 기획만 | 참고(도면 묶음은 로컬 0크레딧) | `packages/drafting/src/sheet/**` | ND:293, PRD:355 |
| 회의 녹음 → 요구사항 후보(오픈소스 STT 강제, 제3자 고지, 24시간 삭제, 확인 전 정본 0행) | 기획만 | 참고 | `packages/features/src/voice/**`, `apps/api/app/ai/graphs/arch_intake.py` | ND:117, ND:453, PRD:57 |
| 작업 단위 정액 크레딧 값(채팅 1, 템플릿 PDF 1, STT 분당 1), pack 소멸 없음 | 기획만 | 이식(값·규칙 문장) | `apps/web/src/server/ai/**` | ND:367-374, ND:399, PRD:141-144, PRD:157 |
| 서술 새 수치 lint `L-AI-CLAIM`, 진행률은 서버 보고 값만 | 기획만 | 참고 | `apps/api/app/ai/compliance/arch.py`, `packages/features/src/{render,review}/**` | ND:288, NDC:72 |
| 개발 외주 문서 카탈로그 | 기획만 | 폐기 | - | ARX-01 |
| CRM 연동·CRM형 워크스페이스·ERP 연동 | 기획만 | 폐기 | - | ARX-02 |

### 1.2 flora-publishing (설계)

| 자산 | 상태 | 처리 | 대상 위치 | 근거 |
|---|---|---|---|---|
| 선차감 → 잡 → 실패 자동 환불(멱등 키, `fail_job`) | 기획만 | 참고(`arch.start_ai_run`/`finish_ai_run`/`fail_ai_run`으로 감쌈) | `supabase/**`, `apps/web/src/server/ai/**`, `workers/arch-jobs/src/**` | `docs/products/flora-publishing/01_PRD.md:103`, `:229`, `docs/products/flora-publishing/02_ARCHITECTURE.md:145`, `:409` |
| 공용 WeasyPrint 렌더(Noto CJK, `url_fetcher` 허용 목록) | 기획만 | 참고(소비자로 호출만) | `workers/arch-jobs/src/**`(`arch.proposal_pdf`) | `docs/products/_platform-core/SHARED_MODULES.md:264-274` |
| 판형·표지·ePub | 기획만 | 폐기 | - | ARX-03 |

### 1.3 `_platform-core` AI 계층

| 자산 | 상태 | 처리 | 대상 위치 | 근거 |
|---|---|---|---|---|
| LangGraph 규칙(위치, `<app>.<graph>`, 마지막 compliance, 서명 토큰 범위 도구) | 기획만 | 참고 | `apps/api/app/ai/graphs/arch_{review,intake,layout}.py` | AI:113, AI:117, AI:119 |
| pgvector RAG, 인젝션 방어, 평가셋 | 기획만 | 참고(법령·지구단위계획 컬렉션 신규) | `apps/api/app/ai/products/arch/**` | AI:94 |
| 모델 라우팅 이원화, 국외 이전 동의 | 기획만 | 참고(seed에 `arch.*` 기능 키, C-4) | `supabase/**` seed | AI:73, AI:86, PRD:312 |
| compliance 노드 | 기획만 | 참고(사전은 PRD 6.1·9.7절로 신규) | `apps/api/app/ai/compliance/arch.py` | AI:117, PRD:238, PRD:457 |
| 선차감·정산·실패 환불 | 기획만 | 이식(규칙 문장) | `arch.start_ai_run` 계열 | AI:125, AI:129, PRD:191 |

### 1.4 `_design-guide` 3D 히어로

| 자산 | 상태 | 처리 | 대상 위치 | 근거 |
|---|---|---|---|---|
| 구현 규칙(동적 import, 화면 밖 정지, 코드 생성 형상, `aria-hidden`, reduced-motion 정지 이미지, 토큰 색) | 기획만 | 참고 | `apps/web/src/components/hero3d/**` | `docs/products/_design-guide/HERO_3D.md:43-54` |
| 장면 키트(로더, 재질, 조명, 대체 이미지, 성능 모니터) | 기획만 | 참고(`packages/ui-3d`가 생기면 소비) | `apps/web/src/components/hero3d/**`, `apps/web/public/hero/**` | `docs/products/_design-guide/HERO_3D.md:56-68` |
| 랜딩 수용 기준 | 기획만 | 이식(문장 그대로 06장 랜딩 작업에) | 06장 | `docs/products/_design-guide/HERO_3D.md:70-75` |

### 1.5 FortuneDocs 원칙 (기획만, 약 40%)

| 자산 | 상태 | 처리 | 대상 위치 | 근거 |
|---|---|---|---|---|
| 결정적 수치는 서버가 계산해 주입, LLM은 서술만 | 기획만 | 참고(규칙엔진·프로그램·도면 엔진이 계산) | `packages/{rules,program,drafting}/src/**` | FD:21, FD:47, README:37 |
| 순수 함수 엔진 + 경계값 회귀 세트 | 기획만 | 참고(골든 테스트) | `packages/rules/golden/**`, `packages/drafting/golden/**` | FD:67, FD:97 |
| 생성 트랜잭션 순서(인증 → 소유 → 원자 차감 → 계산 → 스키마 검증 → 저장 → 실패 환불) | 기획만 | 참고 | `apps/web/src/server/ai/**` | FD:68 |
| 템플릿 하나를 화면·PDF 공유, 인라인 SVG | 기획만 | 참고(미리보기 SVG = 시트 SVG = 제안서 SVG) | `packages/drafting/src/writers/svg/**` | FD:54, FD:70 |
| 사주 도메인 | 기획만 | 폐기 | - | ARX-04 |
| Puppeteer PDF, QuickChart, Vercel AI SDK 3사 | 기획만 | 폐기 | - | ARX-05 |

### 1.6 외부 오픈소스 (이식이 아니라 의존)

GPL·AGPL 구성요소는 설치 파일·웹 번들에 넣지 않는다(PRD:232). LGPL도 재배포 조건 확인 전에는 넣지 않는다(제안: 정적 묶음 배포에서 재링크 의무를 지키기 어렵다). 처리 열: 번들 / CI 전용 / 후보 / 미사용.

| 구성요소 | 처리 | 대상 위치 | 라이선스 | 결정·근거 |
|---|---|---|---|---|
| Manifold WASM | 번들 | `packages/geometry/src/**` | Apache-2.0(PRD:232) | 엔벨로프·매스 솔리드 |
| web-ifc | 번들(소스 무수정, 제안: 파일 단위 공개 의무 회피) | `packages/io/src/ifc/**` | MPL-2.0(PRD:232) | AR-F-016(PRD:58) |
| That Open components | 후보 | `packages/io/src/ifc/**` | MIT(PRD:232) | 안 쓰면 고지에서 뺀다 |
| rhino3dm | 번들 | `packages/io/src/rhino/**` | 미확인(PRD:232) | 02장 AR-02-D2(1주 스파이크, 실패 시 .3dm 내보내기 보류) |
| three.js, R3F, drei | 번들 | `packages/features/src/modeler/**`, `hero3d` | 미확인 | lockfile 기준 고지 |
| Tauri 2.x·플러그인, rusqlite | 번들 | `apps/desktop/src-tauri/**` | 미확인 | `cargo audit`(Tauri:212) |
| 2D 다각형 연산(후보 Clipper2 계열) | 후보 | `packages/geometry/src/**` | 미확인(포팅본마다 다를 수 있음) | 02장 AR-02-D1. GPL 포팅이면 채택 안 함(정수 좌표 자체 구현) |
| 벡터 PDF(후보 jsPDF + svg2pdf.js) | 후보 | `packages/drafting/src/writers/pdf/**` | 미확인 | D-23 (a)(PRD:482) |
| 오픈소스 JS DXF 라이브러리 | 미사용 | - | 미확인 | D-20 (b) 미채택(PRD:479) |
| Python ezdxf `audit` | CI 전용(런타임 미포함) | `.github/workflows/golden.yml` | 미확인 | D-20, PRD:380 |
| LibreCAD | 미사용(개발 PC 열람 확인만) | - | GPL 계열(미확인) | PRD:380 |
| LibreDWG 등 오픈소스 DWG, Bonsai | 미사용 | - | GPL(PRD:232, PRD:481) | D-22 (a) DXF만 |
| ODA SDK | 미사용(조건부) | - | 상용, 비용 미확인 | D-22 (b)(PRD:481) |
| 한글 글꼴 | 번들 | `packages/ui/**`, `writers/pdf` | SIL OFL 등 재배포 가능만(PRD:453) | DXF는 이름만(PRD:380) |

## 2. 이식 자산 상세

| 자산 | 수정할 점 |
|---|---|
| 효과 엔진 원칙 → `packages/program` | 실행 위치가 서버에서 데스크톱 Web Worker(`apps/desktop/src/workers/**`)로 바뀌고, 결과는 로컬 SQLite `model_revisions`의 DesignModel 새 리비전으로 저장한다. `is_user_modified` 보존은 `program.user_locked_rows[]`로 옮긴다(PRD:53). 금지 목록(시각, 난수, LLM, 네트워크, env)은 그대로이고(NDC:22) Tauri·DOM API를 import하지 않아 데스크톱·워커에서 같은 결과를 낸다. 체크리스트 카탈로그는 앱 번들 상수 + 버전(제안: 클라우드 카탈로그는 오프라인 동작을 깬다) |
| "숫자는 엔진이 계산, LLM은 해석만" → 도면 | 판정 수치 `packages/rules`, 면적표·공사비 `packages/program`, 좌표·치수 `packages/drafting`. 도면은 판정을 다시 계산하지 않고 JudgmentResult를 입력으로 받는다(PRD:371-372). LLM은 좌표를 출력하지 않는다: `arch.intake` 스키마에 좌표·면적 필드가 없고(목표 면적은 사용자 발화 인용만), `arch.layout`은 인접 의도 JSON만 내며 배치는 `packages/layout` 솔버가 한다(PRD:338, PRD:376-377). 제안서 서술에 엔진 스냅샷에 없는 수치가 나오면 compliance가 막는다(ND:288 방식) |
| 템플릿 전용 → 제안서 | 판정 요약·면적표·공사비·도면 섹션은 템플릿, LLM은 설계개요 서술만(PRD:56). 꼬리말 "법적 판정 아님"과 표제란 고지(PRD:339)는 요청 입력으로 끌 수 없다 |
| 회의 녹음 → 상담 녹음·대화형 입력 | 회의록 대신 체크리스트 답·실 목록 후보만. 항목별 채택 전 정본 0행(PRD:376). 고지문은 PRD:228 문구, 버전 기록 |
| 정액 크레딧 | nomad-docs와 같은 값(채팅 1, 템플릿 문서 1, STT 분당 1, 상담 녹음 후보 그래프 5, PRD:144)만 이식, 새 값(렌더 3·5, 업스케일 2, 검토 15, 제안서 10, 대화형 intake 2)은 제안(D-4). 단가는 `arch.start_ai_run`의 `p_variant` 상수 표와 서버 `apps/web/src/server/ai/pricing.ts`, seed가 같은 값. 도면·매스 자동 제안은 0이고 잡이 아니다(PRD:147, PRD:388) |
| flora 선차감·환불 → `arch.start_ai_run` | 시그니처 `arch.start_ai_run(p_org, p_actor, p_kind, p_variant, p_request_id, p_project_ref, p_options)`. 한 트랜잭션: `arch.org_features` 판정(폴백 검토 `AR012`) → variant 단가로 `consume_credits` → kind별 실행 행(`arch.renders`·`reviews`·`intake_runs`·`proposals`) → 잡 enqueue. 멱등 키는 `p_request_id`(제안: 데스크톱 재시도 이중 차감 방지). 데스크톱은 작업 종류·입력·request_id만 보내고 금액을 보내지 않으며 variant는 서버가 정한다(PRD:192). 시간 초과(PRD:208-209)는 정리 잡이 `fail_ai_run`으로 전액 환불. 세 함수 service_role 전용 |
| WeasyPrint → 제안서 PDF | 제안서만 공용 렌더, 도면 PDF는 로컬(D-23 (a)). 렌더는 서버 조립 HTML만 받는다(`docs/products/_platform-core/SHARED_MODULES.md:270`). 확정: 데스크톱이 로컬 시트 SVG(PRD:382)를 `POST /api/uploads/sign`(purpose `proposal_sheet`)로 올리고, Route Handler가 SVG를 sanitize하고, 워커(`workers/arch-jobs`)가 엔진 값 표·인라인 SVG·렌더 이미지로 HTML을 조립해 렌더에 보낸다(02장 4절, 04장 6.2절). 클라이언트 HTML은 렌더하지 않는다. 결과는 `arch.proposals`. 렌더 계약 `app_id`에 `arch` 추가 필요(현재 `'publishing' \| 'astro'`, 같은 파일 `:280`, PRD 코어 요청 C-5) |
| AI 계층 → 그래프 3종 | `arch.review`: 로컬 규칙엔진 결과 + RAG → 항목별 근거 → compliance, 출처 없는 문장은 `AR033` 실패·환불(PRD:50). `arch.intake`: `source` `chat`(2)·`consult`(5, feature `arch.intake_consult` 오픈소스 강제) 같은 잡, 검증 실패 1회 재시도 후 `AR032`. `arch.layout`: Phase 2. 모두 결과 저장은 service_role `finish_ai_run` 1회 |
| HERO_3D → 제품 장면 | 소재 제안: 대지 경계 → 엔벨로프가 솟고 → 매스가 앉고 → 배치도 시트가 펼쳐진다(제안: "입력하면 도면이 나온다"를 보여 준다. HERO_3D 5장에 arch-studio 행이 없어 03장 4절에서 확정 후 행 추가 요청). Manifold WASM을 랜딩 번들에 넣지 않는다(제안: 성능 예산, `docs/products/_design-guide/HERO_3D.md:32`). 카피는 PRD 6.1절 |
| FortuneDocs 원칙 → 규칙엔진 | 기준 시점 혼동(FD:40)을 막도록 적용 규칙은 시스템 시각이 아니라 `rule_context.application_date`로 고른다(PRD:47). 누락 입력은 기본값으로 계산하지 않고 "조례 미확인"·입력 요청(PRD:48). 규칙 팩 버전별 골든 테스트 |

## 3. 폐기 목록과 사유

README 3장 "버리는 것"(README:33-37)을 빠짐없이 옮기고(ARX-01~05), PRD에서 고르지 않은 선택지를 더했다.

| ID | 항목 | 원천 | 출처 | 사유 | 대체 |
|---|---|---|---|---|---|
| ARX-01 | 개발 외주 문서 카탈로그(문서 유형, `outsourcing_basic`, 조항 라이브러리) | nomad-docs | README:33, ND:101, ND:293 | 외주 개발 계약 도메인 | 제안서 + 템플릿 PDF(PRD:143) |
| ARX-02 | HubSpot CRM, CRM형 워크스페이스, ERP 연동 | nomad-docs | README:33, ND:121-122, ND:138 | 외부 OAuth 토큰 관리 증가, 로컬 정본과 안 맞음 | 로컬 `/projects` |
| ARX-03 | 판형·표지·ePub·페르소나 | flora-publishing | README:34, `docs/products/flora-publishing/01_PRD.md:34` | flora-publishing 소유 기능 | 제안서 A4 템플릿 1종 |
| ARX-04 | 사주 도메인 | FortuneDocs | README:37, FD:7 | 도메인 무관 | 규칙 팩 `packages/rules/packs/**` |
| ARX-05 | Puppeteer PDF, QuickChart, Vercel AI SDK 3사 | FortuneDocs | FD:17-18, FD:45, FD:54 | 서버리스 PDF 실패, 외부 차트, 키 분산 | 공용 WeasyPrint, SVG, ai-service 라우터 |
| ARX-06 | ezdxf 사이드카 런타임 동봉 | PRD 대안 | D-20 (c), PRD:479 | 200MB 상한(PRD:204), Python 런타임 관리, 사이드카 권한(Tauri:205) | 자체 TS DXF 작성기, ezdxf는 CI만 |
| ARX-07 | 오픈소스 JS DXF 라이브러리 | PRD 대안 | D-20 (b), PRD:479 | 라이선스 미확인, 결정성 통제 불가 | 자체 작성기(PRD:380) |
| ARX-08 | MVP DWG, GPL DWG 라이브러리 | PRD 대안 | D-22, PRD:481 | GPL 미번들, 변환 실패 | DXF만 |
| ARX-09 | GPL BIM 도구(Bonsai) 내장 | PRD 대안 | PRD:232 | 영구 라이선스와 GPL 배포 조건 불일치 | 자체 모델러 + web-ifc |
| ARX-10 | 앱 안 웹뷰 OAuth | PRD 대안 | D-15 (d), PRD:320, Tauri:37 | Google이 임베디드 웹뷰 OAuth 차단 | 시스템 브라우저 + PKCE 딥링크, 대체 루프백 |
| ARX-11 | BYOK 기본 경로 | PRD 대안 | PRD:73, D-10 PRD:299, SB:121 | 진입장벽, 검토는 서버 전용, 복제 방어 약화 | 크레딧 게이트웨이, Phase 2는 C-2 승인 후 |
| ARX-12 | LLM이 좌표·치수·면적 출력 | PRD 원칙 | PRD:338, PRD:376-377 | 치수 오류, 재현 불가 | 고정 스키마 + 결정적 엔진·솔버 |
| ARX-13 | SketchUp 역공학 라이브러리 | PRD 대안 | D-11 (b), PRD:300 | 형식 변경, 법적 위험 | .3dm·IFC·glTF |
| ARX-14 | 도면 PDF 클라우드 생성 | PRD 대안 | D-23 (b), PRD:482 | 오프라인·0크레딧(PRD:340) | 로컬 벡터 PDF |
| ARX-15 | 최적화 라이브러리 매스 탐색, 30일 온라인 확인, 시리얼만 활성화 | PRD 대안 | D-26 (b) PRD:485, D-7 (b) PRD:296, D-16 (b) PRD:321 | 재현성·설명 불가, "영구 소유" 충돌, 조직 단위 해제·양도 곤란 | 격자 탐색, 서명 파일 오프라인 검증, 로그인 계정 활성화 |
| ARX-16 | 인허가용 설계도서, 표제란 날인란 | PRD 범위 | PRD:364, PRD:450 | 인허가 도서 오인 | 고지 고정(PRD:339) |

## 4. 복사 금지 결함

### 4.1 `SECURITY_BASELINE.md` 14장 해당 항목

해당 없음: OVERRIDE·verify-admin(SB:229, 의료 데이터 없음), 프로필 없으면 admin·PageGuard(SB:230, 원천 없음. 서버 판정 원칙은 4.3절), 전역 n8n 키(SB:232).

| 패턴 | 출처 | 왜 금지 | 대체 |
|---|---|---|---|
| 크레딧 RPC EXECUTE 미회수 | SB:220 | 데스크톱 anon 키로 지급 | `start_ai_run` 계열·`issue_license`·`activate_license` service_role만, 42501 회귀 테스트 |
| 비원자 차감 | SB:221 | 음수 잔액 | 한 트랜잭션 `consume_credits`, 렌더 동시 3건 `AR030` |
| 웹훅 서명 미검증 | SB:222 | 위조 결제로 시리얼 발급 | Toss 원시 본문 검증 + `core.webhook_events` 멱등(PRD:122) |
| `customerKey = Date.now()`, orderId 파싱 | SB:223 | 금액·SKU 위조 | 코어 `payment_orders` 서버 생성(C-1) |
| OAuth state 위조, 콜백 결함 | SB:224 | 세션 주입 | 앱이 시작한 PKCE 시도의 콜백만(Tauri:128) |
| 토큰 평문, 0키 폴백 | SB:225 | 세션·키 유출 | OS 자격 증명 저장소(PRD:59), 키 없으면 기동 실패 |
| 세션 없는 백그라운드가 RLS에 막힘 | SB:226 | 렌더·검토 조용히 정지 | 워커·FastAPI service_role, 정리 잡 |
| `FOR ALL` 셀프 업그레이드 | SB:227 | `updates_until`·`max_activations` 변경 | `FOR ALL` 0, 라이선스·실행 행 사용자 쓰기 불가 |
| Pro 잠금해제, localStorage 플래그 | SB:228 | 체험판 표시·폴백 무력화 | `arch.org_features` + 서명 파일 `features`(PRD:408), Rust 검증(Tauri:194) |
| RLS 자기참조 재귀 | SB:231 | 전체 거부·우회 | 코어 헬퍼만 |
| 무인증 AI 프록시, CORS `*` | SB:233 | 비용 폭증 | Bearer 세션(T-C1) + 셸 출처 허용 목록(T-C2) |
| 사용자 파일 경로 조작 | SB:234 | 파일시스템 접근 | 경로 정규화, 대화상자 경로·앱 폴더만(Tauri:205, Tauri:208) |
| 라우터 무인증, `dev-user` | SB:235 | 무료 사용 | 세션 래퍼, Mock은 4.2절뿐 |
| 실키 `.env` 커밋 | SB:236 | 서명 키 유출 → 라이선스 위조 | CI 비밀 검사 |
| 한글 `\b` 금지어 | SB:237 | compliance 무효 | 사전 매칭 + 테스트 |

### 4.2 인증 복사 금지 (`AUTH_ROADMAP.md` 10장)

| 패턴 | 출처 | 왜 금지 | 대체 |
|---|---|---|---|
| 쿠키·localStorage 역할 Mock, `mock-auth.ts` | `docs/products/_platform-core/AUTH_ROADMAP.md:30`, `:367`, `docs/reviews/NOMAD_Shorts_Maker.md:83` | 권한 위조, 프로덕션 노출 | 로컬 시드 계정 실제 JWT, `isMockAuthAllowed()`(같은 파일 `:78`) |
| 콜백 `next` 무검증 | 같은 파일 `:140`, `docs/reviews/Flora-v2.md:71` | 외부 리다이렉트 | `finishLogin` 화이트리스트, 데스크톱은 `POST /api/auth/finish`(T-C8) |
| 앱에 박은 개발 계정, 배포 빌드 개발 패널 | PRD:59, PRD:320 | 배포 앱 권한 획득 | 개발 빌드에서만, 배포 빌드는 코드 경로 제거 |
| 기능 코드의 페르소나·mock 분기 | 같은 파일 `:98-104` | 단계 전환 시 권한 경로 변화 | auth 모듈(`packages/shell-bridge/src/auth/**`, `packages/features/src/auth/**`, `apps/web/src/lib/auth/`)에만 |
| 딥링크 `code`·토큰 로그 기록 | PRD:59 | 세션 탈취 | 로그 마스킹 |

### 4.3 데스크톱 금지 (`Tauri/README.md` 13.4절)

| 패턴 | 출처 | 왜 금지 | 대체 |
|---|---|---|---|
| 번들·바이너리·`tauri.conf.json`에 service_role, LLM 키, `LICENSE_SIGNING_PRIVATE_KEY` | Tauri:352, Tauri:209 | 추출된다 | 공개키(`kid`별)만(PRD:125) |
| 로컬 SQLite·localStorage로 플랜·크레딧·라이선스 판정, 클라이언트 금액·org_id 신뢰 | Tauri:353 | 사용자가 고친다 | 로컬은 서명 파일, 클라우드는 호출마다 서버 판정 |
| 웹뷰 소셜 로그인, PKCE 없는 OAuth, 시작 안 한 딥링크 처리 | Tauri:354 | 차단·주입 | ARX-10 대체 |
| 원격 URL 메인 창 + IPC, 임의 SQL·경로, `shell` 임의 명령 | Tauri:355 | 원격 코드 실행 | 정적 번들, `local_db_*` 쿼리만, 사이드카 없음 |
| "마지막 쓰기 승리", 동기화 실패를 성공 표시 | Tauri:356 | 작업물 소실 | `AR041` 버전 충돌, MVP 동기화 없음 |

### 4.4 FortuneDocs 높음 항목 (이식 원칙 관련)

| 패턴 | 출처 | 왜 금지 | 대체 |
|---|---|---|---|
| 외부 API 값을 기준 차이 확인 없이 판정에 사용(#1) | FD:40 | 경계 사례 오판 | 공공 API 값은 입력 후보, 기준은 규칙 팩·신청 예정일 |
| 계산 규칙 누락, 필수 입력 NULL(#2, #3) | FD:41-42 | 조용한 기본값 | zod + `schema_version`, `AR050` |
| 결과 `FOR ALL`(#4) | FD:43 | 크레딧 없이 결과 생성 | 실행 행은 `finish_ai_run`만 |
| 원자 차감·환불 없음(#5) | FD:44 | 손실·이중 차감 | 2절 흐름 |
| 서버리스 브라우저 PDF(#6) | FD:45 | 배포에서만 실패 | 공용 WeasyPrint(`docs/products/_platform-core/SHARED_MODULES.md:269`), 도면은 로컬 |
| LLM 수치 생성(#8, 중간이나 원칙의 근거) | FD:47 | 엔진 값과 불일치 | ARX-12 |

### 4.5 도면 고유 금지

| 패턴 | 출처 | 왜 금지 | 대체 |
|---|---|---|---|
| 비결정 DXF(헤더 밖 시각, 난수 핸들, 순회 순서 의존, 부동소수 좌표, 로캘 소수점) | PRD:337, PRD:370 | 골든 테스트 붕괴 | mm 정수, 정렬 순번 핸들, 로캘 무관 포맷, 시각은 헤더만(골든 모드 고정값, 제안) |
| 도면 수치를 판정과 따로 계산 | PRD:371-372, PRD:472 | 도면·판정 불일치 | JudgmentResult 입력, 속성 테스트 |
| 표제란 고지 제거 경로(토글, 레이어 매핑으로 `A-TTLB` 제거, 요청 입력) | PRD:339, PRD:370 | 인허가 도서 오인 | 엔진 상수, 매핑은 이름만 변경 |
| 체험판 표시를 클라이언트 플래그로 | PRD:395, PRD:408 | 무료 상업 사용 | 서명 파일 `drafting_watermark` |
| 재배포 불가 글꼴 번들·임베딩, DXF에 PC 글꼴 경로 | PRD:453, PRD:380 | 라이선스 위반, 경로 노출 | OFL 등만, DXF는 이름만, `AR057` |
| 대화상자 없이 사용자 경로 쓰기 | Tauri:205, Tauri:208 | 덮어쓰기, 경로 조작 | `export.rs`는 저장 대화상자 경로만, 실패 `AR052` |
| 시트에서 형상 수정, 엔진 버전 없는 내보내기 기록 | PRD:336-337 | 모델 불일치, 차이 설명 불가 | `annotation_overrides`만, `exports` 엔진 버전, `AR059` |
| 도면 좌표·표제란 정보 로그 | PRD:421 | 작업물 유출 | 시트 id·엔진 버전·소요 시간만 |
| DXF 가져오기 단위 조용히 추정 | PRD:379 | 1000배 오류 | `AR053` 사용자 질문 |

## 5. 아카이브 절차

원본 저장소가 없어 `archive/<원본>` 이동, 원본 키 재발급, zip 정리 대상이 없다. 대신 이식 기준과 외부 고지를 기록한다. 2~6행은 제안이다(이유: 원본 없는 제품의 5절 기준이 DOC_TEMPLATE에 없다, `docs/products/_platform-core/DOC_TEMPLATE.md:301`).

| 순서 | 작업 | 담당 |
|---|---|---|
| 1 | 대상 없음 확인. 원천(`nomad-docs/`, `flora-publishing/`, `_platform-core/`, `_design-guide/`, `docs/reviews/`)은 읽기 전용, 변경은 코어 요청(PRD 8.1절)·담당 요청으로. checkout, reset, stash, add, commit 금지 | 모든 개발 에이전트 |
| 2 | 이식 기준 커밋 기록: 5개 원천 모두 `2f326c4`(2026-10-16, 이 문서 작성 시점 레포 HEAD). 웨이브 시작마다 `git diff 2f326c4..HEAD -- <원천 경로>`로 바뀐 이식 규칙을 확인하고 반영 여부를 06장 작업으로 정한다(자동 추종 안 함) | 06장 W0, 사람 |
| 3 | 키 재발급 불필요. 새로 만든다: `LICENSE_SIGNING_PRIVATE_KEY`(Ed25519, `kid`), Tauri 업데이트 서명키, 코드 서명 인증서(Tauri:211). 다른 제품 키(`AI_TOKEN_PRIVATE_KEY` 등) 재사용 금지(PRD:125) | 사람(운영) |
| 4 | `apps/desktop/THIRD_PARTY_NOTICES`: 번들 구성요소마다 이름, lockfile 버전, 라이선스, 원문. 앱 고지 화면(PRD:232)이 이 파일을 읽는다. 웹은 같은 방식으로 별도 고지 | 06장 데스크톱 작업 |
| 5 | CI 라이선스 점검: npm·cargo 의존성을 허용 목록(MIT, Apache-2.0, BSD, ISC, 무수정 MPL-2.0, OFL 글꼴)과 대조, GPL·AGPL·LGPL·비상업은 실패. 도구 후보 `cargo deny` 등(미정). 1.6절 "미확인" 행은 통과해야 번들 | `desktop-build.yml`, `web.yml` |
| 6 | CI 전용 도구(ezdxf, 검증 뷰어)가 설치 파일·이미지·릴리스 산출물에 없음을 릴리스 체크리스트로 확인 | `golden.yml`, `desktop-release.yml` |
