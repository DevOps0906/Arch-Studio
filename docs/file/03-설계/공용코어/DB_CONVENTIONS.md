# DB_CONVENTIONS: 제품 스키마 작성 규칙

작성일 2026-10-12. 제품 에이전트가 모듈러 조각(`_supabase-modular/migrations/<번호>_<schema>.sql`)과 모놀리스 마이그레이션(`<제품>/supabase/monolith/`)을 쓸 때 따르는 규칙이다. 코어 SQL이 이미 쓰고 있는 패턴을 규칙으로 옮겼으므로 근거는 대부분 `D:/WorkSpace/platform/docs/products/_supabase-modular/migrations/0000~0009`이다(아래 `migrations/`). PostgreSQL 15, Supabase 표준 객체만 쓴다(`D:/WorkSpace/platform/docs/products/_PRODUCT_AGENT_BRIEF.md:68`).

## 1. 이름 규칙

| 대상 | 규칙 | 예 | 근거 |
|---|---|---|---|
| 스키마 | 제품 스키마 이름 = `core.apps.id` = README 표의 모듈러 스키마 | `video`, `blog`, `publishing` | `D:/WorkSpace/platform/docs/products/README.md:7-23`, `migrations/0002_core_billing.sql:10` |
| 테이블 | snake_case 복수형. 접두사 없음(스키마가 구분) | `video.jobs_meta`, `blog.posts` | `migrations/0001`~`0006` 전체 |
| 컬럼 | snake_case. 외래키는 `<entity>_id`. 불리언은 `is_`/`has_`/동사형(`carry_over`) | `org_id`, `is_active`, `refund_on_failure` | `migrations/0002_core_billing.sql:37`, `migrations/0005_core_jobs_storage.sql:35` |
| 시각 | `<event>_at` timestamptz | `created_at`, `confirmed_at`, `risk_consented_at` | 코어 전체 |
| 암호문 | `<name>_ciphertext` + `key_version` | `billing_key_ciphertext` | `migrations/0002_core_billing.sql:74-75` |
| 인덱스 | `<tbl>_<cols 또는 목적>_idx`. 부분 유니크는 `_uniq` 또는 `_idx` | `jobs_claim_idx`, `affiliate_disclosures_org_uniq` | `migrations/0005_core_jobs_storage.sql:44`, `migrations/0006_core_affiliate.sql:126` |
| CHECK 제약 | `<tbl>_<col>_check` | `plans_interval_check` | `migrations/0002_core_billing.sql:34` |
| 정책 | `<tbl>_<op>` 또는 `<tbl>_<op>_<who>` | `wallets_select`, `organizations_update_admin` | `migrations/0004_core_security.sql:738`, `:765` |
| 트리거 | `<tbl>_<purpose>` | `jobs_set_updated_at`, `org_members_guard_write` | `migrations/0005_core_jobs_storage.sql:50`, `migrations/0001_core_identity.sql:90` |
| 함수 | 동사_명사. 판정 함수는 `is_`/`has_` | `consume_credits`, `is_org_member` | 코어 전체 |
| RPC 인자 | `p_` 접두사 | `p_org_id` | `migrations/0003_core_credits.sql:131-139` |
| 변수 | `v_` 접두사 | `v_plan` | 코어 전체 |
| 큐/채널 | 큐 `<app>.<type>`, Realtime 채널 `<app>:<org>:<entity>` | `video.render`, `video:<org>:jobs` | `D:/WorkSpace/platform/docs/products/_supabase-modular/ARCHITECTURE.md:77` |
| 사용자 정의 SQLSTATE | 도메인 2글자 + 숫자 3자리. 코어는 CR/PM/SB/OA/JB/AU 사용. 제품은 스키마 머리글자 2자(제안: video `VD`, blog `BL`, publishing `PB`, astro `AS`, commerce `CM`, microweb `MW`, erp `ER`, sms `SM`, poll `PL`, stock `ST`, toon `TN`, notes `NT`, site `SI`, docs `DC`, news `NW`, trailer `TR`, arch `AR`(제안)) | `VD001` | `CORE_SPEC.md` 15장 |

## 2. 모듈러 DB: 제품당 스키마 1개와 번호 범위

| 범위 | 스키마 | 제품 |
|---|---|---|
| 0000~0099 | `core` | _platform-core |
| 1000~1099 | `publishing` | flora-publishing |
| 1100~1199 | `astro` | astro-ai |
| 1200~1299 | `video` | sceneflow |
| 1300~1399 | `blog` | nomad-blog |
| 1400~1499 | `commerce` | nomad-commerce |
| 1500~1599 | `microweb` | microweb-studio |
| 1600~1699 | `erp` | admin-suite (ERP) |
| 1700~1799 | `sms` | admin-suite (School) |
| 1800~1899 | `poll` | live-poll |
| 1900~1999 | `stock` | stock-dashboard |
| 2000~2099 | `toon` | toon-factory |
| 2100~2199 | `notes` | study-note |
| 2200~2299 | `site` | website-floria |
| 2300~2399 | `docs` | nomad-docs |
| 2400~2499 | `arch`(제안) | arch-studio(PRD 초안, 조각 없음) |
| 2500~2599 | `news` | local-news |
| 2600~2699 | `trailer` | book-trailer |

근거: `D:/WorkSpace/platform/docs/products/README.md:7-23`, `D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:46-61`. 같은 범위 안에서는 10 단위로 올린다(`1000`, `1010`). hms는 모듈러에 없다(확정 결정 2). `public`에는 제품 테이블을 만들지 않는다(`README.md:78`).

파일 머리 템플릿(`D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:96-102`):

```sql
-- =====================================================================
-- 1200_video.sql
-- sceneflow 도메인. 선행: core 0000~0009
-- =====================================================================
create schema if not exists video;
grant usage on schema video to anon, authenticated, service_role;
alter default privileges in schema video grant all on tables to service_role;
alter default privileges in schema video grant all on sequences to service_role;
alter default privileges in schema video grant execute on functions to service_role;
alter default privileges in schema video revoke execute on functions from public;
-- 주의: 위 줄은 PostgreSQL 전역 기본 PUBLIC EXECUTE를 없애지 못한다. 조각 끝에 `revoke execute on all functions in schema video from public;`을 반드시 둔다(SECURITY_BASELINE 3절).

insert into core.apps (id, name, schema_name, signup_policy) values ('video', 'SceneFlow', 'video', 'open')
on conflict (id) do nothing;
```

PostgREST 노출: `config.toml` `[api].schemas`에 스키마를 추가하고 타입을 재생성한다(`README.md:63-78`). 클라이언트는 `supabase.schema('video').from(...)`로 접근한다.

## 3. 표준 컬럼

| 컬럼 | 정의 | 규칙 | 근거 |
|---|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | 사용자에게 노출되는 엔티티. 로그/원장처럼 쓰기만 많은 테이블은 `bigint generated always as identity` | `migrations/0002_core_billing.sql:27`, `migrations/0003_core_credits.sql:30` |
| `org_id` | `uuid not null references core.organizations(id) on delete cascade` | 모든 테넌트 테이블 필수. 조직 삭제 시 연쇄 삭제 | `D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:104` |
| `app_id` | `text references core.apps(id)` | 코어 테이블처럼 여러 앱이 쓰는 테이블에만. 제품 스키마 안에서는 불필요 | `migrations/0005_core_jobs_storage.sql:17` |
| `created_at` | `timestamptz not null default now()` | 필수 | 코어 전체 |
| `updated_at` | `timestamptz not null default now()` + `set_updated_at` 트리거 | UPDATE가 있는 테이블 필수 | 5장 |
| `created_by` | `uuid` (FK 없음) | 행위자. `auth.users` FK를 걸지 않는다. 사용자 삭제가 업무 기록을 지우거나 막지 않게 하기 위해 | `migrations/0002_core_billing.sql:149`, `migrations/0005_core_jobs_storage.sql:38` |
| `deleted_at` | `timestamptz` | 소프트 삭제가 필요한 엔티티만. 정책에 `deleted_at is null` 포함 | `migrations/0001_core_identity.sql:39`, `migrations/0004_core_security.sql:737` |
| `status` | `text not null default '<initial>' check (...)` | 6장 | 코어 전체 |
| `metadata` | `jsonb not null default '{}'::jsonb` | 느슨한 부가 정보. 비밀값 금지 | `migrations/0002_core_billing.sql:152` |
| `idempotency_key` | `text unique` | 외부 요청과 1:1인 테이블 | 8장 |

## 4. 타임스탬프

| 규칙 | 이유 |
|---|---|
| 항상 `timestamptz`. `timestamp`(without time zone)와 `date`에 시각을 넣지 않는다 | 세 관리 앱이 모두 UTC/KST 경계 버그를 냈다(`docs/reference/00_MERGE_ANALYSIS.md:1157`) |
| DB는 UTC로 저장하고 KST 변환은 조회 시 `at time zone 'Asia/Seoul'` 또는 앱의 `kstDayRange()`로 | 같은 근거 |
| "오늘" 집계는 KST 자정 경계를 서버가 계산해 timestamptz 범위로 질의 | `:1232` |
| 스케줄 표기는 UTC 크론 + KST 주석 | `D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:138` |
| 만료는 `expires_at timestamptz`로 두고 `now()`와 비교. 클라이언트 시계를 믿지 않는다 | `migrations/0004_core_security.sql:516`, `:574` |

## 5. updated_at 트리거

모든 UPDATE 가능한 테이블에 코어 함수를 그대로 붙인다. 제품 스키마에 같은 함수를 다시 만들지 않는다.

```sql
drop trigger if exists posts_set_updated_at on blog.posts;
create trigger posts_set_updated_at before update on blog.posts
  for each row execute function core.set_updated_at();
```

근거: `migrations/0000_core_extensions_and_schema.sql:32-41`, 적용 예 `migrations/0001_core_identity.sql:66-74`. `drop trigger if exists` + `create trigger`로 반복 실행 가능하게 쓴다(`README.md:16`).

## 6. 열거형은 text + CHECK

```sql
status text not null default 'draft'
       constraint posts_status_check check (status in ('draft', 'scheduled', 'published', 'failed'))
```

| 이유 | 설명 |
|---|---|
| 변경 비용 | `create type ... as enum`은 값 추가/삭제/이름 변경이 어렵고 트랜잭션 안에서 새 값을 바로 쓸 수 없다. CHECK는 `alter table drop constraint / add constraint`로 끝난다 |
| 타입 생성 | `supabase gen types`가 CHECK 값을 리터럴 유니온으로 만들지는 않으므로, 제품 TS에 `as const` 배열을 두고 zod로 검증한다 |
| 코어와 일관 | 코어 전 테이블이 이 방식이다(`migrations/0001_core_identity.sql:18-21`, `migrations/0005_core_jobs_storage.sql:22-23`) |

상태 전이가 있으면 CHECK만으로 부족하다. 10장의 전이 트리거 또는 RPC를 붙인다.

## 7. RLS 기본값

| 규칙 | 내용 | 근거 |
|---|---|---|
| 모든 테이블 RLS ON | 정책이 없는 동안은 전부 거부(안전 기본값) | `D:/WorkSpace/platform/docs/products/_supabase-modular/README.md:32`, `_PRODUCT_AGENT_BRIEF.md:69` |
| SELECT 정책 | `core.is_org_member(org_id) and core.has_entitlement(org_id, '<app>')` | `README.md:111-112` |
| 쓰기 기본값 "없음" | 쓰기는 service_role 또는 SECURITY DEFINER RPC. 사용자에게 쓰기 정책을 줄 때는 8장 조건을 만족해야 한다 | `migrations/0004_core_security.sql:718-720` |
| 쓰기 정책에는 반드시 `with check` | `using`만 있는 UPDATE 정책은 org_id를 다른 조직으로 바꾸는 것을 막지 못한다 | `README.md:105` |
| `FOR ALL` 정책 금지 | 플랜/크레딧 셀프 변경 결함의 원인 | `docs/reference/00_MERGE_ANALYSIS.md:87` |
| 정책 안에서 `org_members`를 직접 조회하지 않는다 | SECURITY DEFINER 헬퍼(`is_org_member` 등)만 쓴다. 자기참조 재귀 42P17 방지 | `migrations/0004_core_security.sql:13-14`, `00_MERGE_ANALYSIS.md:1145` |
| 삭제는 owner/admin | `core.has_org_role(org_id, array['owner','admin'])` | `README.md:117-118` |
| 공개 읽기 | anon에게 SELECT를 주는 테이블은 `is_public`/`status='published'` 같은 명시 컬럼으로 필터하고 비공개 컬럼은 뷰로 가린다 | `migrations/0004_core_security.sql:749-754` 패턴 |
| 플랫폼 운영자 | `core.is_platform_admin()`을 SELECT 정책에 OR로 더할 수 있다. 쓰기는 service_role로 | `:737` |
| 뷰 | 사용자용 뷰는 `with (security_invoker = true)`로 RLS를 통과시키거나, 정의자 뷰면 뷰 안에서 멤버십 필터를 건다 | `migrations/0003_core_credits.sql:106-107`, `migrations/0002_core_billing.sql:243-251` |
| GRANT | RLS는 권한을 대신하지 않는다. `grant select, insert, update, delete on <tbl> to authenticated`를 정책과 함께 명시한다. 모듈러 제품 스키마에는 기본 권한이 없다 | `README.md:109` |

제품 테이블 정책 템플릿(`README.md:107-119`):

```sql
alter table blog.posts enable row level security;
grant select, insert, update on blog.posts to authenticated;   -- delete 는 owner/admin 만이라도 grant 는 필요
grant delete on blog.posts to authenticated;

create policy posts_select on blog.posts for select to authenticated
  using (core.is_org_member(org_id) and core.has_entitlement(org_id, 'blog'));
create policy posts_insert on blog.posts for insert to authenticated
  with check (core.is_org_member(org_id) and core.has_entitlement(org_id, 'blog'));
create policy posts_update on blog.posts for update to authenticated
  using (core.is_org_member(org_id)) with check (core.is_org_member(org_id));
create policy posts_delete on blog.posts for delete to authenticated
  using (core.has_org_role(org_id, array['owner', 'admin']));
```

## 8. 쓰기 경로와 `guard_privileged_write` 이중 잠금

### 8.1 어느 테이블에 쓰기 정책을 줄 수 있는가

| 테이블 성격 | 사용자 쓰기 | 방법 |
|---|---|---|
| 순수 콘텐츠(원고, 프로젝트 설정, 초안) | 허용 | 7장 템플릿. `with check` 필수 |
| 돈, 권한, 한도, 상태 전이, 외부 발행 결과가 있는 테이블 | 금지 | SELECT 정책만 + `guard_privileged_write` 트리거 + SECURITY DEFINER RPC 또는 service_role |
| 로그/원장 | 금지 | append-only 트리거 + guard |

### 8.2 이중 잠금 붙이기

정책이 없는 테이블에도 트리거를 붙여, 실수로 정책이나 GRANT가 열려도 사용자 세션 쓰기가 42501로 거부되게 한다.

```sql
drop trigger if exists channel_uploads_guard_write on video.channel_uploads;
create trigger channel_uploads_guard_write before insert or update or delete on video.channel_uploads
  for each row execute function core.guard_privileged_write();
```

근거: `migrations/0000_core_extensions_and_schema.sql:92-111`, 일괄 적용 예 `migrations/0002_core_billing.sql:232-240`. 트리거는 `is_privileged_session()`을 쓰므로 service_role과 DEFINER 함수 안에서는 통과한다(`SECURITY_BASELINE.md` 1장).

### 8.3 SECURITY DEFINER RPC 템플릿

```sql
create or replace function blog.publish_post(p_post_id uuid)
returns blog.posts
language plpgsql
security definer
set search_path = ''                                   -- 필수
as $$
declare v_row blog.posts;
begin
  select * into v_row from blog.posts where id = p_post_id for update;   -- 스키마 한정 + 잠금
  if not found then
    raise exception 'publish_post: not found' using errcode = 'P0002';
  end if;
  if not core.is_service_caller()                      -- 규칙 1: DEFINER 안에서는 is_privileged_session 금지
     and not core.has_org_role(v_row.org_id, array['owner', 'admin', 'member']) then
    raise exception 'publish_post: not a member' using errcode = '42501';
  end if;
  if not core.has_entitlement(v_row.org_id, 'blog') then
    raise exception 'publish_post: no entitlement' using errcode = '42501';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'publish_post: invalid state %', v_row.status using errcode = 'BL001';
  end if;
  update blog.posts set status = 'scheduled' where id = p_post_id returning * into v_row;
  perform core.write_audit(v_row.org_id, 'post.publish', 'post', p_post_id::text);
  return v_row;
end;
$$;
revoke execute on function blog.publish_post(uuid) from public, anon;
grant execute on function blog.publish_post(uuid) to authenticated;
```

점검표: `set search_path = ''` / 모든 객체 스키마 한정 / `is_service_caller` / 역할 비교는 `has_org_role` 또는 `coalesce` / 상태 검사 / 감사 / EXECUTE 정리. service_role 전용이면 `is_privileged_session`을 쓰고 `grant execute ... to service_role`만 준다(`migrations/0003_core_credits.sql:369-375`).

## 9. 멱등 키

| 규칙 | 내용 | 근거 |
|---|---|---|
| 컬럼 | `idempotency_key text unique`(nullable) | `migrations/0003_core_credits.sql:42`, `migrations/0005_core_jobs_storage.sql:36` |
| 검사 패턴 | `pg_advisory_xact_lock(hashtext('<domain>:' \|\| key))` → 기존 행 조회 → 있으면 반환, 없으면 INSERT | `migrations/0003_core_credits.sql:160-167` |
| 키 형식 | `<domain>:<app>:<external id>`. 코어 형식은 `CORE_SPEC.md` 4.4 | `:426`, `:431`, `:593` |
| 외부 요청 id | 클라이언트가 요청마다 UUID `request_id`를 보낸다. 서버는 그것으로 `consume:<app>:<request_id>`, `job:<app>:<request_id>`를 만든다 | `SHARED_MODULES.md` 18장 |
| 웹훅 | `(provider, event_id)` 유니크가 멱등 키 역할 | `migrations/0002_core_billing.sql:200` |
| 외부 발행 | 플랫폼 게시 결과(`platform_post_id`)는 `(channel_id, platform_post_id)` 유니크로 중복 발행을 막는다 | 제안 |

## 10. 상태 컬럼과 전이

| 규칙 | 내용 | 근거 |
|---|---|---|
| 정의 | text + CHECK(6장) | |
| 전이 강제 | (a) 전이 트리거: 허용 (old, new) 쌍 외에는 22023으로 거부. service_role 쓰기에도 적용된다 (b) 전이 RPC: `apply_<entity>_transition(id, to, reason)` 형태 | (a) `migrations/0006_core_affiliate.sql:189-211` (b) `migrations/0002_core_billing.sql:265-341` |
| 선택 기준 | 전이에 부수 효과(엔타이틀먼트 동기화, 환불, 감사)가 있으면 RPC. 단순 순서 강제면 트리거 | |
| 문서화 | 제품 05_DATA_MODEL에 "현재 → 허용 전이 → 누가" 표를 둔다(예약, 검사, 판매, 발행) | `docs/reference/00_MERGE_ANALYSIS.md:1241` |
| 시각 | 전이마다 `<state>_at` 컬럼(`submitted_at`, `decided_at`) | `migrations/0006_core_affiliate.sql:169-170` |

## 11. `core.apps` 등록과 코어 참조

| 규칙 | 내용 | 근거 |
|---|---|---|
| 등록 | 조각 머리에서 `insert into core.apps ... on conflict (id) do nothing`. seed에 이미 있으면 생략 가능하나 조각 단독 적용을 위해 두는 편이 안전 | `README.md:121-126`, `seed.sql:12-27` |
| 플랜 | 기본 플랜 1행(`is_default=true`)은 seed에 둔다. 금액은 01_PRD가 정본 | `seed.sql:32-49` |
| FK | 테넌트 테이블은 `core.organizations(id)`를 참조. `core.plans`, `core.jobs(id)`, `core.credit_ledger(id)`, `core.encrypted_credentials(id)` 참조 가능 | `migrations/0006_core_affiliate.sql:30`, `:158` |
| 헬퍼 | 정책과 함수에서 `core.is_org_member`, `has_org_role`, `has_entitlement`, `entitled_plan_code`, `current_org_ids`, `is_platform_admin`, `is_service_caller`, `write_audit`, `set_updated_at`, `guard_privileged_write`를 그대로 쓴다 | `migrations/0004_core_security.sql:6-12` |
| 재정의 금지 | 플랜/구독/크레딧/결제/잡/자격증명 테이블을 제품 스키마에 다시 만들지 않는다. `core.*` 객체를 ALTER하지 않는다 | `README.md:128` |
| 크레딧 호출 | 제품 SQL 함수 안에서 `core.consume_credits` 등을 호출하려면 그 함수도 service_role 전용이어야 한다. 사용자용 RPC 안에서 크레딧을 직접 차감하지 않는다(차감은 Route Handler/워커의 service_role 호출로) | `migrations/0003_core_credits.sql:10` |
| features 해석 | `plans.features` jsonb 키의 의미는 제품 01_PRD 요금 절에 표로 적는다. 서버만 읽는다 | `migrations/0002_core_billing.sql:48` |
| 잡 타입 | `job_type`은 `<domain>.<action>` 소문자(`render.pdf`, `upload.youtube`, `brandconnect.apply`). 페이로드 스키마는 04_API | `migrations/0006_core_affiliate.sql:142` |

## 12. 모놀리스 vs 모듈러

| 항목 | 모듈러(`_supabase-modular`) | 모놀리스(`MONOLITH_CORE_LITE.sql`) |
|---|---|---|
| 코어 위치 | `core` 스키마, 파일 10개(0000~0009. 모놀리스 쪽은 SECTION 11 AI, 12 음성) | `public` 스키마, 파일 1개 |
| 제품 테이블 위치 | 제품 스키마 | `public` |
| 함수 접두사 | `core.` | `public.`(이름·시그니처 동일). 앱은 `SUPABASE_DB_SCHEMA`로 전환 |
| 기본 권한 | core 스키마에 기본 권한 없음 → 명시 GRANT만 | Supabase가 public에 anon/authenticated ALL을 기본 부여 → 코어가 회수(SECTION 0, 10). 제품 테이블도 명시 GRANT 필요 |
| 가입 부트스트랩 | `signup_app` 메타데이터 필수 | 메타데이터 없고 `apps` 행이 1개면 그 앱으로 자동 |
| 월 지급 | `run_monthly_credit_grants()` 하나(기간 굴림 + 지급 + 만료) | `run_subscription_rollover()`(SECTION 2) + `run_monthly_credit_grants()`(SECTION 4, 내부에서 rollover 호출). 크레딧 절을 지워도 구독 유지 |
| RLS 정책 위치 | 0004에 모음 | 각 절 안(절 단위 삭제 가능) |
| `subscriptions.billing_key_id` | FK → `core.billing_keys` | FK 없는 uuid(결제 절 삭제 가능하게) |
| `session_context.credit_balance` | wallets 직접 조회 | `to_regclass('public.wallets')` 확인 후 동적 조회(크레딧 절 없으면 0) |
| `confirm_payment_order` 월 크레딧 | 항상 `grant_credits` 호출 | `to_regprocedure` 확인 후 호출(크레딧 절 없으면 건너뜀) |
| 선택 절 | 없음(전부 적용) | SECTION 3(Toss), 4(크레딧), 6-A/B/C(OAuth/자격증명/레이트리밋), 7(잡), 8(Storage), 9(affiliate) 삭제 가능 |
| PostgREST 노출 | `config.toml [api].schemas`에 제품 스키마 추가 | 기본(public) |
| 타입 생성 | `--schema core,<product>` | 기본 |
| 파일 이름 | `migrations/<번호>_<schema>.sql` | `supabase/monolith/migrations/0001_core_lite.sql`, `0002_<product>_domain.sql`, `seed.sql` |
| 적용 대상 | 기본값(전 제품) | hms(강제), stock-dashboard, 고객사별 분리 admin-suite |

두 구조 사이의 이동 절차는 `D:/WorkSpace/platform/docs/products/_supabase-modular/ARCHITECTURE.md:48-68`에 있다.

모놀리스 도메인 마이그레이션은 모듈러 조각과 같은 본문을 쓰되 (a) `create schema` 블록 제거, (b) `core.` → `public.`, (c) `<schema>.<tbl>` → `public.<tbl>`, (d) 모든 테이블에 `revoke all on table ... from public, anon, authenticated` 뒤 필요한 GRANT만. 제안: 제품 폴더에 두 파일을 따로 두지 말고 조각 하나를 `sed`로 변환하는 스크립트를 06_AGENT_PLAN 작업으로 둔다.

## 13. 검증

### 13.1 도구

| 도구 | 사용 | 위치 |
|---|---|---|
| PGlite 체커 | `node check.mjs <label> <file.sql> ...` 가 OK를 출력해야 한다. pg_cron 등 확장은 스텁 처리 | `D:/WorkSpace/platform/docs/products/_tools-sqlcheck/check.mjs`, `prelude.sql` |
| RLS 스모크 테스트 | `auth.users`에 사용자 2명 삽입 → `set role authenticated` + `set_config('request.jwt.claim.role', 'authenticated')` + `set_config('request.jwt.claim.sub', <uuid>)` → B가 A 데이터 0행, 역할/크레딧/플랜 자기 변경 42501 확인. 항목은 `SECURITY_BASELINE.md` 15장 | 제품 저장소 `supabase/tests/`(제안) |
| 로컬 Supabase | `supabase db reset` 후 `README.md:145-156` 검사 | |
| PGlite 체커 `--vector` | pgvector가 필요한 SQL(0008 이후, `MONOLITH_CORE_LITE.sql` SECTION 11)은 `node check.mjs --vector <label> <file.sql> ...`로 검사한다. 0.5.x PGlite에 pgvector가 없어서 0.3.15(별칭 `pglite-vec`)를 쓴다. `--vector` 없이 돌리면 `vector` 확장을 스텁 처리하므로 AI 테이블 검사가 안 된다 | `D:/WorkSpace/platform/docs/products/_tools-sqlcheck/check.mjs:1-3` |

### 13.2 MONOLITH_CORE_LITE.sql 검증 결과 (2026-10-12, PGlite)

체커: OK. 스모크 테스트 62항목 중 61 통과. 주요 항목:

| 검사 | 기대 | 실제 |
|---|---|---|
| 가입: profiles / organizations / owner 멤버십 / entitlement / 지갑 30 | 1 / 1 / 1 / 1 / 30 | 1 / 1 / 1 / 1 / 30 |
| B가 A의 organizations, org_members, profiles, wallets, credit_ledger, app_entitlements, subscriptions, payment_orders, jobs, affiliate_links, audit_log | 0 | 0 |
| B `update org_members set role` / `insert org_members` | 42501 | 42501 |
| B `rpc change_member_role` / `invite_member` / `transfer_ownership` (A 조직, NULL-safe) | 42501 | 42501 |
| B `insert credit_ledger` / `update wallets` / `rpc grant_credits` / `consume_credits` / `refund_credits` | 42501 | 42501 |
| B `update app_entitlements.plan_id` / `update subscriptions.plan_id` / `insert payment_orders` / `rpc confirm_payment_order` | 42501 | 42501 |
| B `update profiles.platform_role` / A의 `status` / 자기 `organizations.owner_id` | 42501 | 42501 |
| B 자기 `display_name` 변경(양성 대조) / A 조직 이름 변경 | 1행 / 0행 | 1행 / 0행 |
| B `rpc cancel_job`(A 잡) / `enqueue_job` / `write_audit`(A) / `upsert_affiliate_disclosure`(A) / `record_affiliate_click` / `create_oauth_state` | 42501 | 42501 |
| B `select encrypted_credentials` / `webhook_events` | 42501 | 42501 |
| B `session_context('video')` org = 자기 조직 / plan_code / credit_balance | true / starter / 30 | true / starter / 30 |
| service `grant_credits` 같은 키 2회 | 같은 ledger_id | 같음 |
| service 잔액 초과 consume / 환불 초과 / 원장 UPDATE | CR001 / CR003 / CR000 | 일치 |
| service `confirm_payment_order` 금액 불일치 | PM001 | PM001 |
| service 금액 불일치 뒤 주문 상태 | failed(README.md:153) | **created** (raise가 UPDATE를 롤백. 0003:577-583 동일. 코어 결함으로 보고) |
| service `fail_job(retryable=false)` → 환불 행 / 지갑 / drift | 1 / 130 / 0 | 1 / 130 / 0 |
| service OAuth state 재사용 | OA001 | OA001 |
| service `record_affiliate_click` | 제휴 URL 반환 | 일치 |

### 13.3 제품이 추가할 검사

| 검사 | 기대 |
|---|---|
| B가 A 조직의 제품 테이블 SELECT | 0행 |
| B가 자기 조직 제품 테이블에 `org_id = A`로 INSERT | 42501 (with check) |
| B가 자기 행의 `org_id`를 A로 UPDATE | 42501 (with check) |
| 엔타이틀먼트 없는 조직(C)이 제품 테이블 SELECT | 0행 |
| member가 owner/admin 전용 DELETE | 0행 또는 42501 |
| 상태 전이 위반 | 22023 또는 제품 코드 |
| 제품 RPC를 비멤버가 호출 | 42501 |

## 14. pgvector와 ai_runtime 규약 (2026-10-13 추가)

| 항목 | 규칙 | 근거 |
|---|---|---|
| 확장 위치 | `create extension if not exists vector with schema extensions`. 타입은 `extensions.vector(1024)`처럼 스키마를 붙여 쓴다 | `migrations/0008_core_ai.sql:18`, `:112-126` |
| 차원 | 1024(Voyage 기본, 제안). 컬렉션마다 임베딩 제공자·모델·차원을 기록한다 | `AI_ARCHITECTURE.md` 5장 |
| 모델 혼용 금지 | 한 컬렉션에는 임베딩 모델 하나만. 모델을 바꾸면 컬렉션 단위로 재색인한다 | 같은 곳 |
| 인덱스 | HNSW + cosine: `using hnsw (embedding extensions.vector_cosine_ops)`. 조직·앱·컬렉션 b-tree 인덱스를 함께 둔다 | `migrations/0008_core_ai.sql:126-127` |
| 연산자 | `search_path=''` 함수 안에서는 `embedding operator(extensions.<=>) p_embedding`처럼 스키마 한정 연산자를 쓴다. `<=>`만 쓰면 해석되지 않는다 | `migrations/0008_core_ai.sql:307-345` |
| 검색 함수 | org·app 필터를 함수 안에서 강제하고 service_role만 호출(PUBLIC EXECUTE 회수). 제품이 `ai_chunks`를 직접 SELECT하는 검색 쿼리를 만들지 않는다 | `SECURITY_BASELINE.md` 16장 |
| `ai_runtime` 스키마 | LangGraph 체크포인트(`langgraph-checkpoint-postgres` `setup()`이 표준 테이블 생성). service_role만 `usage, create`, 다른 역할은 모두 회수. 제품 SQL이 이 스키마를 건드리지 않는다. PostgREST 노출 스키마에 넣지 않는다 | `migrations/0008_core_ai.sql:262-265` |
| 모놀리스 | `public` 스키마에 같은 이름·시그니처. 확장은 `extensions` 스키마 유지 | `MONOLITH_CORE_LITE.sql` SECTION 11 |
| 검증 | 0008 이후 SQL은 `check.mjs --vector`로만 검사한다(13.1) | `D:/WorkSpace/platform/docs/products/_tools-sqlcheck/check.mjs` |

