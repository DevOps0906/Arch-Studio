# arch-studio 개발 방법 V2: 공용모듈 적용판 (Arch Studio(가칭))

작성일 2026-10-15. 생성: `develop_V2/_shared/tools/gen_v2.py`(직접 고치지 말고 스크립트 데이터를 고친 뒤 다시 실행). V1 안내서 [`develop/arch-studio/arch-studio_develop.md`](../../develop/arch-studio/arch-studio_develop.md)를 기본으로 하고, 이 문서는 local-news에서 꺼낸 공용모듈을 쓰도록 **바뀌는 부분만** 다룹니다. 두 문서가 다르면 이 문서가 우선합니다. 공통 규칙은 [`develop_V2/_shared/V2_RULES.md`](../../develop_V2/_shared/V2_RULES.md).

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 앱 id / 작업 접두어 | `arch` / `AR` |
| 개발 단계(`products/README.md` 개발 순서) | 코어 이후(설치형) |
| 채택 공용모듈 | compliance |
| 보류 공용모듈 | media, search |
| 이 제품의 역할 | 패키지 사용(구현하지 않음) |
| 기존 공용모듈 | notify(시리얼 발급 메일·잡 완료 알림), analytics(샘플 다운로드 → 사전예약 전환 이벤트)는 기존 공용모듈 로드맵대로. 데스크톱 앱 안 라이선스 판정·고지는 공용모듈 대상이 아니다. |

## 1. 진행 순서

| 순서 | 할 일 | 문서 |
|---|---|---|
| 1 | V1 0~6장: 사전 준비, setup 스크립트, project-profile, 로컬 DB 기동 전까지 | V1 안내서 |
| 2 | 공용모듈 SQL 추가와 도메인 파일 이름 바꾸기, 제품 표 정리 | 이 문서 3장 |
| 3 | `06_AGENT_PLAN.md`에 V2 작업 추가, V1 작업 축소·대체 반영 → 개발 묶음 다시 만들기 | 이 문서 4장, V2_RULES 4장 |
| 4 | V1 8~10장 사이클로 웨이브 진행(V2 작업은 해당 웨이브 맨 앞) | V1 안내서 |
| 5 | 검증 추가 항목 | 이 문서 6장 |

## 2. 공용모듈 적용 상세

### 2.1 compliance (법정 표기·동의·라벨, `compliance` 0150)

| 항목 | 내용 |
|---|---|
| 이 제품에서 쓰는 곳 | 온보딩 국외 이전 동의(008), 라이선스·플랜·크레딧팩 구매 약관·환불 규정 동의(043), 설정의 국외 이전·녹음 고지 버전(031), 법적 고지 페이지 `/legal/*`(057), Stage B 온보딩 약관 단계(062) |
| 공용모듈이 대체하는 것 | 법적 고지 본문(`web/src/content/legal/**`) → `policy_documents`(kind `terms`, `privacy`, `ai_notice`, `refund`), 가입·구매·국외 이전 동의 → `consents`(purpose `cross_border_ai` 등), 판매자 표기 → `legal_profiles`(`kr_ecommerce`) |
| 제품에 남는 것 | 설치형 앱 안의 오프라인 고지 문구, 표제란 고지 상수(`titleblock`, PRD 9.7절), 상담 녹음 제3자 고지 확인(`arch.intake_runs.notice_version`, 녹음 건별), 코어 `set_ai_cross_border_ack` 호출 |
| 제품 주입 값 | `profileKind: kr_ecommerce`(시리얼 라이선스·플랜 판매), `signupConsents: { required: [terms, privacy, refund], optional: [marketing_email, cross_border_ai] }` |
| 기획·개발 정본 | [`common-modules/compliance.md`](../../products/_platform-core/common-modules/compliance.md), [`_shared/modules/compliance.md`](../../develop/_shared/modules/compliance.md) |

### 2.2 보류한 모듈

| 모듈 | 보류 이유 | 다시 검토할 때 |
|---|---|---|
| media | 렌더 결과는 90일 뒤 지우는 실행 결과물(`arch.renders`, `purge_expired`)이고 표제란 로고는 조직당 1장 고정 경로라 공용 자산 라이브러리가 필요 없음 | 클라우드 렌더 갤러리·사무소 자산 라이브러리를 만들 때 |
| search | 프로젝트·도면 검색은 데스크톱 로컬 SQLite, 법규 해설 위키는 llm-wiki 검색으로 충분 | 클라우드 프로젝트 공유·조직 단위 검색을 만들 때 |

## 3. DB 변경

V2 적용 후 개발 폴더 `supabase/migrations/`(파일 이름 규칙은 V2_RULES 3장):

```
20261013000001_core_lite.sql
20261013000150_compliance.sql            ← 추가(패키지 변환본)
20261013001000_arch_domain.sql           ← 20261013000002에서 이름 변경
```

| 대상 | 변경 |
|---|---|
| `arch.*` | 변경 없음(동의를 저장하는 표가 없음). 가입·구매·국외 이전 동의 기록은 `compliance.consents`에 새로 쌓는다. 상담 녹음 제3자 고지(`intake_runs.notice_version`)는 녹음 건별 확인이라 제품에 남긴다 |
| 모놀리스 `0002_arch_domain.sql` | 모듈러 정본 `2400_arch.sql`의 변환본. 이름만 `…001000_arch_domain.sql`로 바뀌고 내용은 그대로 |

## 4. 작업 계획 변경

### 4.1 V2 작업 (06장 2절 표 맨 아래에 추가)

| ID | 내용 | 웨이브 | 선행 | 모델 | 수용 기준 |
|---|---|---|---|---|---|
| AR-V2-01 | compliance 적용(SQL 변환본, 주입 파일, seed, 어댑터) | W1 맨 앞 | W0 완료, `@nomad/compliance` 출시 | Sonnet | `_shared/modules/README.md` 5.2절 1~7번. 뒤 작업: 008, 043, 031, 057, 062 |
| AR-V2-02 | V2 전환 점검: 모듈 계약 테스트를 CI에 연결, 자체 구현 잔재 검사 | E2E 작업과 같은 웨이브 | AR-V2-01 | Sonnet | 제품 E2E 녹색, 공용모듈로 옮긴 표·함수를 제품 코드가 직접 쓰는 곳 0 |

### 4.2 V1 작업 변경

| V1 작업 | 작업명(06장) | 변경 | 내용 |
|---|---|---|---|
| AR-06-008 | 인증 Stage A: 인증 모듈 경계, 웹 Mock 패널 +… | 연결 | `/onboarding` 국외 이전 동의를 `recordConsent(cross_border_ai)`로도 남긴다. 코어 `set_ai_cross_border_ack` 호출은 그대로 |
| AR-06-043 | 결제: `POST /api/checkout`(license_sku·plan·cred… | 연결 | 구매 전 약관·환불 규정 동의를 `ConsentCheckboxes`·`hasConsent`로 확인한 뒤 서버 주문을 만든다. `AR005`, C-1 전 영구 라이선스 보류는 그대로 |
| AR-06-031 | 설정: 표제란·레이어 매핑(`GET/PUT /api/drafting-profile`… | 연결 | 국외 이전·녹음 고지 문구는 `policy_documents`(kind `ai_notice`) 버전을 읽고 재동의는 `needsReconsent` |
| AR-06-057 | 랜딩 `/`(3D 히어로, 정지 이미지 대체, 킬 스위치), `/pricing`,… | 축소 | `/legal/*` 본문은 `policy_documents` seed, 화면은 `LegalFooter`. 페이지 배치와 도면 고지(PRD 6장·9.7절) 원고만 제품 |
| AR-06-062 | Stage B: 웹 Google + 이메일(가입·인증 메일·재설정, D-19),… | 연결 | 온보딩 약관 단계는 `signupConsents` 필수 항목을 `ConsentCheckboxes`로 받고 `recordConsent` |

변경 종류(축소·대체·연결)의 뜻과 06장 반영 방법은 V2_RULES 4장. 바뀐 V1 작업의 선행 조건에 해당 V2 적용 작업 ID를 더합니다.

## 5. 디렉토리와 주입 파일

```
src/lib/compliance/index.ts       createModule({ appId: 'arch', ... }) — 2.1절 주입 값
supabase/seed.sql                 <스키마>.settings 행, 정책 문서 초안, 프리셋
```

공용모듈 패키지 코드와 변환본 SQL은 고치지 않습니다. 필요한 변경은 `nomad-modules` 저장소에 요청합니다.

## 6. 검증 추가 항목

- [ ] `supabase db reset` 후 제품 RLS 스모크 + 채택 모듈 스모크 녹색
- [ ] 채택 모듈 계약 테스트가 제품 CI에서 녹색
- [ ] compliance: 가입·폼 제출 때 동의 기록 1행, 정책 새 버전 게시 후 재동의 화면, 푸터 사업자 정보 표시
- [ ] 공용모듈로 옮긴 제품 표·컬럼을 직접 읽거나 쓰는 코드 0(검색: 3장 "대상" 열 이름)

## 7. 결정 필요

| ID | 결정 | 권고 |
|---|---|---|
| CMX-1~4 | 공용화 시점, DB 번호 재배정, 검색 엔진, 최종 이용자 결제 수취 | `products/_platform-core/common-modules/README.md` 6장 |
| V2-AR-1 | 영구 라이선스 청약철회 제한 고지를 공통 `refund` 정책 안의 절로 둘지, 제품 kind로 따로 둘지 | 공통 `refund` 안의 절(제안). 판매 시작(C-1 반영) 전에 확정 |
