# Arch Studio (arch-studio, 가칭)

작성일 2026-10-14, 갱신 2026-10-16(도면 자동 생성 9장 추가, 02~07·`CLAUDE.md`·SQL 초안 작성). 신규 단독 제품, 기획 초안. app id `arch`(제안), 스키마 `arch`(제안). 이 폴더는 기획 문서와 SQL 초안만 있고 앱 코드는 없다(`D:/WorkSpace/platform/docs/products/_PRODUCT_AGENT_BRIEF.md:6`). 문서 상태는 4장. 브랜드 최종명은 열린 결정 D-1이다(`01_PRD.md` 8장).

## 1. 한 줄 정의

소규모 건축사사무소와 전원주택 시공사가 대지를 불러오면 법규 엔벨로프(건축 가능 볼륨)가 3D로 자동 생성되고, 그 안에서 매스를 움직이는 동안 건폐율·용적률·정북 일조사선·주차·이격이 실시간으로 판정되며, AI 렌더와 설계 제안서까지 한 번에 만드는 설치형 AI 설계실무 앱이다. 앱은 시리얼 번호로 영구 소유하고, AI 렌더·클라우드 법규 검토·제안서 생성은 크레딧으로 쓴다.

| 대상 | 상황 | 단계 |
|---|---|---|
| 1~5인 소규모 건축사사무소 | 단독주택·근생 계약 전 무료 제안(법규 검토, 매스, 렌더, 제안서)에 시간을 많이 쓴다 | MVP |
| 전원주택·모듈러 시공사 | 건축주 상담 자리에서 바로 볼륨·렌더·개략 공사비를 보여 주고 싶다 | MVP(화이트라벨은 Phase 2) |
| 건축학과 학생, 건축사 수험생 | 법규를 3D로 확인하며 배우고 싶다 | Phase 2(교육 라이선스, D-13) |

## 2. 통합 근거

| 항목 | 내용 | 근거 |
|---|---|---|
| 통합 대상 | 없다. 기존 리뷰 대상 프로젝트를 합친 제품이 아니라 신규 제품이다. 기존 제품 설계에서 검증된 패턴을 이식 원천으로 쓴다(3장) | 제안 |
| 기획 계기 | 현업 건축사가 만든 AI 설계실무 앱의 무료 배포 사례(YouTube 이륙건축사 채널, 2026)를 참고했다. 기능을 복제하지 않고, 법규 엔벨로프 실시간 판정·시공 단계 문서·크레딧형 AI 렌더를 더한 별도 제품으로 기획한다 | 사용자 결정(2026-10-14) |
| 차별화 근거 | 국토교통부 "AI 기반 통합인허가 사전진단"이 2026-12 시범, 2027 하반기 전국 서비스 예정이다. 대지 단위 검토(용도지역, 건폐율·용적률, 행위제한)는 무료 공공 서비스가 되므로, 이 제품은 설계안 단위 실시간 판정에 집중한다 | [매일신문 2026-06-05](https://www.imaeil.com/page/view/2026060509435967518), [세계일보 2026-07-08](https://www.segye.com/newsView/20260708509141) |
| 판매 모델 | 영구 라이선스(시리얼) + 연간 업데이트 플랜 + AI 크레딧, 진입용 월 구독 병행 | 사용자 결정(2026-10-14), `01_PRD.md` 4장 |
| 공유하는 것 | `_platform-core` 공용 모듈만 인용한다: auth, org, credits, toss, webhooks, storage, audit, jobs, compliance, fal client, weasyprint render, ai-gateway, ai-service, dify, core-voice, llm-wiki. 재정의하지 않는다 | `docs/file/03-설계/공용코어/SHARED_MODULES.md:3`, 1장(`:31`) |
| 인증 단계 | 다른 제품과 같은 순서로 로그인을 켠다: A Mock(로컬 시드 계정, MVP 개발) → G1 → B Google + 이메일(사전예약 판매·공개 베타 전) → G2 → C1 카카오·C2 네이버(P2 선택). 데스크톱 앱은 시스템 브라우저 로그인 후 앱 복귀(D-15), 시리얼은 계정 조직에 귀속(D-16) | 확정 결정 22, `docs/file/03-설계/공용코어/AUTH_ROADMAP.md` 8장, `01_PRD.md` AR-F-027·8.2절 |
| 새로 필요한 코어 기능 | 영구 라이선스 결제 종류(현재 `payment_orders.kind`는 subscription, credit_pack, billing_key_charge뿐), 데스크톱 클라이언트용 라이선스 서명 키 | `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/0002_core_billing.sql:140`, `01_PRD.md` 8장 D-3 |

## 3. 원본 매핑

원본 프로젝트가 없으므로 이식 원천을 원본 매핑으로 쓴다.

| 이식 원천 | 문서 | 완성도 | 가져오는 것 | 버리는 것 |
|---|---|---|---|---|
| nomad-docs(설계) | `D:/WorkSpace/platform/docs/products/nomad-docs/` | 기획만 | 체크리스트 효과 엔진(결정적 순수 함수), "숫자는 서버가 계산하고 LLM은 해석만" 원칙, 고위험 문서 템플릿 전용 규칙, 문서 묶음 생성, 회의 녹음 → 요구사항 후보 | 개발 외주 문서 카탈로그, CRM 연동 |
| flora-publishing(설계) | `D:/WorkSpace/platform/docs/products/flora-publishing/` | 기획만 | WeasyPrint 렌더 서비스(소비자로 추가), 크레딧 선차감·환불 흐름 | 판형·표지·ePub |
| _platform-core AI 계층 | `docs/file/03-설계/공용코어/AI_ARCHITECTURE.md` | 기획만 | FastAPI LangGraph, pgvector RAG, 모델 라우팅 이원화, compliance 노드 | 없음 |
| _design-guide 3D 히어로 | `docs/file/03-설계/디자인/HERO_3D.md` | 기획만 | R3F 히어로 키트(랜딩) | 없음 |
| FortuneDocs 원칙 | `docs/reference/reviews/FortuneDocs.md:47` | 약 40% | 결정적 값은 서버(이 제품은 규칙엔진)가 계산 | 사주 도메인 |

## 4. 문서 목록

| 파일 | 상태 | 내용 |
|---|---|---|
| `01_PRD.md` | 초안 | 페르소나, 범위, 기능 요구사항, 요금·라이선스·크레딧, 비기능, 법·금지 문구, KPI, 열린 결정, 9장 도면 자동 생성(2026-10-16) |
| `02_ARCHITECTURE.md` | 초안 | 데스크톱(Tauri) + 웹(Next.js) + api(FastAPI) 구성, 규칙엔진·지오메트리·도면 엔진(`packages/drafting`) 패키지 경계, 라이선스 검증, 잡·AI 라우팅 |
| `03_SCREENS_UX.md` | 초안 | 모델러 화면, 법규 판정 패널, 평면 편집기·도면 시트 화면, 렌더·제안서 화면, 라이선스·결제 화면, 랜딩 3D 히어로 |
| `04_API.md` | 초안 | 라이선스 활성화·검증 API, 규칙 팩 배포 API, 렌더·검토 잡 계약, 로컬 도면 엔진 계약, 오류 코드 `AR001~AR059` |
| `05_DATA_MODEL.md` | 초안 | `arch` 스키마(라이선스, 활성화, 규칙 팩, 프로젝트 클라우드 사본, 렌더, 제안서 실행). SQL 초안 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/2400_arch.sql`(모듈러)과 단독 배포용 monolith |
| `06_AGENT_PLAN.md` | 초안 | 작업 목록(`AR-06-###`), 웨이브, 모델 배정 |
| `07_SOURCE_MIGRATION.md` | 초안 | 이식 원천별 자산과 금지 패턴 |
| `CLAUDE.md` | 초안 | 개발 에이전트 지침 |

## 5. DB 구조 선택

| 항목 | 내용 |
|---|---|
| 클라우드 | 모듈러, 스키마 `arch`, 번호 2400~2499(제안). `DB_CONVENTIONS.md` 2장 표의 다음 빈 범위다(`docs/file/03-설계/공용코어/DB_CONVENTIONS.md:42`, 마지막 `2300~2399 docs`). SQLSTATE 접두사 `AR`(제안) |
| 이유 | 계정·크레딧·결제·잡·AI 계층을 다른 제품과 같은 코어로 쓰고, 법령 RAG 컬렉션을 플랫폼 공통 지식으로 운영하기 쉽다 |
| 로컬 | 데스크톱 앱은 프로젝트·3D 모델·판정 기록을 로컬 SQLite에 둔다. 도면과 모델은 사용자가 클라우드 기능(렌더, 클라우드 검토, 공유)을 실행할 때 필요한 부분만 올린다 |
| 모놀리스 | 화이트라벨(Phase 2) 고객사 전용 설치 시 쓴다. 같은 함수 이름과 시그니처를 유지한다(`docs/file/03-설계/공용코어/DB_CONVENTIONS.md` 12장) |
