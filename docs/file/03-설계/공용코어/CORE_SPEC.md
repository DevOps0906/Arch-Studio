# CORE_SPEC: 플랫폼 공통 코어 명세

작성일 2026-10-12. 대상 독자는 제품 기획 에이전트와 코어 구현 담당(Fable)이다. 이 문서는 "공통 코어가 무엇을 보장하고, 제품은 무엇을 호출하면 되는가"를 계약(contract) 단위로 적는다. 정본 SQL은 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/0000~0009`이며, 모놀리스용 축소판은 같은 폴더의 `MONOLITH_CORE_LITE.sql`이다. 아래 경로 인용에서 `migrations/`는 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/`를 뜻한다.

## 0. 읽는 순서와 표기

| 순서 | 문서 | 목적 |
|---|---|---|
| 1 | 이 문서 | 코어가 제공하는 계약 전체 |
| 2 | `SHARED_MODULES.md` | 앱 계층 공용 모듈의 경계와 인터페이스 |
| 3 | `SECURITY_BASELINE.md` | 모든 제품이 지켜야 하는 보안 규칙 |
| 4 | `DB_CONVENTIONS.md` | 제품 스키마 작성 규칙 |
| 5 | `DOC_TEMPLATE.md` | 제품 폴더 문서의 장 구조 |
| 6 | `MONOLITH_CORE_LITE.sql` | 단독 Supabase 프로젝트용 코어. 인증 단계(Mock → Google → 카카오·네이버)는 `AUTH_ROADMAP.md`와 이 문서 18장 |

표기: "제안"은 원본 문서나 리뷰에 근거가 없어 이 문서가 새로 정한 값이다. "미확인"은 외부 사실(API 존재 여부 등)을 확인하지 않은 것이다. 둘 다 사용자 결정 전까지 확정이 아니다.

## 1. 코어의 정의와 경계

### 1.1 무엇이 코어인가

| 영역 | 코어가 소유하는 것 | 제품이 소유하는 것 |
|---|---|---|
| 신원 | 프로필, 조직, 멤버십, 가입 트리거, 역할 변경 함수 | 제품 안의 역할 세부(예: hms의 doctor/staff)는 제품 테이블에 둔다 |
| 과금 | 플랜, 구독, 엔타이틀먼트, 주문, 결제, 크레딧 원장 | 플랜별 기능 플래그의 "의미"(features jsonb 해석) |
| 보안 | RLS 헬퍼, 권한 컬럼 보호, 감사 로그, OAuth state, 암호화 자격증명, 레이트 리밋 | 제품 테이블의 RLS 정책(코어 헬퍼를 사용) |
| 실행 | 잡 테이블과 워커 규약, Storage 버킷과 경로 규칙 | 잡 페이로드 스키마, 워커 구현 |
| 수익화 | 제휴마케팅(계정, 링크, 클릭, 대가성 문구, 브랜드커넥트 지원) | 링크를 어디에 삽입할지(blog 본문, video 설명란) |
| AI·음성·위키 | 제공자·단가·라우팅, RAG 컬렉션·문서·청크(pgvector), 위키, 대화, 그래프 실행 기록, 음성 세션·작업 | 제품 그래프, 기능별 라우팅 기본값(seed 행), 프롬프트, 제품 전용 AI 테이블(꼭 필요할 때만) |

경계 원칙은 하나다. **제품은 코어 테이블을 직접 쓰지 않는다.** 읽기는 RLS SELECT 정책으로, 쓰기는 service_role 키를 가진 서버 코드 또는 SECURITY DEFINER RPC로만 한다. 이 원칙이 깨진 사례가 리뷰 전반에서 반복되었다(`docs/reference/00_MERGE_ANALYSIS.md:526`, `:971`).

### 1.2 두 배포 형태

| 형태 | SQL | 스키마 | 선택 기준 |
|---|---|---|---|
| 모듈러(통합) | `migrations/0000~0009` + 제품 조각 | `core` + 제품 스키마 | 기본값. SSO와 공용 지갑이 필요한 제품(`D:/WorkSpace/platform/docs/products/_supabase-modular/ARCHITECTURE.md:74`) |
| 모놀리스 | `MONOLITH_CORE_LITE.sql` | `public` | hms(의료정보 격리), stock-dashboard(개인용), 고객사별 분리가 필요한 admin-suite(`ARCHITECTURE.md:75`) |

함수 이름과 시그니처는 두 형태가 같다. 앱 코드는 `SUPABASE_DB_SCHEMA` 환경변수로 `core`/`public`을 바꾼다(`ARCHITECTURE.md:10`). 두 형태의 세부 차이는 `DB_CONVENTIONS.md` 9장에 있다.

### 1.3 계약 요약표

| 모듈 | 정본 객체 | 제품이 읽는 것 | 제품이 호출하는 쓰기 경로 |
|---|---|---|---|
| 신원 | `core.profiles`, `core.organizations`, `core.org_members` | SELECT 정책(자기 조직) | `invite_member`, `accept_invite`, `approve_member`, `change_member_role`, `remove_member`, `transfer_ownership`, `approve_profile` |
| 세션 | `core.session_context(p_app, p_org)` | 반환 jsonb | 없음(읽기 전용) |
| 플랜/엔타이틀먼트 | `core.apps`, `core.plans`, `core.credit_packs`, `core.subscriptions`, `core.app_entitlements` | 가격표는 anon 포함 공개, 조직 데이터는 멤버 | service_role: `apply_subscription_transition`, `confirm_payment_order`; 사용자: `bootstrap_app_for_org` |
| 크레딧 | `core.wallets`, `core.credit_ledger`, `core.credit_balances`, `core.ai_usage` | SELECT 정책 | service_role 전용: `consume_credits`, `grant_credits`, `refund_credits` |
| 결제 | `core.payment_orders`, `core.payments`, `core.billing_keys`, `core.billing_key_summaries`, `core.webhook_events` | 주문/결제는 멤버, 빌링키는 요약 뷰만 | service_role: 주문 INSERT, `confirm_payment_order`, `expire_stale_payment_orders` |
| OAuth | `core.oauth_states` | 없음 | service_role: `create_oauth_state`, `consume_oauth_state` |
| 자격증명 | `core.encrypted_credentials`, `core.credential_summaries` | 요약 뷰만 | service_role: INSERT/UPDATE; 사용자: `revoke_credential` |
| 잡 | `core.jobs` | SELECT 정책 + Realtime | service_role: `enqueue_job`, `claim_jobs`, `heartbeat_job`, `complete_job`, `fail_job`, `reap_stale_jobs`; 사용자: `cancel_job` |
| Storage | 버킷 `org-files`, `exports`, `public-assets` | 정책에 따름 | 사용자 업로드는 `org-files`, `public-assets` 자기 조직 폴더만; `exports`는 서버만 |
| 감사 | `core.audit_log` | owner/admin SELECT | 사용자: `write_audit`; service_role: 직접 INSERT |
| 레이트 리밋 | `core.rate_limit_buckets` | 없음 | service_role: `rate_limit_hit` |
| AI 라우팅·RAG | `core.ai_providers`, `core.ai_model_prices`, `core.ai_routing_settings`, `core.ai_collections`, `core.ai_documents`, `core.ai_chunks` | 단가·제공자는 인증 사용자, 나머지는 SELECT 정책(자기 조직) | service_role: `match_ai_chunks`, `resolve_ai_route`; 사용자(owner/admin): `set_ai_routing`(`AI001`) |
| 위키 | `core.wiki_pages`, `core.wiki_links`, `core.wiki_revisions` | SELECT 정책 | service_role(FastAPI)만 쓰기. 이력은 수정·삭제 불가(예외: 조직 삭제, 개인정보 삭제 요청 시 `core.purge_wiki_page`). 평소 삭제는 archived |
| 대화·그래프 | `core.ai_conversations`, `core.ai_messages`, `core.ai_runs`, `core.ai_run_steps`, 스키마 `ai_runtime` | 대화는 그 사용자 본인만, 실행 기록은 SELECT 정책 | service_role 전용 |
| 음성 | `core.voice_sessions`, `core.voice_jobs`, 버킷 `voice-audio` | 본인 작업만 | service_role 전용, `expire_voice_audio` |
| 제휴 | `core.affiliate_*`, `core.brandconnect_applications` | SELECT 정책 | service_role: 계정/링크 INSERT, `record_affiliate_click`; 사용자: `effective_disclosure`, `upsert_affiliate_disclosure`, `consent_brandconnect_risk`, `create_brandconnect_application` |

## 2. 인증과 조직 테넌시

### 2.1 모델

| 객체 | 역할 | 근거 |
|---|---|---|
| `core.profiles` | `auth.users` 1:1. `platform_role`(user/platform_admin)과 `status`(active/pending/suspended)는 사용자가 못 바꾼다 | `migrations/0001_core_identity.sql:12-27` |
| `core.organizations` | 테넌트. `is_personal` 조직은 가입 트리거가 만든다. `slug`는 `u<uuid without dash>` | `migrations/0001_core_identity.sql:32-42`, `:136-137` |
| `core.org_members` | 역할 owner/admin/member/viewer, 상태 active/invited/pending/suspended. 조직당 owner 1명(부분 유니크 인덱스) | `migrations/0001_core_identity.sql:48-63` |

테넌시 확정: **org 기준 스키마, 운영은 1인 1워크스페이스**(`docs/reference/00_MERGE_ANALYSIS.md:13`). 즉 모든 제품 테이블은 `org_id`를 가지며, UI는 개인 조직 하나만 보여 준다. 팀 기능(video Advanced 플랜 5인, `NOMAD Shorts Maker/PRD_pricing.md:105`)은 같은 스키마에서 멤버를 추가하는 것으로 열린다.

### 2.2 가입 계약

`auth.users` INSERT 뒤 `core.handle_new_user()`가 (1) 프로필, (2) 개인 조직 + owner 멤버십, (3) `raw_user_meta_data.signup_app`이 있으면 `core.on_signup_app_bootstrap()`을 수행한다(`migrations/0001_core_identity.sql:113-160`). 부트스트랩은 앱의 기본 플랜으로 구독과 엔타이틀먼트를 만들고 가입 크레딧(pack)과 첫 달 플랜 크레딧(plan)을 멱등 키로 지급한다(`migrations/0003_core_credits.sql:382-437`). 승인제 앱(`apps.signup_policy = 'approval'`)이면 프로필을 `pending`으로 둔다(`:400-402`).

제품이 지킬 것:

| 규칙 | 이유 |
|---|---|
| 가입 폼은 `options.data.signup_app = '<app_id>'`를 보낸다. OAuth(Google·카카오·네이버) 가입은 이 값을 보낼 수 없으므로 콜백이 `bootstrap_app_for_org`를 1회 호출한다(18장) | 없으면 엔타이틀먼트가 생기지 않아 첫 화면에서 `entitled=false` |
| 기존 사용자가 다른 앱을 처음 열면 `rpc('bootstrap_app_for_org', {p_app_id})`를 호출한다 | SSO 크로스 셀 경로. owner/admin만 가능(`migrations/0003_core_credits.sql:440-461`) |
| 프로필이 없으면 로그아웃 처리한다. 기본 역할을 admin으로 두지 않는다 | Hospital은 프로필이 없을 때 admin으로 보낸다(`Hospital/src/proxy.ts:57`, `:69`). 이 패턴을 복사하면 안 된다 |

### 2.3 세션 컨텍스트

`core.session_context(p_app text, p_org uuid default null) returns jsonb`는 요청당 1회 호출해 사용자, 개인 조직, 역할, 플랜 코드, 엔타이틀먼트 여부, 크레딧 잔액을 한 번에 돌려준다(`migrations/0004_core_security.sql:115-173`). 반환 형식:

| 키 | 타입 | 의미 |
|---|---|---|
| `user_id`, `email`, `display_name`, `platform_role`, `status` | text | 프로필 |
| `org` | `{id, name, slug, role}` 또는 null | 활성 멤버십이 있는 조직. null이면 조직 없음 |
| `app_id`, `plan_code`, `entitled` | text, text, boolean | `plan_code`는 `entitled_plan_code()` 결과, `entitled = plan_code is not null` |
| `credit_balance` | integer | plan + pack 합 |

사용 위치: `proxy.ts`(라우트 보호), 대시보드 레이아웃, Route Handler 진입부. 서버 클라이언트 3종(`sellingstudio/lib/supabase/client.ts`, `server.ts`, `admin.ts`)을 그대로 쓴다. 라우트 보호 골격은 `Hospital/src/proxy.ts:13-48`(쿠키 세션 갱신 → `getUser()` → 보호 경로면 로그인으로 리다이렉트)을 쓰되, 역할 분기는 `session_context`의 `org.role`과 `platform_role`로 한다. 역할 → 페이지 매트릭스의 형태는 `Hospital/src/lib/permissions.ts:5-10`을 따르되 서버에서 강제한다(`docs/reference/00_MERGE_ANALYSIS.md:1141`).

### 2.4 멤버 관리 함수

모두 SECURITY DEFINER이며 authenticated가 호출할 수 있다. 호출자 판정은 `core.is_service_caller()`와 `coalesce(role, '')`를 쓴다(`SECURITY_BASELINE.md` 1~2장).

| 함수 | 누가 | 제약 | 근거 |
|---|---|---|---|
| `invite_member(org, user, role)` | owner/admin | 자기 초대 불가, admin은 admin 부여 불가, role은 admin/member/viewer | `migrations/0004_core_security.sql:315-349` |
| `accept_invite(org)` | 초대받은 본인 | status invited → active | `:351-369` |
| `approve_member(org, user)` | owner/admin | pending → active | `:372-392` |
| `change_member_role(org, user, role)` | owner/admin | 자기 역할 불가, owner는 `transfer_ownership`으로만, admin은 admin 변경 불가 | `:394-430` |
| `remove_member(org, user)` | owner/admin 또는 본인 탈퇴 | owner 제거 불가 | `:432-459` |
| `transfer_ownership(org, new_owner)` | owner | 새 owner는 활성 멤버 | `:461-479` |
| `approve_profile(user)` | platform_admin | pending → active | `:482-495` |

모든 함수는 `core.write_audit()`로 감사 행을 남긴다.

## 3. 앱 레지스트리, 플랜, 구독, 엔타이틀먼트

| 객체 | 계약 | 근거 |
|---|---|---|
| `core.apps` | `id`는 모듈러 스키마 이름과 같다(`video`, `blog` 등). `signup_policy` open/approval/invite. invite 앱은 가입 트리거가 엔타이틀먼트를 만들지 않고, `bootstrap_app_for_org`도 service_role만 실행할 수 있다(운영자 부여). 초대받은 멤버는 조직의 엔타이틀먼트를 쓴다(2026-10-13 반영) | `migrations/0002_core_billing.sql:12-21`, `seed.sql:12-27` |
| `core.plans` | 앱별 플랜. `monthly_credits`(월 지급, plan 버킷)와 `signup_credits`(가입 1회, pack 버킷)를 분리. `carry_over=false`면 월 지급 시 남은 plan 잔액을 expire. `features` jsonb는 서버에서만 읽는 기능 플래그 | `:26-48` |
| `core.credit_packs` | 일회 구매 팩 | `:53-64` |
| `core.subscriptions` | 조직 x 앱당 1개. 상태 trialing/active/past_due/canceled/expired. 전이는 `apply_subscription_transition()`만 | `:89-109`, `:265-341` |
| `core.app_entitlements` | "이 조직이 이 앱을 어느 플랜으로 쓸 수 있는가"의 단일 출처. RLS와 서버 코드는 subscriptions가 아니라 이 표를 본다 | `:115-129` |

구독 상태 머신(`migrations/0002_core_billing.sql:254-263`):

| 현재 | 허용 전이 | 엔타이틀먼트 동기화 |
|---|---|---|
| trialing | active, canceled, expired | active(구독 플랜) |
| active | past_due, canceled, expired | active |
| past_due | active, canceled, expired | active 유지(결제 재시도 중) |
| canceled | active, expired | `expires_at = current_period_end`까지 유지 |
| expired | active | 앱 기본 플랜(source=signup)으로 되돌림, 기본 플랜 없으면 expired |

제품 기능 게이팅 규약:

| 규칙 | 내용 |
|---|---|
| 서버에서만 판정 | `core.entitled_plan_code(org, app)`으로 플랜 코드를 얻고 `plans.features`를 읽어 기능을 켠다. 클라이언트 게이팅은 UX 보조일 뿐이다(`docs/reference/00_MERGE_ANALYSIS.md:159`) |
| RLS에서 앱 접근 | 제품 테이블 정책은 `core.is_org_member(org_id) and core.has_entitlement(org_id, '<app>')` |
| 플랜 정본 | video는 `NOMAD Shorts Maker/PRD_pricing.md:116-143`, 나머지는 각 제품 01_PRD(`seed.sql:3-8`). seed의 금액은 샘플이다 |
| 한도형 기능 | 월 N건 같은 쿼터는 `features`에 숫자로 넣고(`"posts_per_month": 10`), 소비는 크레딧 원장 `reason`별 집계 또는 제품 테이블 카운트로 서버가 판정한다. 별도 쿼터 테이블은 코어에 없다(제안: 필요한 제품만 자기 스키마에 둔다) |

## 4. 크레딧 원장

### 4.1 모델

| 객체 | 계약 | 근거 |
|---|---|---|
| `core.wallets` | 조직당 1행. `plan_balance`, `pack_balance` 두 버킷. 잔액 정본 | `migrations/0003_core_credits.sql:19-24` |
| `core.credit_ledger` | append-only. `entry_type` grant/consume/refund/expire/adjust, `amount = plan_delta + pack_delta`, `balance_after`, `idempotency_key` 유일, `refund_of` | `:29-50`, 불변 트리거 `:53-67` |
| `core.credit_balances` | security_invoker 뷰. 사용자가 잔액을 읽는 경로 | `:106-114` |
| `core.credit_ledger_reconciliation` | 운영용(service_role). 지갑과 원장 합의 차이(drift) | `:117-124` |
| `core.ai_usage` | LLM/이미지 호출 로그. `ledger_id`로 과금 행과 연결 | `:80-98` |

### 4.2 RPC (service_role 전용)

| 함수 | 시그니처 | 반환 | 실패 코드 |
|---|---|---|---|
| `consume_credits` | `(p_org_id, p_amount, p_app_id, p_reason, p_ref_type, p_ref_id, p_idempotency_key, p_metadata, p_actor_id)` | `ledger_id, new_balance, plan_used, pack_used` | `CR001` 잔액 부족, `22023` 금액 0 이하 |
| `grant_credits` | `(p_org_id, p_amount, p_app_id, p_reason, p_bucket, p_ref_type, p_ref_id, p_idempotency_key, p_metadata, p_actor_id, p_reset_plan_bucket)` | `ledger_id, new_balance` | `22023` 버킷/금액 오류 |
| `refund_credits` | `(p_consume_ledger_id, p_reason, p_amount, p_idempotency_key, p_actor_id)` | `ledger_id, new_balance` | `CR002` consume 행 아님, `CR003` 환불 가능액 초과 |

근거: `migrations/0003_core_credits.sql:130-198`, `:204-281`, `:287-367`. EXECUTE는 service_role에만 있다(`:370-375`). 브라우저에서 `rpc('grant_credits')`는 42501이다.

보장 사항:

| 보장 | 구현 |
|---|---|
| 원자 차감 | `wallets FOR UPDATE` 잠금 뒤 검사·갱신·원장 INSERT를 한 트랜잭션에서(`:171-194`). 비원자 차감 결함(`docs/reference/00_MERGE_ANALYSIS.md:491`)의 차단 설계 |
| 멱등 | 같은 `p_idempotency_key`는 advisory lock 뒤 기존 행을 반환(`:160-167`) |
| 차감 순서 | plan 버킷부터, 부족분은 pack(`:179-180`) |
| 환불 비율 | 원 차감의 버킷 비율대로 되돌림, 누적 환불은 원액을 넘지 못함(`:333-346`) |
| 불변 | UPDATE 금지, DELETE는 `purge_organization()` 안에서만(`:53-67`, `:636-652`) |

### 4.3 선차감-환불 시퀀스 (제품이 따라야 하는 순서)

| 단계 | 호출 | 비고 |
|---|---|---|
| 1 | 서버가 `session_context`로 엔타이틀먼트 확인 | 플랜에 없는 기능이면 403 |
| 2 | `consume_credits(..., p_ref_type='job', p_ref_id=<client request id>, p_idempotency_key='consume:<app>:<request id>')` | 실패 `CR001`이면 402 응답, 잡 생성 안 함 |
| 3 | `enqueue_job(..., p_credit_ledger_id=<ledger_id>, p_idempotency_key='job:<app>:<request id>')` | 멱등 키가 같으면 기존 잡 반환 |
| 4 | 워커 `claim_jobs → heartbeat_job → complete_job` | 성공 시 환불 없음 |
| 5 | 실패 시 `fail_job(p_retryable)` | 마지막 실패에서 `refund_credits`가 자동 호출된다(`migrations/0005_core_jobs_storage.sql:231-234`) |
| 6 | 사용자가 대기 중 잡을 취소하면 `cancel_job` | 환불 포함(`:259-262`) |

LLM 게이트웨이처럼 잡 없이 동기 호출하는 경우도 2 → 호출 → 실패 시 `refund_credits` 순서를 지킨다. 성공 뒤 결과 저장에 실패해도 환불하지 않고 `ai_usage.status='error'`로 남긴다(제안: 비용이 이미 발생했기 때문).

### 4.4 멱등 키 규약

| 용도 | 형식 | 출처 |
|---|---|---|
| 가입 크레딧 | `signup:<org_id>:<app_id>` | `migrations/0003_core_credits.sql:426` |
| 월 지급 | `monthly:<subscription_id>:<YYYY-MM-DD>` | `:431`, `:509` |
| 결제 지급 | `order:<order_id>` | `:593` |
| 잡 환불 | `refund:job:<job_id>` | `migrations/0005_core_jobs_storage.sql:233` |
| 제품 차감 | `consume:<app_id>:<request_id>` | 제안. request_id는 클라이언트가 보내는 UUID |
| 플랜 리셋 | `<key>:expire` | `migrations/0003_core_credits.sql:257` |

## 5. Toss Payments

전 제품 PG는 Toss Payments 하나다(확정 결정 4, `docs/reference/00_MERGE_ANALYSIS.md:12`).

### 5.1 테이블

| 객체 | 계약 | 근거 |
|---|---|---|
| `core.payment_orders` | 결제창을 열기 전에 서버가 먼저 저장한다. `amount_krw`가 금액의 정본. `order_id`는 Toss orderId 형식(6~64자). orderId를 파싱해 org/plan을 꺼내지 않는다. 1시간 뒤 만료 | `migrations/0002_core_billing.sql:131-160` |
| `core.payments` | Toss 승인 결과. `payment_key` 유일 | `:165-181` |
| `core.billing_keys` | 빌링키는 AES-256-GCM 암호문만. `customer_key`는 `'org_' \|\| org_id`로 결정적 생성. 조직당 활성 1개 | `:66-84` |
| `core.billing_key_summaries` | 암호문 뺀 뷰 | `:245-251` |
| `core.webhook_events` | 7장 참조 | `:187-201` |

### 5.2 일반결제(크레딧팩, 첫 구독) 시퀀스

| 단계 | 주체 | 동작 |
|---|---|---|
| 1 | 서버 | `payment_orders` INSERT(status created, kind, plan_id 또는 credit_pack_id, amount_krw는 plans/credit_packs에서 읽음) |
| 2 | 클라이언트 | Toss 결제창(orderId, amount) |
| 3 | 클라이언트 | successUrl로 복귀(paymentKey, orderId, amount) |
| 4 | 서버 | Toss confirm API 호출(서버 시크릿 키) |
| 5 | 서버 | `core.confirm_payment_order(order_id, payment_key, amount_krw, method, raw, approved_at)` |
| 6 | DB | 주문 잠금 → 금액 대조 → payments INSERT → 주문 confirmed → 종류별 지급(크레딧팩은 `grant_credits`, 구독은 subscriptions upsert + 엔타이틀먼트 + 첫 달 크레딧). 한 트랜잭션 |

근거: `migrations/0003_core_credits.sql:534-631`. 실패 코드 `PM404` 주문 없음, `PM409` 다른 결제키로 재확인, `PM410` 상태 불가, `PM001` 금액 불일치. raise는 트랜잭션을 되돌리므로 confirm 안에서는 주문 상태가 바뀌지 않는다. 서버는 PM001을 받으면 별도 호출로 `core.fail_payment_order(order_id, 'amount_mismatch', detail)`(service_role 전용, 멱등, 감사 행 `payment_order.failed`)을 불러 주문을 failed로 남긴 뒤 Toss 취소와 운영 알림을 한다(2026-10-13 반영). 같은 `(order_id, payment_key)` 재호출은 기존 payments 행을 돌려준다(멱등). 이 흐름은 Astro AI 리뷰 권고 "결제창 → successUrl → 서버 confirm → 금액·orderId 대조 → 멱등 지급, 웹훅은 보조"(`docs/reference/00_MERGE_ANALYSIS.md:366`)와 Shorts Maker 리뷰의 "payment_orders 선저장, confirm 멱등, 웹훅 서명 필수, 빌링키 정기결제"(`:555`)를 그대로 구현한 것이다.

### 5.3 빌링키 정기결제

| 단계 | 주체 | 동작 |
|---|---|---|
| 1 | 클라이언트 | Toss 빌링키 발급창(customerKey = `org_<org_id>`) |
| 2 | 서버 | authKey로 빌링키 발급 API → 빌링키를 AES-256-GCM으로 암호화해 `billing_keys` INSERT(`key_version` 기록), 이전 키는 revoked |
| 3 | 워커(스케줄) | `subscriptions`에서 `next_charge_at <= now()`이고 status active/past_due인 행을 읽음(`migrations/0002_core_billing.sql:108-109` 인덱스) |
| 4 | 워커 | `payment_orders` INSERT(kind billing_key_charge) → 빌링키 승인 API → `confirm_payment_order` |
| 5 | 실패 | `failed_charge_count` 증가, `apply_subscription_transition(id, 'past_due')`. 재시도 간격과 횟수는 제안: 1일, 3일, 7일 뒤 3회, 이후 `canceled` |

정기결제는 DB 함수가 아니라 워커가 수행한다. Toss API 호출이 필요하기 때문이다(`D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:143`).

### 5.4 환불

Toss 결제 취소 API 호출 뒤 `payments.status`를 canceled/partial_canceled, `canceled_amount_krw`를 갱신하고(service_role), 크레딧팩이면 미사용분만 `refund_credits`가 아닌 `grant_credits(..., 'adjust')`가 아니라 **원장 `adjust` 행**으로 음수 조정을 남긴다. 현재 RPC에는 adjust 전용 함수가 없다(제안: 코어에 `adjust_credits(p_org_id, p_amount, p_reason, p_ref_type, p_ref_id, p_idempotency_key)`를 추가, 음수 허용, service_role 전용). 환불 정책(기간, 비율)은 제품 01_PRD가 정한다.

## 6. 웹훅 서명 검증과 멱등

| 규칙 | 내용 | 근거 |
|---|---|---|
| 서명 검증 필수 | 제공자 서명 헤더를 검증하고 결과를 `webhook_events.signature_valid`에 기록한다. 실패한 이벤트는 처리하지 않고 `status='ignored'`로 둔다 | `migrations/0002_core_billing.sql:183-201` |
| 멱등 | `(provider, event_id)` 유일. 중복 수신은 INSERT 충돌로 감지해 200으로 응답만 한다 | `:200` |
| 처리 순서 | 수신 → 서명 검증 → INSERT(received) → 처리 → processed 또는 failed(`attempts`, `error`) | 표 컬럼 |
| 결제 웹훅은 보조 | 지급은 confirm 경로가 정본. 웹훅은 상태 동기화(취소, 가상계좌 입금)에만 쓴다 | `docs/reference/00_MERGE_ANALYSIS.md:366` |
| 응답 | 검증 실패 401, 중복 200, 처리 실패 500(재전송 유도) | 제안 |

제공자별 `event_id`: Toss는 웹훅 본문의 `paymentKey + status + 발생시각`을 합쳐 해시(Toss 웹훅에 고유 이벤트 id 필드가 있는지는 미확인), fal은 `request_id`, Make/n8n 콜백은 요청 헤더의 `X-Request-Id`(없으면 본문 해시). 서명 방식은 `SHARED_MODULES.md` webhooks 절에 있다.

## 7. OAuth state

| 규칙 | 내용 | 근거 |
|---|---|---|
| 서버 발급 | `core.create_oauth_state(user, org, app, provider, redirect_to, code_verifier, ttl)`가 32바이트 난수 state를 만든다. 사용자는 이 테이블에 권한이 없다 | `migrations/0004_core_security.sql:508-558` |
| 1회 소비 | `core.consume_oauth_state(state)`는 미소비·미만료 행만 소비한다. 재사용·만료는 `OA001` | `:561-581` |
| TTL | 기본 600초, 최소 60초 | `:555` |
| redirect_to | 같은 사이트 상대 경로만(`'/'`로 시작, `'//'`와 `'@'` 금지) | `:549-551` |
| PKCE | `code_verifier`를 state 행에 보관하고 콜백에서 꺼내 쓴다 | `:515` |
| 멤버 검증 | 발급 시 user가 org의 활성 멤버인지 확인 | `:545-547` |
| 정리 | `purge_expired_oauth_states()` 매일 | `:583-598` |

OAuth state 위조 결함(`docs/reference/00_MERGE_ANALYSIS.md:526`, `:614`)의 차단 설계다.

## 8. 암호화된 자격증명

| 규칙 | 내용 | 근거 |
|---|---|---|
| 저장 형식 | `core.encrypted_credentials.ciphertext`에 AES-256-GCM 암호문만. 평문 컬럼 없음. `key_version`으로 키 세대를 기록 | `migrations/0004_core_security.sql:600-623` |
| 키 위치 | 환경변수(버전별)로만 존재. DB에 키를 두지 않는다. 키가 없으면 앱이 기동 실패해야 한다(0키 폴백 금지, `docs/reference/00_MERGE_ANALYSIS.md:621`) | 주석 `:602` |
| 유일성 | `(org_id, app_id, provider, external_account_id)` | `:622` |
| 사용자 읽기 | `core.credential_summaries` 뷰(암호문 제외, 멤버십 필터) | `:634-639` |
| 사용자 쓰기 | `revoke_credential(id)`만(owner/admin). 암호문을 비우고 revoked로 바꾼다 | `:642-661` |
| 서버 쓰기 | service_role이 INSERT/UPDATE. 토큰 갱신 시 `last_refreshed_at`, 실패 시 `status='error'`, `last_error` | 표 컬럼 |
| 키 교체 | 제안: 새 버전 키를 환경변수에 추가 → 워커가 `key_version < 현재`인 행을 복호화·재암호화 → 구 키 제거. 복호화 실패 행은 `status='error'` | - |
| 대상 | SNS OAuth 토큰, 마켓 API 키, Toss 빌링키(별도 표), 제휴 제공자 키, 증권사 키(stock-dashboard) | - |

## 9. 잡과 워커

### 9.1 테이블과 상태

`core.jobs`(`migrations/0005_core_jobs_storage.sql:14-47`): `queue`, `job_type`, `payload`, `result`, `status`(queued/running/succeeded/failed/canceled), `priority`, `attempts/max_attempts`, `run_after`, `locked_by/heartbeat_at`, `progress`, `credit_ledger_id`, `refund_on_failure`, `idempotency_key`, `parent_job_id`.

| 전이 | 함수 | 조건 |
|---|---|---|
| (없음) → queued | `enqueue_job` | 멱등 키 같으면 기존 행 |
| queued → running | `claim_jobs(queue, worker_id, limit, job_types)` | `FOR UPDATE SKIP LOCKED`, `run_after <= now()`, priority 오름차순 |
| running → running | `heartbeat_job(job, worker, progress, message)` | 같은 worker만 |
| running → succeeded | `complete_job(job, worker, result)` | 같은 worker만, `JB001` 아니면 |
| running → queued | `fail_job(job, worker, error, retryable=true)` | `attempts < max_attempts`면 지수 백오프(기본 60초 x 2^(attempts-1)) |
| running → failed | `fail_job(..., retryable=false)` 또는 재시도 소진 | `credit_ledger_id`가 있으면 자동 환불 |
| queued → canceled | `cancel_job(job)` | 멤버 또는 service. running은 불가(`JB002`). 환불 포함 |
| running(하트비트 끊김) → queued/failed | `reap_stale_jobs(stale_seconds)` | 스케줄러가 호출 |

근거: `:63-103`, `:108-146`, `:148-167`, `:169-190`, `:193-237`, `:240-267`, `:270-291`.

### 9.2 워커 규약

| 규칙 | 내용 |
|---|---|
| 런타임 | TS(BullMQ FlowProducer)가 오케스트레이션, Python이 Whisper/demucs/FFmpeg 미디어 처리(확정 결정 6, `docs/reference/00_MERGE_ANALYSIS.md:14`) |
| 상태 정본 | BullMQ를 쓰더라도 상태의 정본은 `core.jobs`에 미러링한다(`migrations/0005_core_jobs_storage.sql:10`) |
| 큐 이름 | `<app>.<type>` (`D:/WorkSpace/platform/docs/products/_supabase-modular/ARCHITECTURE.md:77`) |
| 하트비트 | 60초 간격 이하(제안). `reap_stale_jobs(600)`이 10분 무응답을 회수 |
| 진행률 UI | 클라이언트는 `core.jobs`를 RLS 하에서 Realtime 구독(`:293-301`). 별도 broadcast 채널을 만들지 않는다 |
| 페이로드 | 제품이 `04_API.md`에 `job_type`별 payload/result JSON 스키마를 적는다. 비밀값은 payload에 넣지 않고 `encrypted_credentials.id`를 참조한다 |
| 취소 | running 잡의 취소는 워커가 `status`를 주기적으로 확인해 스스로 중단한다(제안: heartbeat 호출의 반환값 false를 취소 신호로 쓴다) |

## 10. Storage

| 규칙 | 내용 | 근거 |
|---|---|---|
| 경로 | `<org_id>/<app_id>/<entity>/<uuid>.<ext>`. 첫 폴더가 org_id | `migrations/0005_core_jobs_storage.sql:305` |
| 버킷 | `org-files`(비공개 50MB), `exports`(비공개 200MB, 서명 URL), `public-assets`(공개 읽기, 10MB 이미지만) | `:322-327` |
| 정책 | `org-files`: 멤버 읽기/쓰기, 삭제는 업로더 본인 또는 owner/admin. `exports`: 서버만 쓰고 멤버는 읽기. `public-assets`: 누구나 읽기, 멤버는 자기 조직 폴더에만 쓰기 | `:330-362` |
| 폴더 판정 | `core.storage_org_id(name)`이 첫 세그먼트를 uuid로 파싱, 아니면 null → 정책 실패 | `:308-320` |
| 서명 URL | `exports`는 서명 URL로만 내려 준다. 유효기간 7일 | 주석 `:306` |
| 보존 | 원본 영상은 작업 완료 후 24시간 내 삭제(`NOMAD Shorts Maker/PRD.md` 16장). 다른 제품의 보존 기간은 01_PRD에서 정한다 | - |

## 11. 감사 로그

| 규칙 | 내용 | 근거 |
|---|---|---|
| 테이블 | `core.audit_log` append-only. `actor_role` user/service/system, `action`, `target_type/id`, `before/after`, `ip`, `user_agent`, `request_id` | `migrations/0004_core_security.sql:236-273` |
| 사용자 경로 | `core.write_audit(org, action, target_type, target_id, before, after, metadata)`. actor는 `auth.uid()`로 강제, 비멤버는 42501 | `:279-307` |
| 서버 경로 | service_role이 직접 INSERT(ip, user_agent, request_id 포함) | guard 트리거 `:271-273` |
| 읽기 | owner/admin과 platform_admin만 | `:771-773` |
| 기록 대상(최소) | 멤버 초대/역할 변경/제거/소유권 이전, 프로필 승인, 구독 전이, 자격증명 revoke, 잡 취소, 대가성 문구 편집, 브랜드커넥트 위험 동의. 추가로 제품은 결제 환불, 플랜 수동 변경(manual entitlement), 데이터 내보내기, 관리자 화면의 모든 쓰기를 기록한다 | 코어 함수 내부 호출 + 제안 |
| action 이름 | `<entity>.<verb>` 소문자 점 표기(`org_member.invite`, `subscription.canceled`) | 코어 함수 사용 예 |
| 보존 | 제안: 2년. hms는 admin-suite 01_PRD에서 별도 결정 | `D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:89` |

## 12. 레이트 리밋

| 규칙 | 내용 | 근거 |
|---|---|---|
| 함수 | `core.rate_limit_hit(key, limit, window_seconds) returns (allowed, remaining, reset_at)`. 고정 윈도우, 호출 1회 = 1히트 | `migrations/0004_core_security.sql:678-699` |
| 키 규약 | `<app>:<route>:<org_id 또는 ip_hash>` (제안) | - |
| 적용 대상 | 생성 API, 로그인/가입, 웹훅 수신, `/r/[code]` 리다이렉트, 비회원 데모 | `docs/reference/00_MERGE_ANALYSIS.md:379`, `:432` |
| Redis가 있는 제품 | video처럼 Upstash Redis를 쓰는 제품은 Redis 카운터를 써도 된다. 키 규약은 같게 한다 | - |
| 정리 | `purge_rate_limit_buckets()` 매일 | `:701-716` |

## 13. 제휴마케팅(affiliate) 모듈

확정 결정 12(`docs/reference/00_MERGE_ANALYSIS.md:20`). video와 blog가 함께 쓴다. commerce는 쓰지 않는다(`:967`). 2026-10-13 확정 결정 19로 브랜드커넥트 지원서를 블로그형/클립형으로 나눴다(16.1절).

### 13.1 모델

| 객체 | 계약 | 근거 |
|---|---|---|
| `core.affiliate_accounts` | org별 제공자 연결. provider는 coupang / naver_brandconnect / tenping / naver_shopping_connect. 키는 `credential_id`로 `encrypted_credentials`를 가리킨다. `risk_consented_at/by`는 브랜드커넥트 자동 지원 동의 | `migrations/0006_core_affiliate.sql:24-49` |
| `core.affiliate_links` | 원본 URL, 제휴 URL, `short_code`(유일), `utm` jsonb, `source_app`(video/blog), `source_ref`, `click_count` 캐시 | `:54-84` |
| `core.affiliate_clicks` | 클릭 로그. IP는 일 단위 솔트 해시만. owner/admin만 읽는다 | `:90-105`, `:393-395` |
| `core.affiliate_disclosures` | 대가성 문구. `org_id null`은 플랫폼 기본값. placement blog_top / video_description / video_pinned_comment. 끄는 컬럼이 없다. 10자 미만 거부 | `:112-136` |
| `core.brandconnect_applications` | 브랜드커넥트 지원서. 대상은 `target_url`(https) + `target_kind`(blog/clip) + `source_app`(blog/video)이고, 짝은 blog↔blog, clip↔video만 허용(CHECK `brandconnect_applications_kind_app_check`). 상태 draft → submitting → submitted → accepted/rejected, submitting → failed → submitting. 트리거가 강제 | `:144-211` |

### 13.2 함수

| 함수 | 누가 | 동작 | 근거 |
|---|---|---|---|
| `new_affiliate_short_code(len=8)` | service_role | 혼동 문자 제외 32자 알파벳 난수, 충돌 재시도 5회 | `:218-242` |
| `record_affiliate_click(code, referrer, ip_hash, ua, country)` | service_role | 클릭 INSERT + 카운트 증가 + 제휴 URL 반환. 비활성/없음이면 null | `:245-268` |
| `effective_disclosure(org, provider, placement)` | 멤버 | org 문구 우선, 없으면 기본값 | `:271-286` |
| `upsert_affiliate_disclosure(org, provider, placement, body)` | owner/admin | 편집만. 삭제/끄기 경로 없음 | `:289-311` |
| `consent_brandconnect_risk(account)` | owner/admin | 동의 시각 기록 + 감사 | `:314-335` |
| `create_brandconnect_application(account, campaign, target_url, target_kind, source_app, ...)` | 멤버 | 동의 없으면 42501. `source_app` 앱 엔타이틀먼트 없으면 42501. 짝이 맞지 않으면 23514(CHECK). 제출은 워커. 이전 7인자 시그니처(`blog_url`)는 제거 | `:338-377` |

### 13.3 규칙

| 규칙 | 내용 | 근거 |
|---|---|---|
| 대가성 문구 위치 | 공정위 "추천·보증 등에 관한 표시·광고 심사지침"에 따라 제목 또는 본문 시작 부분에 둔다. blog는 글 상단(blog_top), video는 설명란 첫 줄(video_description)과 고정 댓글(video_pinned_comment). 네이버 클립(`naver_clip`)은 설명란·고정 댓글 구조가 확인되지 않아, video 앱이 `video_description` 문구를 **제목 앞머리 + 첫 번째 해시태그(#광고 등)**로 렌더한다(영상은 제목·영상 내·첫 해시태그 표시 원칙). placement 값은 늘리지 않는다 | 확정 결정 12·18, `seed.sql:114-115` |
| 끌 수 없음 | 사용자는 문구를 편집할 수 있지만 비울 수 없다(CHECK 10자). 삽입을 끄는 설정은 제품 UI에도 두지 않는다 | `:121`, `:288` |
| 단축 링크 | `/r/[code]` 라우트가 service_role로 `record_affiliate_click`을 호출하고 302 리다이렉트. 레이트 리밋 적용 | 7, 12장 |
| UTM | `utm` jsonb에 `utm_source=<app>`, `utm_medium=affiliate`, `utm_campaign=<source_ref>`, `utm_content=<provider>`를 넣고 제휴 URL에 붙인다(제안). 제공자가 UTM을 허용하지 않으면 생략 | - |
| 브랜드커넥트 | Playwright 어댑터는 blog가 소유. 완전 자동 지원은 네이버 약관 위반·계정 정지 위험이 있어 owner/admin 위험 동의가 필수. 실제 제출은 `core.jobs` `job_type='brandconnect.apply'` 워커가 하고, 상태 전이는 트리거가 강제한다. 레이트 리밋(계정당 5건/시간)은 blog·video 요청을 합산한다 | `:13-15`, `:139-142` |
| 클립형 캠페인 | 네이버 브랜드커넥트는 클립 크리에이터와 캠페인사의 제휴를 지원한다([이코노미스트 2025-06](https://economist.co.kr/article/view/ecn202506130009)). 클립형 지원서는 video가 만든다(`target_kind='clip'`, `source_app='video'`, `target_url`=클립 채널 주소). video는 같은 `brandconnect.apply` 잡을 cross-app으로 요청하고, 워커는 blog의 어댑터로 제출한다(`SHARED_MODULES.md` 17장). 같은 네이버 계정의 `affiliate_accounts` 행과 위험 동의를 공유한다 | 확정 결정 19 |
| 쇼핑 커넥트 | 네이버 브랜드커넥트의 어필리에이트 솔루션(스마트스토어 상품 홍보, 판매 실적 수익 공유, [네이버 보도자료](https://www.navercorp.com/media/pressReleasesDetail?seq=33116)). provider `naver_shopping_connect`로 이미 있다 | 확정 결정 12 |
| 미확인 | 텐핑과 네이버쇼핑 커넥트에 공개 API가 있는지 확인하지 않았다. 없으면 Playwright 또는 수동 링크 등록으로 대체한다 | 확정 결정 12 |
| 제안 단계 | YouTube "유료 프로모션 포함" 플래그 자동 설정은 제안이며 확정이 아니다 | 확정 결정 12 |

### 13.4 기본 문구

`seed.sql:117-131`에 제공자 x 배치 12행이 있다. 쿠팡은 쿠팡 파트너스 고지 문구 원문이고 나머지는 심사지침 기준 공통 문구(제안)다.

## 14. 스케줄

pg_cron 또는 워커 크론으로 service_role이 호출한다(`D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:132-143`).

| 주기 | 호출 | 목적 |
|---|---|---|
| 매일 00:10 KST | `core.run_monthly_credit_grants()` | 월 플랜 크레딧 지급, 무료 구독 기간 굴림, 해지 예약 만료 |
| 매 10분 | `core.reap_stale_jobs(600)` | 하트비트 끊긴 잡 회수 |
| 매 시간 | `core.expire_stale_payment_orders()` | 미승인 주문 만료 |
| 매일 | `core.purge_expired_oauth_states()`, `core.purge_rate_limit_buckets()` | 정리 |
| 매일(워커) | 빌링키 갱신 청구 | 5.3절 |

모놀리스에서는 `run_subscription_rollover()`가 따로 있다(`DB_CONVENTIONS.md` 9장).

## 15. SQLSTATE 코드

| 코드 | 의미 | 발생 함수 |
|---|---|---|
| `42501` | 권한 없음(EXECUTE 없음, 역할 검사 실패, guard 트리거) | 전체 |
| `22023` | 인자 오류 | 전체 |
| `P0002` | 대상 없음 | 멤버 함수, 잡 |
| `CR000` | 원장 변경 시도 | `credit_ledger_immutable` |
| `CR001` | 크레딧 부족 | `consume_credits` |
| `CR002` | consume 행 아님 | `refund_credits` |
| `CR003` | 환불 가능액 초과 | `refund_credits` |
| `SB001` | 허용되지 않은 구독 전이 | `apply_subscription_transition` |
| `PM001` | 금액 불일치 | `confirm_payment_order` |
| `PM404` | 주문 없음 | `confirm_payment_order` |
| `PM409` | 다른 결제키로 재확인 | `confirm_payment_order` |
| `PM410` | 주문 상태 불가 | `confirm_payment_order`, `fail_payment_order` |
| `OA001` | OAuth state 무효 | `consume_oauth_state` |
| `JB001` | 잡이 해당 워커의 running 상태가 아님 | `complete_job`, `fail_job` |
| `JB002` | queued가 아닌 잡 취소 | `cancel_job` |
| `AU000` | 감사 로그 변경 시도 | `audit_log_immutable` |
| `AI001` | 플랫폼이 오픈소스를 강제한 범위를 조직이 풀려고 함 | `set_ai_routing` |

제품 Route Handler는 이 코드를 HTTP로 매핑한다(제안): `42501` → 403, `CR001` → 402, `P0002`/`PM404` → 404, `22023`/`SB001`/`JB002`/`PM410` → 409, `PM001`/`PM409` → 409 + 운영 알림, `OA001` → 400, `AI001` → 403.

## 16. 코어 변경 규칙

| 규칙 | 내용 |
|---|---|
| 담당 | 코어 SQL 변경은 Fable 5.1(`D:/WorkSpace/platform/docs/products/README.md:51`, `ARCHITECTURE.md:76`) |
| 적용 조건 | 전 제품 RLS/RPC 회귀 테스트 통과 후에만(`ARCHITECTURE.md:76`). 검사 항목은 `README.md:145-156` |
| 번호 | 0000~0099 (`D:/WorkSpace/platform/docs/products/README.md:9`). 현재 코어는 0009까지(0008 AI, 0009 음성). 다음 코어 마이그레이션은 0010 |
| 제품이 코어를 바꾸고 싶으면 | 제품 06_AGENT_PLAN에 "코어 요청" 작업으로 적고 `_platform-core`에 이슈를 남긴다. 제품 조각에서 `core.*`를 ALTER하지 않는다 |

### 16.1 변경 이력

| 날짜 | 변경 | 근거 | 영향 |
|---|---|---|---|
| 2026-10-13 | `core.brandconnect_applications.blog_url` → `target_url` + `target_kind`(blog/clip) + `source_app`(blog/video), 짝 CHECK 추가. `create_brandconnect_application`을 9인자로 바꾸고 `source_app` 엔타이틀먼트 검사 추가. 이전 시그니처 drop | 확정 결정 19(`docs/reference/00_MERGE_ANALYSIS.md`) | `0006_core_affiliate.sql`, `MONOLITH_CORE_LITE.sql`, 모든 제품 모놀리스 `0001_core_lite.sql`(권한 목록 시그니처), blog `posts` 트리거(블로그형만 연결), `SHARED_MODULES.md` 17장 `applyCampaign`. 회귀: `_tools-sqlcheck`로 코어 0000~0009 + blog/video 체인 통과 |

## 17. AI, 음성, 위키 계약 (2026-10-13 추가)

설계 정본은 `AI_ARCHITECTURE.md`, `VOICE_ARCHITECTURE.md`, `LLM_WIKI.md`다. 이 장은 코어 계약 관점의 요약이다.

| 계약 | 내용 |
|---|---|
| SQL 객체 | 0008: 테이블 13개(`ai_providers`, `ai_model_prices`, `ai_routing_settings`, `ai_collections`, `ai_documents`, `ai_chunks`, `wiki_pages`, `wiki_links`, `wiki_revisions`, `ai_conversations`, `ai_messages`, `ai_runs`, `ai_run_steps` + 스키마 `ai_runtime`), 함수 `match_ai_chunks`, `resolve_ai_route`, `set_ai_routing`, `wiki_revisions_immutable`, 확장 `vector`(`extensions` 스키마). 0009: `voice_sessions`, `voice_jobs`, `expire_voice_audio`, 버킷 `voice-audio`. 정확한 목록은 파일이 정본(`migrations/0008_core_ai.sql`, `0009_core_voice.sql`) |
| 쓰기 경로 | AI·위키·음성 테이블 쓰기는 FastAPI와 Next.js 서버의 service_role만. 사용자가 부를 수 있는 RPC는 `set_ai_routing`뿐(owner/admin) |
| 조직 격리 | FastAPI는 서명 토큰의 `org`·`app`만 신뢰한다(`SECURITY_BASELINE.md` 16장). `match_ai_chunks`는 org·app 필터를 강제하고 service_role만 호출 |
| 강제 오픈소스 | `force_open_source` 범위는 조직 관리자가 풀 수 없다. 시도하면 `AI001` |
| 크레딧 | AI·음성 사용은 `ai_usage` 기록 + `consume_credits`/`refund_credits`(4장 규약 그대로) |
| 잡 | RAG 색인, 위키 ingest/lint, 장시간 그래프, 음성 만료 정리는 `core.jobs`(9장) |


## 18. 인증 단계 (2026-10-14 추가, 확정 결정 22)

정본은 `AUTH_ROADMAP.md`다. 이 장은 코어 계약에 닿는 부분만 적는다.

| 항목 | 계약 | 근거 |
|---|---|---|
| 단계 | A Mock(로컬 시드 계정, MVP 개발) → G1 → B Google(+제품 PRD의 이메일·초대 메일) → G2 → C1 카카오, C2 네이버 | `AUTH_ROADMAP.md` 0장 |
| 세션 | 모든 단계에서 실제 Supabase Auth JWT. `session_context`(2.3절)와 RLS는 단계와 무관하게 같다 | `AUTH_ROADMAP.md` 0장 불변 조건 |
| OAuth 첫 로그인 부트스트랩 | `signInWithOAuth`는 `options.data.signup_app`을 보낼 수 없다. 모듈러에서는 가입 트리거(`migrations/0001_core_identity.sql:113`)가 엔타이틀먼트를 만들지 않으므로, 콜백이 `entitled=false`이고 앱 `signup_policy`가 open·approval이면 `rpc('bootstrap_app_for_org', { p_app_id })`를 1회 호출한다(`migrations/0003_core_credits.sql:440-461`, 가입·월 크레딧은 멱등 키로 1회). invite 앱은 호출하지 않는다. 모놀리스는 앱 행이 1개면 트리거가 자동 부트스트랩하므로 호출이 무동작이다 | `AUTH_ROADMAP.md` 3.2절 |
| Mock 계정 | `auth.admin.createUser(..., email_confirm: true, user_metadata: { signup_app })`로 만들어 실제 가입 트리거를 탄다. 역할은 `invite_member`·`accept_invite` RPC로 맞춘다. 원격 DB에는 만들지 않는다 | `AUTH_ROADMAP.md` 2.3절 |
| 네이버 | Supabase 커스텀 제공자 `custom:naver`가 1순위(스파이크로 확인). 실패하면 서버 브리지 + 보류 마이그레이션 `staged/0010_core_auth_identity_links.sql`(service_role 쓰기, 본인 SELECT). `core.oauth_states`는 로그인 전 사용자·조직이 없어 로그인 state에 쓰지 않는다 | `AUTH_ROADMAP.md` 7.2절 |
| 감사 | 로그인 콜백은 `auth.login`(provider, 첫 로그인 여부), 계정 연결은 `auth.identity_link`·`auth.identity_unlink`를 남긴다. 토큰·코드는 남기지 않는다 | `AUTH_ROADMAP.md` 3.2절, 7.3절 |
