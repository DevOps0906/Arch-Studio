-- =====================================================================
-- 2400_arch.sql
-- arch-studio 도메인 (Arch Studio, 가칭: 설치형 AI 건축 설계실무 앱 Tauri + 클라우드). 선행: core 0000~0009
-- 설계 문서: docs/products/arch-studio/05_DATA_MODEL.md (정본은 이 조각, 모놀리스 0002_arch_domain.sql 은 변환본)
--
-- 구조
--   카탈로그(플랫폼 소유, org 없음, 쓰기 service_role): runtime_config(운영 상수·크레딧 단가), license_skus(영구 라이선스 상품),
--                                                    builds(데스크톱 빌드), rule_packs → rule_pack_changes(법규 규칙 팩), cost_catalogs(공사비 단가표)
--   라이선스(조직 소유, 쓰기 service_role 또는 RPC)   : licenses → license_activations(영구 라이선스 기기 + 체험·월 구독 기기)
--   조직 설정·사본(쓰기 RPC)                        : drafting_profiles(표제란·레이어 매핑, 조직당 1행), cloud_projects(클라우드 사본, version)
--   AI 실행 기록(쓰기 service_role)                  : renders, reviews, intake_runs, proposals (상태 queued → running → succeeded | failed → refunded)
--   남용 방지(사용자 접근 없음)                      : site_lookups(지번 HMAC 해시와 날짜만, 주소 원문 없음)
--   로컬 SQLite(데스크톱, 클래스 B)는 이 파일에 없다. 05_DATA_MODEL.md 2.16절이 정본이다.
--
-- 보안 원칙 (SECURITY_BASELINE.md, DB_CONVENTIONS.md 7~8장)
--   - 모든 테이블 RLS ON. 사용자 쓰기 정책·쓰기 GRANT 는 하나도 없다. 쓰기는 service_role 또는 SECURITY DEFINER RPC 뿐이다.
--   - 플랜·크레딧·라이선스·활성화는 사용자가 스스로 바꿀 수 없다(GRANT 없음 + guard 트리거 이중 잠금 + 상태 전이 트리거).
--   - 시리얼은 SHA-256 해시와 끝 5자만 저장한다. 원문은 issue_license 반환값에서 한 번만 나온다.
--   - 조직은 클라이언트 입력을 믿지 않는다: service RPC 는 Route Handler 가 세션에서 정한 p_org 만 받고,
--     authenticated RPC 는 멤버십·역할을 다시 확인한다(p_org 가 null 이면 개인 조직).
--   - 크레딧 선차감 + 실행 행 + 잡 enqueue 는 service_role 전용 start_ai_run 한 트랜잭션. 멱등 키 consume:arch:<request_id>.
--   - Storage 경로는 서버가 만든 <org_id>/arch/<purpose>/[<project_ref>/]<uuid>.<ext> 만 받는다(정규식, '..' 불가).
--   - 모든 DEFINER 함수는 set search_path = '' + 스키마 한정, 끝에서 PUBLIC/anon EXECUTE 회수 후 허용 목록만 부여.
-- SQLSTATE(04_API.md 7.1절): AR001 활성화 한도, AR002 시리얼 무효, AR003 라이선스 정지·환불·회수(또는 플랜 기기 자격 없음),
--   AR004 셀프 해제 한도, AR011 규칙 팩 자격 없음, AR012 폴백 상태 클라우드 검토 불가, AR020 대지 조회 일일 상한,
--   AR030 렌더 동시 3건, AR031 입력 크기 초과, AR032 intake 스키마 실패, AR033 출처 없는 검토 결과,
--   AR034 일일 플랫폼 크레딧 상한(이 조각 신규, 04장 앱 코드 AI_DAILY_LIMIT 에 대응), AR040 클라우드 사본 상한,
--   AR041 버전 충돌, AR042 표제란 설정 권한 없음. 상태 전이 위반은 22023(DB_CONVENTIONS 10장).
-- 코어 ALTER 0건. 영구 라이선스 결제는 코어 요청 C-1(payment_orders.kind 일회성) 반영 전에는 issue_license 가 거부한다(PRD D-3).
-- 반복 실행 가능.
-- =====================================================================

-- @modular-only-begin (모놀리스 변환 시 이 블록은 제거된다: 스키마·기본 권한·apps 행은 모놀리스 seed.sql 과 코어가 맡는다)
create schema if not exists arch;
comment on schema arch is 'arch-studio: 설치형 AI 건축 설계실무 앱 (라이선스, 기기, 빌드·규칙 팩, 표제란, 클라우드 사본, AI 실행)';
grant usage on schema arch to anon, authenticated, service_role;
alter default privileges in schema arch grant all on tables to service_role;
alter default privileges in schema arch grant all on sequences to service_role;
alter default privileges in schema arch grant execute on functions to service_role;
alter default privileges in schema arch revoke execute on functions from public;
-- 주의: 위 줄은 PostgreSQL 전역 기본 PUBLIC EXECUTE 를 없애지 못한다. 10절에서 함수 목록 전체를 회수한다.

insert into core.apps (id, name, schema_name, signup_policy, status)
values ('arch', 'Arch Studio', 'arch', 'open', 'beta')
on conflict (id) do nothing;
-- @modular-only-end

-- =====================================================================
-- 1. 카탈로그 테이블 (플랫폼 소유)
-- =====================================================================

-- 운영 상수와 크레딧 단가. 단가(price.<variant>)는 apps/web/src/server/ai/pricing.ts 와 같은 값이어야 한다(계약 14 #1).
create table if not exists arch.runtime_config (
  key        text primary key constraint runtime_config_key_check check (key ~ '^[a-z][a-z0-9_.]{1,63}$'),
  value_int  integer not null,
  note       text,
  updated_at timestamptz not null default now()
);

-- 영구 라이선스 상품(PRD 4.1). fallback_features 는 "영구 + 업데이트 만료" 상태의 기능 값(PRD 4.8·9.4 폴백 열).
create table if not exists arch.license_skus (
  code                    text primary key constraint license_skus_code_check check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name                    text not null constraint license_skus_name_check check (char_length(name) between 1 and 80),
  price_krw               integer not null constraint license_skus_price_check check (price_krw > 0),
  includes_updates_months integer not null default 12 constraint license_skus_updates_check check (includes_updates_months between 0 and 60),
  bonus_credits           integer not null default 0 constraint license_skus_bonus_check check (bonus_credits >= 0),
  max_activations         integer not null default 2 constraint license_skus_max_act_check check (max_activations between 1 and 10),
  max_quantity            integer constraint license_skus_qty_check check (max_quantity is null or max_quantity > 0),
  fallback_features       jsonb not null default '{}'::jsonb constraint license_skus_fallback_check check (jsonb_typeof(fallback_features) = 'object'),
  is_active               boolean not null default true,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 데스크톱 빌드(Tauri 업데이터). build_date <= licenses.updates_until 인 빌드만 받는다(PRD 4.4).
create table if not exists arch.builds (
  id           uuid primary key default gen_random_uuid(),
  version      text not null constraint builds_version_check check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$'),
  platform     text not null constraint builds_platform_check check (platform ~ '^(windows|darwin)-(x86_64|aarch64)$'),
  channel      text not null default 'stable' constraint builds_channel_check check (channel in ('stable', 'beta')),
  status       text not null default 'draft' constraint builds_status_check check (status in ('draft', 'published', 'withdrawn')),
  build_date   date not null,
  storage_path text not null constraint builds_path_check check (storage_path ~ '^builds/(stable|beta)/[0-9.]+/[A-Za-z0-9._-]{1,120}$'),
  signature    text not null constraint builds_signature_check check (char_length(signature) between 16 and 2000),
  sha256       text not null constraint builds_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes        bigint not null constraint builds_bytes_check check (bytes > 0),
  notes        text constraint builds_notes_check check (notes is null or char_length(notes) <= 4000),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (platform, channel, version),
  constraint builds_published_check check (status = 'draft' or published_at is not null)
);

-- 법규 규칙 팩(서명 매니페스트 JSON, 버킷 arch-releases). published_at <= updates_until 인 팩만 폴백 조직에 준다.
create table if not exists arch.rule_packs (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique constraint rule_packs_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$'),
  status       text not null default 'draft' constraint rule_packs_status_check check (status in ('draft', 'published', 'withdrawn')),
  basis_date   date not null,
  summary      text constraint rule_packs_summary_check check (summary is null or char_length(summary) <= 2000),
  storage_path text not null constraint rule_packs_path_check check (storage_path ~ '^rule-packs/[0-9.]+/pack\.json$'),
  sha256       text not null constraint rule_packs_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  signature    text not null constraint rule_packs_signature_check check (char_length(signature) between 16 and 512),
  kid          text not null constraint rule_packs_kid_check check (kid ~ '^[A-Za-z0-9_-]{1,40}$'),
  bytes        bigint not null constraint rule_packs_bytes_check check (bytes > 0),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint rule_packs_published_check check (status = 'draft' or published_at is not null)
);

-- 팩 사이 개정 목록(제목·시행일만). 폴백 배너 "이후 개정 n건"의 출처(PRD 4.3).
create table if not exists arch.rule_pack_changes (
  id             uuid primary key default gen_random_uuid(),
  rule_pack_id   uuid not null references arch.rule_packs(id) on delete cascade,
  title          text not null constraint rule_pack_changes_title_check check (char_length(title) between 1 and 200),
  kind           text not null constraint rule_pack_changes_kind_check check (kind in ('law', 'decree', 'rule', 'ordinance', 'interpretation')),
  effective_from date not null,
  law_ref        text constraint rule_pack_changes_ref_check check (law_ref is null or char_length(law_ref) <= 200),
  created_at     timestamptz not null default now()
);

-- 개략 공사비 단가표(AR-F-012). 내용은 RPC latest_cost_catalog 로만 준다(자격별 버전 선택).
create table if not exists arch.cost_catalogs (
  id           uuid primary key default gen_random_uuid(),
  version      text not null unique constraint cost_catalogs_version_check check (version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$'),
  status       text not null default 'draft' constraint cost_catalogs_status_check check (status in ('draft', 'published', 'withdrawn')),
  basis_date   date not null,
  items        jsonb not null constraint cost_catalogs_items_check check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 1048576),
  source_note  text not null constraint cost_catalogs_source_check check (char_length(source_note) between 1 and 1000),
  sha256       text not null constraint cost_catalogs_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cost_catalogs_published_check check (status = 'draft' or published_at is not null)
);

-- =====================================================================
-- 2. 라이선스와 기기 활성화 (조직 소유, 쓰기는 service_role / RPC)
-- =====================================================================

create table if not exists arch.licenses (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references core.organizations(id) on delete cascade,
  sku_code            text not null references arch.license_skus(code),
  order_id            uuid unique references core.payment_orders(id) on delete restrict,   -- null = 운영 수동 발급(감사 필수)
  serial_hash         text not null unique constraint licenses_serial_hash_check check (serial_hash ~ '^[0-9a-f]{64}$'),
  serial_last5        text not null constraint licenses_serial_last5_check check (serial_last5 ~ '^[0-9A-HJKMNP-TV-Z]{5}$'),
  status              text not null default 'active'
                      constraint licenses_status_check check (status in ('active', 'suspended', 'refunded', 'revoked')),
  purchased_at        timestamptz not null default now(),
  updates_until       date not null,
  max_activations     integer not null default 2 constraint licenses_max_act_check check (max_activations between 1 and 10),
  extension_order_ids uuid[] not null default '{}',                      -- extend_updates 멱등(주문 id 목록)
  status_changed_at   timestamptz,
  status_reason       text constraint licenses_reason_check check (status_reason is null or char_length(status_reason) <= 300),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, org_id)
);
create index if not exists licenses_org_idx on arch.licenses (org_id, status);

-- 기기 활성화. source='license' 는 영구 라이선스(license_id 필수), 'plan' 은 체험·월 구독(license_id null, 계약 14 #6).
create table if not exists arch.license_activations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references core.organizations(id) on delete cascade,
  license_id        uuid,
  source            text not null constraint license_activations_source_check check (source in ('license', 'plan')),
  device_hash       text not null constraint license_activations_device_check check (device_hash ~ '^[0-9a-f]{64}$'),
  device_label      text constraint license_activations_label_check check (device_label is null or char_length(device_label) <= 60),
  activated_by      uuid,
  activated_at      timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  deactivated_at    timestamptz,
  deactivated_by    uuid,
  deactivation_kind text constraint license_activations_kind_check check (deactivation_kind is null or deactivation_kind in ('self', 'support', 'refund', 'revoke')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint license_activations_source_ref_check check ((source = 'license') = (license_id is not null)),
  constraint license_activations_deactivated_check check ((deactivated_at is null) = (deactivation_kind is null)),
  foreign key (license_id, org_id) references arch.licenses (id, org_id) on delete cascade
);
create unique index if not exists license_activations_license_device_uniq
  on arch.license_activations (license_id, device_hash) where deactivated_at is null and license_id is not null;
create unique index if not exists license_activations_plan_device_uniq
  on arch.license_activations (org_id, device_hash) where deactivated_at is null and source = 'plan';
create index if not exists license_activations_active_idx on arch.license_activations (license_id) where deactivated_at is null;
create index if not exists license_activations_self_idx on arch.license_activations (org_id, deactivated_at) where deactivation_kind = 'self';

-- =====================================================================
-- 3. 조직 설정과 클라우드 사본
-- =====================================================================

-- 표제란·레이어 매핑(조직당 1행). 건축주 이름·연락처는 저장하지 않는다(PRD 9.7: 시트에 넣을 때만 로컬에서).
create table if not exists arch.drafting_profiles (
  org_id                 uuid primary key references core.organizations(id) on delete cascade,
  office_name            text not null constraint drafting_profiles_office_check check (char_length(btrim(office_name)) between 1 and 100),
  architect_name         text constraint drafting_profiles_architect_check check (architect_name is null or char_length(architect_name) <= 50),
  contact                text constraint drafting_profiles_contact_check check (contact is null or char_length(contact) <= 100),
  logo_storage_path      text,
  layer_map              jsonb not null default '{}'::jsonb constraint drafting_profiles_layer_map_check check (jsonb_typeof(layer_map) = 'object'),
  default_paper          text not null default 'A3' constraint drafting_profiles_paper_check check (default_paper in ('A3', 'A2', 'A1')),
  default_text_height_mm numeric(3, 1) not null default 2.5 constraint drafting_profiles_text_check check (default_text_height_mm between 2.0 and 5.0),
  font_family            text not null default 'Noto Sans KR' constraint drafting_profiles_font_check check (font_family ~ '^[A-Za-z0-9 가-힣_-]{1,64}$'),
  updated_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint drafting_profiles_logo_check check (
    logo_storage_path is null
    or logo_storage_path ~ ('^' || org_id::text || '/arch/drafting-logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'))
);

-- 클라우드 사본(사용자가 올린 프로젝트 스냅샷, 클래스 A). 동기화 아님(클래스 C 는 Phase 2). version 은 저장마다 +1(AR041).
create table if not exists arch.cloud_projects (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  local_id     uuid not null,
  name         text not null constraint cloud_projects_name_check check (char_length(btrim(name)) between 1 and 120),
  storage_path text not null,
  version      integer not null default 1 constraint cloud_projects_version_check check (version >= 1),
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, local_id),
  constraint cloud_projects_path_check check (
    storage_path ~ ('^' || org_id::text || '/arch/project_snapshot/' || local_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'))
);
create index if not exists cloud_projects_org_updated_idx on arch.cloud_projects (org_id, updated_at desc);

-- =====================================================================
-- 4. AI 실행 기록 (쓰기는 service_role 만). 실행 1건 = 제품 행 1 + core.jobs 1(02장 4절)
-- =====================================================================

create table if not exists arch.renders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references core.organizations(id) on delete cascade,
  project_ref      uuid not null,
  request_id       uuid not null unique,
  variant          text not null constraint renders_variant_check check (variant in ('render_std', 'render_hq', 'upscale')),
  status           text not null default 'queued' constraint renders_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'refunded')),
  credits          integer not null constraint renders_credits_check check (credits >= 0),
  credit_ledger_id bigint references core.credit_ledger(id),
  job_id           uuid references core.jobs(id) on delete set null,
  options          jsonb not null default '{}'::jsonb constraint renders_options_check check (jsonb_typeof(options) = 'object' and pg_column_size(options) <= 16384),
  source_render_id uuid,
  output_path      text,
  width            integer constraint renders_width_check check (width is null or width between 64 and 8192),
  height           integer constraint renders_height_check check (height is null or height between 64 and 8192),
  bytes            bigint,
  provider         text,
  model            text,
  seed             bigint,
  ai_label         boolean not null default true,
  expires_at       timestamptz,
  purged_at        timestamptz,
  error            text constraint renders_error_check check (error is null or char_length(error) <= 1000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  unique (id, org_id),
  foreign key (source_render_id, org_id) references arch.renders (id, org_id),
  constraint renders_output_check check (status <> 'succeeded' or (output_path is not null and expires_at is not null and ai_label)),
  constraint renders_upscale_check check ((variant = 'upscale') = (source_render_id is not null))
);
create index if not exists renders_active_idx on arch.renders (org_id, status) where status in ('queued', 'running');
create index if not exists renders_org_created_idx on arch.renders (org_id, created_at desc);
create index if not exists renders_expiry_idx on arch.renders (expires_at) where status = 'succeeded' and purged_at is null;

create table if not exists arch.reviews (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references core.organizations(id) on delete cascade,
  project_ref        uuid not null,
  request_id         uuid not null unique,
  variant            text not null default 'review' constraint reviews_variant_check check (variant = 'review'),
  status             text not null default 'queued' constraint reviews_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'refunded')),
  credits            integer not null constraint reviews_credits_check check (credits >= 0),
  credit_ledger_id   bigint references core.credit_ledger(id),
  job_id             uuid references core.jobs(id) on delete set null,
  rule_pack_version  text not null constraint reviews_pack_check check (rule_pack_version ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$'),
  application_date   date not null,
  municipality_code  text not null constraint reviews_muni_check check (municipality_code ~ '^[0-9]{5,10}$'),
  judgment           jsonb not null constraint reviews_judgment_check check (jsonb_typeof(judgment) = 'object' and pg_column_size(judgment) <= 262144),
  model_summary      jsonb not null default '{}'::jsonb constraint reviews_summary_check check (jsonb_typeof(model_summary) = 'object' and pg_column_size(model_summary) <= 16384),
  result             jsonb constraint reviews_result_check check (result is null or pg_column_size(result) <= 524288),
  disclaimer_version text,
  error              text constraint reviews_error_check check (error is null or char_length(error) <= 1000),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  updated_at         timestamptz not null default now(),
  constraint reviews_output_check check (status <> 'succeeded' or result is not null)
);
create index if not exists reviews_org_created_idx on arch.reviews (org_id, created_at desc);
create index if not exists reviews_active_idx on arch.reviews (org_id, status) where status in ('queued', 'running');

-- 대화형 설계 입력(AR-F-034, source chat)과 상담 녹음 후보(AR-F-015, source consult). 같은 잡 arch.intake(계약 14 #4)
create table if not exists arch.intake_runs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references core.organizations(id) on delete cascade,
  project_ref      uuid not null,
  request_id       uuid not null unique,
  variant          text not null constraint intake_runs_variant_check check (variant in ('intake_text', 'intake_consult')),
  source           text not null constraint intake_runs_source_check check (source in ('chat', 'consult')),
  input_kind       text not null default 'text' constraint intake_runs_input_kind_check check (input_kind in ('text', 'voice')),
  status           text not null default 'queued' constraint intake_runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'refunded')),
  credits          integer not null constraint intake_runs_credits_check check (credits >= 0),
  credit_ledger_id bigint references core.credit_ledger(id),
  job_id           uuid references core.jobs(id) on delete set null,
  input_text       text constraint intake_runs_text_check check (input_text is null or char_length(input_text) between 1 and 4000),
  stt_job_id       uuid references core.jobs(id) on delete set null,
  notice_version   text constraint intake_runs_notice_check check (notice_version is null or notice_version ~ '^[a-z0-9._-]{1,40}$'),
  result           jsonb constraint intake_runs_result_check check (result is null or pg_column_size(result) <= 131072),
  expires_at       timestamptz not null default (now() + interval '90 days'),
  error            text constraint intake_runs_error_check check (error is null or char_length(error) <= 1000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  constraint intake_runs_variant_source_check check ((variant = 'intake_consult') = (source = 'consult')),
  constraint intake_runs_input_check check (
    (source = 'chat' and input_kind = 'text' and input_text is not null)
    or (source = 'chat' and input_kind = 'voice' and stt_job_id is not null)
    or (source = 'consult' and input_kind = 'voice' and stt_job_id is not null and input_text is null and notice_version is not null)),
  constraint intake_runs_output_check check (status <> 'succeeded' or result is not null)
);
create index if not exists intake_runs_org_created_idx on arch.intake_runs (org_id, created_at desc);
create index if not exists intake_runs_expiry_idx on arch.intake_runs (expires_at);

-- 제안서·템플릿 문서 PDF 실행(계약 14 #3). 시트 SVG 경로 배열, 결과 PDF 경로(exports 버킷)
create table if not exists arch.proposals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references core.organizations(id) on delete cascade,
  project_ref      uuid not null,
  request_id       uuid not null unique,
  variant          text not null constraint proposals_variant_check check (variant in ('proposal', 'doc_template')),
  doc_kind         text not null constraint proposals_doc_kind_check check (doc_kind in ('proposal', 'overview', 'area_table', 'cost')),
  status           text not null default 'queued' constraint proposals_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'refunded')),
  credits          integer not null constraint proposals_credits_check check (credits >= 0),
  credit_ledger_id bigint references core.credit_ledger(id),
  job_id           uuid references core.jobs(id) on delete set null,
  template_version text not null constraint proposals_template_check check (template_version ~ '^[a-z0-9._-]{1,40}$'),
  content_path     text not null,
  content_sha256   text not null constraint proposals_content_sha_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  render_ids       uuid[] not null default '{}' constraint proposals_render_ids_check check (cardinality(render_ids) <= 12),
  sheet_paths      text[] not null default '{}' constraint proposals_sheet_paths_check check (cardinality(sheet_paths) <= 20),
  pdf_path         text,
  pages            integer constraint proposals_pages_check check (pages is null or pages between 1 and 200),
  bytes            bigint,
  narrative        jsonb,
  error            text constraint proposals_error_check check (error is null or char_length(error) <= 1000),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  constraint proposals_variant_kind_check check ((variant = 'proposal') = (doc_kind = 'proposal')),
  constraint proposals_output_check check (status <> 'succeeded' or pdf_path is not null)
);
create index if not exists proposals_org_created_idx on arch.proposals (org_id, created_at desc);
create index if not exists proposals_template_reuse_idx on arch.proposals (org_id, content_sha256, template_version) where status = 'succeeded';

-- 대지 조회 일일 상한 집계. pnu_hash 는 서버 비밀 키 HMAC-SHA-256(지번은 열거 가능하므로 단순 해시 금지). 주소 원문 없음.
create table if not exists arch.site_lookups (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references core.organizations(id) on delete cascade,
  lookup_date date not null,
  pnu_hash    text not null constraint site_lookups_hash_check check (pnu_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  unique (org_id, lookup_date, pnu_hash)
);
create index if not exists site_lookups_created_idx on arch.site_lookups (created_at);

-- =====================================================================
-- 5. 헬퍼 함수
-- =====================================================================

-- 현재 사용자가 arch 엔타이틀먼트가 있는 조직의 활성 멤버인가(카탈로그 읽기 정책용)
create or replace function arch.has_arch_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.org_members m
    join core.app_entitlements e on e.org_id = m.org_id
    where m.user_id = auth.uid() and m.status = 'active'
      and e.app_id = 'arch' and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

create or replace function arch.config_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.value_int from arch.runtime_config c where c.key = p_key), p_default);
$$;

create or replace function arch.feature_int(p_features jsonb, p_key text, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_features -> p_key) = 'number' then (p_features ->> p_key)::integer else p_default end;
$$;

create or replace function arch.feature_bool(p_features jsonb, p_key text, p_default boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_features -> p_key) = 'boolean' then (p_features ->> p_key)::boolean else p_default end;
$$;

-- 한국 날짜(일일 상한·업데이트 기간 비교)
create or replace function arch.kst_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

-- 서버가 만든 사용자 업로드 경로인가: <org_id>/arch/<purpose>/[<project_ref>/]<uuid>.<ext> (계약 14 #9, 04_API.md:20)
create or replace function arch.valid_user_path(p_org uuid, p_purpose text, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_org is not null and p_purpose ~ '^[a-z][a-z_-]{2,31}$' and p_path is not null and char_length(p_path) <= 300
     and p_path ~ ('^' || p_org::text || '/arch/' || p_purpose
                   || '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?'
                   || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$');
$$;

-- 호출자가 고를 조직: p_org 가 null 이면 개인 조직. 멤버가 아니면 42501. (authenticated RPC 안에서만 쓴다)
create or replace function arch.caller_org(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid := coalesce(p_org, core.personal_org_id());
begin
  if v_org is null or not core.is_org_member(v_org) then
    raise exception 'caller_org: not a member' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- 무작위 시리얼 본문: Crockford Base32 20자(100비트). 바이트 하위 5비트 = 균등 분포(256 = 32 x 8).
create or replace function arch.new_serial_body()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(20);
  v_out text := '';
  i integer;
begin
  for i in 0..19 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- 조직의 최종 기능 값(PRD 4.3·4.8·9.4). 영구 라이선스 상태 + 플랜 features 를 서버가 합친다. 클라이언트 값은 쓰지 않는다.
create or replace function arch.org_features(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- PRD 4.8·9.4 "키가 없을 때" 열
  v_missing constant jsonb := '{"cloud_review": false, "rule_pack_updates": false, "ai_render": false, "local_gpu_render": false,
    "render_max_px": 1024, "site_lookups_per_day": 10, "ai_chat_turns_per_day": 20, "cloud_projects_max": 3, "max_activations": 1,
    "drafting_watermark": true, "ai_intake": false, "ai_layout": false}';
  -- 체험 만료·구독 만료(라이선스 없음) = "열람·내보내기만"(PRD 4.3, 9.4). 제안: 대지 조회·채팅·플랜 기기 0
  v_expired constant jsonb := '{"cloud_review": false, "rule_pack_updates": false, "ai_render": false, "local_gpu_render": false,
    "render_max_px": 1024, "site_lookups_per_day": 0, "ai_chat_turns_per_day": 0, "cloud_projects_max": 3, "max_activations": 0,
    "drafting_watermark": true, "ai_intake": false, "ai_layout": false}';
  v_plan_code   text;
  v_plan_feat   jsonb;
  v_ent_status  text;
  v_ent_created timestamptz;
  v_ent_expires timestamptz;
  v_ent_active  boolean := false;
  v_lic_until   date;
  v_lic_ids     jsonb;
  v_state       text;
  v_feat        jsonb;
  v_trial_end   timestamptz;
  v_out         jsonb;
begin
  if p_org is null then
    raise exception 'org_features: org required' using errcode = '22023';
  end if;
  if not core.is_service_caller() and not core.is_org_member(p_org) then
    raise exception 'org_features: not a member' using errcode = '42501';
  end if;

  select p.code, p.features, e.status, e.created_at, e.expires_at
    into v_plan_code, v_plan_feat, v_ent_status, v_ent_created, v_ent_expires
  from core.app_entitlements e join core.plans p on p.id = e.plan_id
  where e.org_id = p_org and e.app_id = 'arch';
  if found then
    v_ent_active := v_ent_status = 'active' and (v_ent_expires is null or v_ent_expires > now());
  end if;

  select max(l.updates_until), coalesce(jsonb_agg(l.id order by l.purchased_at), '[]'::jsonb)
    into v_lic_until, v_lic_ids
  from arch.licenses l where l.org_id = p_org and l.status = 'active';

  if v_lic_until is not null and v_lic_until >= arch.kst_today() then
    v_state := 'licensed';      -- "영구 + 업데이트 유효" = updates_yearly 열
    select p.features into v_feat from core.plans p where p.app_id = 'arch' and p.code = 'updates_yearly';
  elsif v_ent_active and v_plan_code = 'sub_monthly' then
    v_state := 'subscribed';
    v_feat := v_plan_feat;
  elsif v_lic_until is not null then
    v_state := 'licensed_fallback';
    select s.fallback_features into v_feat
    from arch.licenses l join arch.license_skus s on s.code = l.sku_code
    where l.org_id = p_org and l.status = 'active'
    order by l.updates_until desc, l.purchased_at limit 1;
  elsif v_ent_active and v_plan_code = 'trial'
        and now() < v_ent_created + make_interval(days => arch.config_int('trial_days', 14)) then
    v_state := 'trial';
    v_feat := v_plan_feat;
    v_trial_end := v_ent_created + make_interval(days => arch.config_int('trial_days', 14));
  elsif v_plan_code = 'sub_monthly' then
    v_state := 'subscription_expired';
  else
    v_state := 'trial_expired';
  end if;

  if v_state in ('trial_expired', 'subscription_expired') then
    v_out := v_expired;
  else
    v_out := v_missing || coalesce((
      select jsonb_object_agg(f.key, f.value)
      from jsonb_each(coalesce(v_feat, '{}'::jsonb)) as f(key, value)
      where v_missing ? f.key and jsonb_typeof(f.value) = jsonb_typeof(v_missing -> f.key)), '{}'::jsonb);
  end if;

  return v_out || jsonb_build_object(
    'state', v_state,
    'updates_until', v_lic_until,
    'license_ids', v_lic_ids,
    'trial_ends_at', v_trial_end,
    'plan_code', v_plan_code);
end;
$$;

-- 실행 행이 잡만 끝난 상태로 남지 않게 정리(잡 정리기·cancel_job 뒤). 렌더 동시 수 판정 전에 부른다.
create or replace function arch.reconcile_runs(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer := 0; v_c integer;
begin
  if not core.is_privileged_session() then
    raise exception 'reconcile_runs: service_role only' using errcode = '42501';
  end if;
  update arch.renders r set status = 'failed', error = coalesce(r.error, 'job ' || j.status), finished_at = now()
    from core.jobs j where r.org_id = p_org and r.job_id = j.id and r.status in ('queued', 'running') and j.status in ('failed', 'canceled');
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update arch.reviews r set status = 'failed', error = coalesce(r.error, 'job ' || j.status), finished_at = now()
    from core.jobs j where r.org_id = p_org and r.job_id = j.id and r.status in ('queued', 'running') and j.status in ('failed', 'canceled');
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update arch.intake_runs r set status = 'failed', error = coalesce(r.error, 'job ' || j.status), finished_at = now()
    from core.jobs j where r.org_id = p_org and r.job_id = j.id and r.status in ('queued', 'running') and j.status in ('failed', 'canceled');
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  update arch.proposals r set status = 'failed', error = coalesce(r.error, 'job ' || j.status), finished_at = now()
    from core.jobs j where r.org_id = p_org and r.job_id = j.id and r.status in ('queued', 'running') and j.status in ('failed', 'canceled');
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  return v_n;
end;
$$;

-- =====================================================================
-- 6. 트리거 (상태 전이, 기기 해제, 라이선스 상태 부수 효과)
-- =====================================================================

-- AI 실행 상태: insert queued, queued → running | failed, running → succeeded | failed, failed → refunded. service 에도 적용.
create or replace function arch.enforce_run_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception '%: new run must be queued', tg_table_name using errcode = '22023';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status in ('running', 'failed'))
         or (old.status = 'running' and new.status in ('succeeded', 'failed'))
         or (old.status = 'failed' and new.status = 'refunded')) then
      raise exception '%: invalid transition % -> %', tg_table_name, old.status, new.status using errcode = '22023';
    end if;
    if new.status = 'running' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status in ('succeeded', 'failed') then new.finished_at := coalesce(new.finished_at, now()); end if;
  end if;
  if new.request_id is distinct from old.request_id or new.org_id is distinct from old.org_id
     or new.credits is distinct from old.credits or new.credit_ledger_id is distinct from old.credit_ledger_id then
    raise exception '%: request_id, org_id, credits and ledger are immutable', tg_table_name using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 라이선스 상태: active ↔ suspended, active|suspended → refunded | revoked(종료 상태). serial·org·sku 불변.
create or replace function arch.enforce_license_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.serial_hash is distinct from old.serial_hash or new.org_id is distinct from old.org_id
     or new.sku_code is distinct from old.sku_code or new.order_id is distinct from old.order_id then
    raise exception 'licenses: serial, org, sku and order are immutable' using errcode = '22023';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'active' and new.status in ('suspended', 'refunded', 'revoked'))
         or (old.status = 'suspended' and new.status in ('active', 'refunded', 'revoked'))) then
      raise exception 'licenses: invalid transition % -> %', old.status, new.status using errcode = '22023';
    end if;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

-- 환불·회수된 라이선스의 활성 기기를 모두 해제한다(정지는 기기를 남기고 refresh·클라우드 기능에서 AR003).
create or replace function arch.after_license_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('refunded', 'revoked') and old.status is distinct from new.status then
    update arch.license_activations a
       set deactivated_at = now(), deactivation_kind = case when new.status = 'refunded' then 'refund' else 'revoke' end
     where a.license_id = new.id and a.deactivated_at is null;
  end if;
  return null;
end;
$$;

-- 기기 활성화: 해제는 한 번만(다시 쓰려면 새 행), 기기·라이선스·출처 불변
create or replace function arch.enforce_activation_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.device_hash is distinct from old.device_hash or new.license_id is distinct from old.license_id
     or new.org_id is distinct from old.org_id or new.source is distinct from old.source then
    raise exception 'license_activations: device, license, org and source are immutable' using errcode = '22023';
  end if;
  if old.deactivated_at is not null and (new.deactivated_at is distinct from old.deactivated_at
                                         or new.deactivation_kind is distinct from old.deactivation_kind) then
    raise exception 'license_activations: already deactivated' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 배포물(규칙 팩·단가표·빌드): draft → published | withdrawn, published → withdrawn. 게시 후 내용 해시·버전 불변.
create or replace function arch.enforce_release_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('published', 'withdrawn'))
         or (old.status = 'published' and new.status = 'withdrawn')) then
      raise exception '%: invalid transition % -> %', tg_table_name, old.status, new.status using errcode = '22023';
    end if;
  end if;
  if old.status <> 'draft' and (new.version is distinct from old.version or new.sha256 is distinct from old.sha256) then
    raise exception '%: published content is immutable', tg_table_name using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 클라우드 사본: version 은 줄지 않는다(증가는 save_cloud_project 가 1씩)
create or replace function arch.enforce_cloud_project_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version < old.version or new.local_id is distinct from old.local_id or new.org_id is distinct from old.org_id then
    raise exception 'cloud_projects: version must not decrease, local_id/org immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

do $$
declare
  v_schema constant text := 'arch' /*@schema*/;
  t text;
begin
  -- updated_at
  foreach t in array array['runtime_config', 'license_skus', 'builds', 'rule_packs', 'cost_catalogs', 'licenses',
                           'license_activations', 'drafting_profiles', 'cloud_projects', 'renders', 'reviews', 'intake_runs', 'proposals']
  loop
    execute format('drop trigger if exists %I_set_updated_at on %I.%I', t, v_schema, t);
    execute format('create trigger %I_set_updated_at before update on %I.%I for each row execute function core.set_updated_at()', t, v_schema, t);
  end loop;
  -- 이중 잠금: 모든 테이블에 사용자 세션 쓰기 거부(사용자 쓰기 정책이 없지만 GRANT 실수에 대비)
  foreach t in array array['runtime_config', 'license_skus', 'builds', 'rule_packs', 'rule_pack_changes', 'cost_catalogs', 'licenses',
                           'license_activations', 'drafting_profiles', 'cloud_projects', 'renders', 'reviews', 'intake_runs', 'proposals',
                           'site_lookups']
  loop
    execute format('drop trigger if exists %I_guard_write on %I.%I', t, v_schema, t);
    execute format('create trigger %I_guard_write before insert or update or delete on %I.%I for each row execute function core.guard_privileged_write()', t, v_schema, t);
  end loop;
  -- 실행 상태 전이
  foreach t in array array['renders', 'reviews', 'intake_runs', 'proposals']
  loop
    execute format('drop trigger if exists %I_status_transition on %I.%I', t, v_schema, t);
    execute format('create trigger %I_status_transition before insert or update on %I.%I for each row execute function %I.enforce_run_transition()', t, v_schema, t, v_schema);
  end loop;
  foreach t in array array['builds', 'rule_packs', 'cost_catalogs']
  loop
    execute format('drop trigger if exists %I_release_transition on %I.%I', t, v_schema, t);
    execute format('create trigger %I_release_transition before update on %I.%I for each row execute function %I.enforce_release_transition()', t, v_schema, t, v_schema);
  end loop;
end $$;

drop trigger if exists licenses_status_transition on arch.licenses;
create trigger licenses_status_transition before update on arch.licenses
  for each row execute function arch.enforce_license_transition();
drop trigger if exists licenses_after_status on arch.licenses;
create trigger licenses_after_status after update of status on arch.licenses
  for each row execute function arch.after_license_status();
drop trigger if exists license_activations_rules on arch.license_activations;
create trigger license_activations_rules before update on arch.license_activations
  for each row execute function arch.enforce_activation_rules();
drop trigger if exists cloud_projects_version on arch.cloud_projects;
create trigger cloud_projects_version before update on arch.cloud_projects
  for each row execute function arch.enforce_cloud_project_version();

-- =====================================================================
-- 7. 서버 RPC (service_role 전용): 라이선스 발급·활성화·연장, 빌드 자격, 대지 조회 집계, AI 실행
-- =====================================================================

-- 7-1. 라이선스 발급(Toss 결제 확정 후). 주문 id 멱등. 시리얼 원문은 첫 호출 반환값에서만(재호출은 null).
create or replace function arch.issue_license(p_order_id uuid)
returns table (license_id uuid, serial text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order core.payment_orders;
  v_sku   arch.license_skus;
  v_lic   arch.licenses;
  v_body  text;
  v_sold  integer;
begin
  if not core.is_privileged_session() then
    raise exception 'issue_license: service_role only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:issue_license:' || coalesce(p_order_id::text, '')));
  select * into v_lic from arch.licenses l where l.order_id = p_order_id;
  if found then
    return query select v_lic.id, null::text;
    return;
  end if;
  select * into v_order from core.payment_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'issue_license: order not found' using errcode = 'P0002';
  end if;
  if v_order.app_id <> 'arch' or v_order.status <> 'confirmed' then
    raise exception 'issue_license: order must be a confirmed arch order' using errcode = '22023';
  end if;
  -- 코어 요청 C-1: payment_orders.kind 에 일회성 종류가 생기기 전에는 어떤 주문도 통과하지 않는다(PRD D-3, 우회 결제 금지)
  if v_order.kind <> 'one_time' then
    raise exception 'issue_license: one-time order kind required (core request C-1)' using errcode = '22023';
  end if;
  select * into v_sku from arch.license_skus s where s.code = v_order.metadata ->> 'license_sku' and s.is_active;
  if not found then
    raise exception 'issue_license: unknown license sku' using errcode = '22023';
  end if;
  if v_order.amount_krw <> v_sku.price_krw then
    raise exception 'issue_license: amount mismatch' using errcode = '22023';
  end if;
  if v_sku.max_quantity is not null then
    perform pg_advisory_xact_lock(hashtext('arch:sku:' || v_sku.code));
    select count(*) into v_sold from arch.licenses l where l.sku_code = v_sku.code and l.status <> 'refunded';
    if v_sold >= v_sku.max_quantity then
      raise exception 'issue_license: sku sold out' using errcode = '22023';
    end if;
  end if;

  v_body := arch.new_serial_body();
  insert into arch.licenses (org_id, sku_code, order_id, serial_hash, serial_last5, status, purchased_at, updates_until, max_activations)
  values (v_order.org_id, v_sku.code, v_order.id, encode(extensions.digest(v_body, 'sha256'), 'hex'), right(v_body, 5), 'active', now(),
          (arch.kst_today() + make_interval(months => v_sku.includes_updates_months))::date, v_sku.max_activations)
  returning * into v_lic;

  if v_sku.bonus_credits > 0 then
    perform core.grant_credits(v_lic.org_id, v_sku.bonus_credits, 'arch', 'arch.license_bonus', 'pack', 'arch_license',
                               v_lic.id::text, 'license:' || v_lic.id::text, jsonb_build_object('sku', v_sku.code), null, false);
  end if;
  perform core.write_audit(v_lic.org_id, 'license.issue', 'license', v_lic.id::text, null,
                           jsonb_build_object('sku', v_sku.code, 'serial_last5', v_lic.serial_last5, 'order_id', v_order.id));
  return query select v_lic.id,
    'ARCH-' || substr(v_body, 1, 5) || '-' || substr(v_body, 6, 5) || '-' || substr(v_body, 11, 5) || '-' || substr(v_body, 16, 5);
end;
$$;

-- 7-2. 영구 라이선스 기기 활성화. Route Handler 가 세션의 user 를 p_user 로, 정규화한 시리얼(20자 본문)의 SHA-256 을 넘긴다.
create or replace function arch.activate_license(p_serial_hash text, p_device_hash text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lic    arch.licenses;
  v_act    arch.license_activations;
  v_active integer;
begin
  if not core.is_privileged_session() then
    raise exception 'activate_license: service_role only' using errcode = '42501';
  end if;
  if p_serial_hash is null or p_serial_hash !~ '^[0-9a-f]{64}$' or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' or p_user is null then
    raise exception 'activate_license: invalid input' using errcode = '22023';
  end if;
  select * into v_lic from arch.licenses l where l.serial_hash = p_serial_hash for update;
  if not found then
    raise exception 'activate_license: serial not found' using errcode = 'AR002';
  end if;
  if not exists (select 1 from core.org_members m
                 where m.org_id = v_lic.org_id and m.user_id = p_user and m.status = 'active'
                   and coalesce(m.role, '') in ('owner', 'admin', 'member')) then
    raise exception 'activate_license: serial belongs to another organization' using errcode = 'AR006';
  end if;
  if v_lic.status <> 'active' then
    raise exception 'activate_license: license is %', v_lic.status using errcode = 'AR003';
  end if;
  select * into v_act from arch.license_activations a
  where a.license_id = v_lic.id and a.device_hash = p_device_hash and a.deactivated_at is null;
  if found then
    update arch.license_activations set last_seen_at = now() where id = v_act.id returning * into v_act;
  else
    select count(*) into v_active from arch.license_activations a where a.license_id = v_lic.id and a.deactivated_at is null;
    if v_active >= v_lic.max_activations then
      raise exception 'activate_license: activation limit % reached', v_lic.max_activations using errcode = 'AR001';
    end if;
    insert into arch.license_activations (org_id, license_id, source, device_hash, activated_by)
    values (v_lic.org_id, v_lic.id, 'license', p_device_hash, p_user)
    returning * into v_act;
    perform core.write_audit(v_lic.org_id, 'license.activate', 'license_activation', v_act.id::text, null,
                             jsonb_build_object('license_id', v_lic.id, 'user_id', p_user));
  end if;
  return jsonb_build_object(
    'activation', jsonb_build_object('id', v_act.id, 'activated_at', v_act.activated_at, 'last_seen_at', v_act.last_seen_at),
    'license', jsonb_build_object('id', v_lic.id, 'org_id', v_lic.org_id, 'sku', v_lic.sku_code, 'serial_last5', v_lic.serial_last5,
                                  'updates_until', v_lic.updates_until, 'status', v_lic.status));
end;
$$;

-- 7-3. 체험·월 구독 기기 활성화(라이선스 파일 source 'plan', 계약 14 #6). 한도는 org_features.max_activations.
create or replace function arch.activate_plan_device(p_org uuid, p_user uuid, p_device_hash text)
returns arch.license_activations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feat   jsonb;
  v_act    arch.license_activations;
  v_active integer;
begin
  if not core.is_privileged_session() then
    raise exception 'activate_plan_device: service_role only' using errcode = '42501';
  end if;
  if p_org is null or p_user is null or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'activate_plan_device: invalid input' using errcode = '22023';
  end if;
  if not exists (select 1 from core.org_members m
                 where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
                   and coalesce(m.role, '') in ('owner', 'admin', 'member')) then
    raise exception 'activate_plan_device: not a member' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:plan_device:' || p_org::text));
  v_feat := arch.org_features(p_org);
  if v_feat ->> 'state' not in ('trial', 'subscribed') then
    raise exception 'activate_plan_device: no active trial or subscription (state %)', v_feat ->> 'state' using errcode = 'AR003';
  end if;
  select * into v_act from arch.license_activations a
  where a.org_id = p_org and a.source = 'plan' and a.device_hash = p_device_hash and a.deactivated_at is null;
  if found then
    update arch.license_activations set last_seen_at = now() where id = v_act.id returning * into v_act;
    return v_act;
  end if;
  select count(*) into v_active from arch.license_activations a where a.org_id = p_org and a.source = 'plan' and a.deactivated_at is null;
  if v_active >= arch.feature_int(v_feat, 'max_activations', 1) then
    raise exception 'activate_plan_device: activation limit reached' using errcode = 'AR001';
  end if;
  insert into arch.license_activations (org_id, license_id, source, device_hash, activated_by)
  values (p_org, null, 'plan', p_device_hash, p_user)
  returning * into v_act;
  perform core.write_audit(p_org, 'license.activate_plan_device', 'license_activation', v_act.id::text, null,
                           jsonb_build_object('user_id', p_user, 'state', v_feat ->> 'state'));
  return v_act;
end;
$$;

-- 7-4. 업데이트 연장(updates_yearly 결제 확정). 주문 id 멱등(extension_order_ids). 유효 중이면 +1년, 만료 후면 결제일 +1년(D-5 a).
create or replace function arch.extend_updates(p_order_id uuid)
returns setof arch.licenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order core.payment_orders;
  v_plan  text;
begin
  if not core.is_privileged_session() then
    raise exception 'extend_updates: service_role only' using errcode = '42501';
  end if;
  select * into v_order from core.payment_orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'extend_updates: order not found' using errcode = 'P0002';
  end if;
  select p.code into v_plan from core.plans p where p.id = v_order.plan_id;
  if v_order.app_id <> 'arch' or v_order.status <> 'confirmed' or v_order.kind not in ('subscription', 'billing_key_charge')
     or v_plan is distinct from 'updates_yearly' then
    raise exception 'extend_updates: confirmed updates_yearly order required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:extend:' || v_order.org_id::text));
  if exists (select 1 from arch.licenses l where l.org_id = v_order.org_id and p_order_id = any (l.extension_order_ids)) then
    return query select * from arch.licenses l where l.org_id = v_order.org_id and p_order_id = any (l.extension_order_ids);
    return;
  end if;
  if not exists (select 1 from arch.licenses l where l.org_id = v_order.org_id and l.status = 'active') then
    raise exception 'extend_updates: no active license in organization' using errcode = 'AR003';
  end if;
  return query
  update arch.licenses l
     set updates_until = case when l.updates_until >= arch.kst_today()
                              then (l.updates_until + interval '1 year')::date
                              else (arch.kst_today() + interval '1 year')::date end,
         extension_order_ids = l.extension_order_ids || p_order_id
   where l.org_id = v_order.org_id and l.status = 'active'
  returning l.*;
  perform core.write_audit(v_order.org_id, 'license.extend_updates', 'payment_order', p_order_id::text);
end;
$$;

-- 7-5. 업데이트 매니페스트용 빌드 자격. build_date <= updates_until(영구) 또는 체험·구독 활성이면 최신. 없으면 null.
create or replace function arch.eligible_build(p_org uuid, p_platform text, p_current text)
returns arch.builds
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_feat  jsonb;
  v_limit date;
  v_row   arch.builds;
begin
  if not core.is_privileged_session() then
    raise exception 'eligible_build: service_role only' using errcode = '42501';
  end if;
  if p_platform is null or p_platform !~ '^(windows|darwin)-(x86_64|aarch64)$'
     or p_current is null or p_current !~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$' then
    raise exception 'eligible_build: invalid platform or version' using errcode = '22023';
  end if;
  v_feat := arch.org_features(p_org);
  if v_feat ->> 'state' in ('licensed', 'licensed_fallback') then
    v_limit := (v_feat ->> 'updates_until')::date;
  elsif v_feat ->> 'state' in ('trial', 'subscribed') then
    v_limit := 'infinity'::date;
  else
    return null;
  end if;
  select * into v_row from arch.builds b
  where b.platform = p_platform and b.channel = 'stable' and b.status = 'published' and b.build_date <= v_limit
    and string_to_array(b.version, '.')::integer[] > string_to_array(p_current, '.')::integer[]
  order by string_to_array(b.version, '.')::integer[] desc
  limit 1;
  if not found then
    return null;
  end if;
  return v_row;
end;
$$;

-- 7-6. 대지 조회 일일 상한(조직, KST 날짜). 같은 날 같은 지번 재조회는 세지 않는다(제안). 반환: 남은 횟수.
create or replace function arch.record_site_lookup(p_org uuid, p_pnu_hash text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  integer;
  v_today date := arch.kst_today();
begin
  if not core.is_privileged_session() then
    raise exception 'record_site_lookup: service_role only' using errcode = '42501';
  end if;
  if p_org is null or p_pnu_hash is null or p_pnu_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'record_site_lookup: invalid input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:site:' || p_org::text));
  v_limit := arch.feature_int(arch.org_features(p_org), 'site_lookups_per_day', 0);
  select count(*) into v_used from arch.site_lookups s where s.org_id = p_org and s.lookup_date = v_today;
  if exists (select 1 from arch.site_lookups s where s.org_id = p_org and s.lookup_date = v_today and s.pnu_hash = p_pnu_hash) then
    return greatest(v_limit - v_used, 0);
  end if;
  if v_used >= v_limit then
    raise exception 'record_site_lookup: daily limit % reached', v_limit using errcode = 'AR020';
  end if;
  insert into arch.site_lookups (org_id, lookup_date, pnu_hash) values (p_org, v_today, p_pnu_hash);
  return v_limit - v_used - 1;
end;
$$;

-- 7-7. AI 실행 시작: 검사 → 크레딧 선차감 → 실행 행 → 잡 enqueue 를 한 트랜잭션으로(계약 14 #1).
--      차감액은 p_variant 로 runtime_config 단가표에서 함수가 정한다(클라이언트 금액 없음). 같은 request_id 는 기존 실행을 돌려준다.
create or replace function arch.start_ai_run(
  p_org         uuid,
  p_actor       uuid,
  p_kind        text,
  p_variant     text,
  p_request_id  uuid,
  p_project_ref uuid,
  p_options     jsonb default '{}'::jsonb
)
returns table (run_id uuid, job_id uuid, credits integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_opt       jsonb := coalesce(p_options, '{}'::jsonb);
  v_feat      jsonb;
  v_credits   integer;
  v_run_id    uuid := gen_random_uuid();
  v_job_type  text;
  v_ledger    bigint;
  v_job       core.jobs;
  v_existing  record;
  v_used      integer;
  v_cap       integer;
  v_max_px    integer;
  v_payload   jsonb;
  v_src       uuid;
  v_path      text;
  v_rid       uuid;
  v_stt       uuid;
begin
  if not core.is_privileged_session() then
    raise exception 'start_ai_run: service_role only' using errcode = '42501';
  end if;
  if p_org is null or p_actor is null or p_request_id is null or p_project_ref is null or jsonb_typeof(v_opt) <> 'object' then
    raise exception 'start_ai_run: org, actor, request_id, project_ref required' using errcode = '22023';
  end if;
  if pg_column_size(v_opt) > 262144 then
    raise exception 'start_ai_run: options too large' using errcode = 'AR031';
  end if;
  if not ((p_kind = 'render' and p_variant in ('render_std', 'render_hq', 'upscale'))
       or (p_kind = 'review' and p_variant = 'review')
       or (p_kind = 'intake' and p_variant in ('intake_text', 'intake_consult'))
       or (p_kind = 'proposal' and p_variant in ('proposal', 'doc_template'))
       or (p_kind = 'layout' and p_variant = 'layout')
       or (p_kind = 'walkthrough' and p_variant = 'walkthrough')) then
    raise exception 'start_ai_run: invalid kind/variant %/%', p_kind, p_variant using errcode = '22023';
  end if;
  if p_kind in ('layout', 'walkthrough') then
    raise exception 'start_ai_run: % is Phase 2 (no run table yet)', p_kind using errcode = '22023';
  end if;

  -- 멱등: 같은 request_id 는 어느 실행 테이블에 있든 기존 행을 돌려준다
  perform pg_advisory_xact_lock(hashtext('arch:run:' || p_request_id::text));
  select x.id, x.job_id, x.credits, x.org_id into v_existing from (
    select r.id, r.job_id, r.credits, r.org_id from arch.renders r where r.request_id = p_request_id
    union all select r.id, r.job_id, r.credits, r.org_id from arch.reviews r where r.request_id = p_request_id
    union all select r.id, r.job_id, r.credits, r.org_id from arch.intake_runs r where r.request_id = p_request_id
    union all select r.id, r.job_id, r.credits, r.org_id from arch.proposals r where r.request_id = p_request_id) x
  limit 1;
  if found then
    if v_existing.org_id <> p_org then
      raise exception 'start_ai_run: request_id belongs to another organization' using errcode = '42501';
    end if;
    return query select v_existing.id, v_existing.job_id, v_existing.credits;
    return;
  end if;

  if not exists (select 1 from core.org_members m
                 where m.org_id = p_org and m.user_id = p_actor and m.status = 'active'
                   and coalesce(m.role, '') in ('owner', 'admin', 'member')) then
    raise exception 'start_ai_run: not a member' using errcode = '42501';
  end if;
  if not core.has_entitlement(p_org, 'arch') then
    raise exception 'start_ai_run: no entitlement' using errcode = '42501';
  end if;

  -- 기능 판정(서버 정본)
  v_feat := arch.org_features(p_org);
  if p_kind = 'review' and not arch.feature_bool(v_feat, 'cloud_review', false) then
    raise exception 'start_ai_run: cloud review is not available in state %', v_feat ->> 'state' using errcode = 'AR012';
  end if;
  if (p_kind in ('render', 'proposal') and not arch.feature_bool(v_feat, 'ai_render', false))
     or (p_kind = 'intake' and not arch.feature_bool(v_feat, 'ai_intake', false)) then
    raise exception 'start_ai_run: feature not available in state %', v_feat ->> 'state' using errcode = '42501';
  end if;

  v_credits := arch.config_int('price.' || p_variant, null);
  if v_credits is null then
    raise exception 'start_ai_run: no price for %', p_variant using errcode = '22023';
  end if;

  perform arch.reconcile_runs(p_org);

  -- 종류별 입력 검사(경로는 서버가 만든 자기 조직 경로만)
  if p_kind = 'render' then
    v_max_px := arch.feature_int(v_feat, 'render_max_px', 1024);
    if (p_variant = 'render_hq' and v_max_px < 2048) or (p_variant = 'upscale' and v_max_px < 4096) then
      raise exception 'start_ai_run: % exceeds render_max_px %', p_variant, v_max_px using errcode = '22023';
    end if;
    if (select count(*) from arch.renders r where r.org_id = p_org and r.status in ('queued', 'running'))
       >= arch.config_int('render_max_active_per_org', 3) then
      raise exception 'start_ai_run: too many active renders' using errcode = 'AR030';
    end if;
    if p_variant = 'upscale' then
      v_src := nullif(v_opt #>> '{inputs,source_render_id}', '')::uuid;
      if v_src is null or not exists (select 1 from arch.renders r where r.id = v_src and r.org_id = p_org
                                       and r.status = 'succeeded' and r.purged_at is null and r.expires_at > now()) then
        raise exception 'start_ai_run: source render not found' using errcode = 'P0002';
      end if;
    else
      if not arch.valid_user_path(p_org, 'render_input', v_opt #>> '{inputs,depth_path}')
         or not arch.valid_user_path(p_org, 'render_input', v_opt #>> '{inputs,edge_path}') then
        raise exception 'start_ai_run: render input path must be own render_input upload' using errcode = '23514';
      end if;
    end if;
    v_payload := jsonb_build_object('quality', case p_variant when 'render_std' then 'standard' when 'render_hq' then 'high' else 'upscale' end,
                                    'preset', coalesce(v_opt -> 'preset', '{}'::jsonb), 'inputs', coalesce(v_opt -> 'inputs', '{}'::jsonb),
                                    'max_px', v_max_px);
  elsif p_kind = 'review' then
    if jsonb_typeof(v_opt -> 'judgment') <> 'object' or coalesce(v_opt ->> 'rule_pack_version', '') = ''
       or coalesce(v_opt ->> 'application_date', '') = '' or coalesce(v_opt ->> 'municipality_code', '') = '' then
      raise exception 'start_ai_run: review needs judgment, rule_pack_version, application_date, municipality_code' using errcode = '22023';
    end if;
    if pg_column_size(v_opt -> 'judgment') > 262144 then
      raise exception 'start_ai_run: judgment too large' using errcode = 'AR031';
    end if;
    v_payload := jsonb_build_object('rule_pack_version', v_opt ->> 'rule_pack_version', 'application_date', v_opt ->> 'application_date',
                                    'municipality_code', v_opt ->> 'municipality_code');
  elsif p_kind = 'intake' then
    v_stt := nullif(v_opt ->> 'stt_job_id', '')::uuid;
    if v_stt is not null and not exists (select 1 from core.jobs j where j.id = v_stt and j.org_id = p_org) then
      raise exception 'start_ai_run: stt job not found' using errcode = 'P0002';
    end if;
    v_payload := jsonb_build_object('source', case p_variant when 'intake_consult' then 'consult' else 'chat' end, 'stt_job_id', v_stt);
  elsif p_kind = 'proposal' then
    if not arch.valid_user_path(p_org, 'proposal_content', v_opt ->> 'content_path')
       or coalesce(v_opt ->> 'content_sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'start_ai_run: proposal content path/sha256 invalid' using errcode = '23514';
    end if;
    if jsonb_typeof(coalesce(v_opt -> 'drawing_sheets', '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_opt -> 'render_ids', '[]'::jsonb)) <> 'array' then
      raise exception 'start_ai_run: drawing_sheets and render_ids must be arrays' using errcode = '22023';
    end if;
    for v_path in select jsonb_array_elements_text(coalesce(v_opt -> 'drawing_sheets', '[]'::jsonb)) loop
      if not arch.valid_user_path(p_org, 'proposal_sheet', v_path) then
        raise exception 'start_ai_run: drawing sheet path must be own proposal_sheet upload' using errcode = '23514';
      end if;
    end loop;
    for v_rid in select (jsonb_array_elements_text(coalesce(v_opt -> 'render_ids', '[]'::jsonb)))::uuid loop
      if not exists (select 1 from arch.renders r where r.id = v_rid and r.org_id = p_org and r.status = 'succeeded'
                     and r.purged_at is null and r.expires_at > now()) then
        raise exception 'start_ai_run: render % not found', v_rid using errcode = 'P0002';
      end if;
    end loop;
    if p_variant = 'doc_template' and exists (
         select 1 from arch.proposals x where x.org_id = p_org and x.variant = 'doc_template' and x.status = 'succeeded'
           and x.content_sha256 = v_opt ->> 'content_sha256' and x.template_version = v_opt ->> 'template_version') then
      v_credits := 0;   -- 같은 버전 재요청 0크레딧(PRD 4.5)
    end if;
    v_payload := jsonb_build_object('kind', coalesce(v_opt ->> 'doc_kind', 'proposal'), 'content_path', v_opt ->> 'content_path',
                                    'content_sha256', v_opt ->> 'content_sha256', 'render_ids', coalesce(v_opt -> 'render_ids', '[]'::jsonb),
                                    'drawing_sheets', coalesce(v_opt -> 'drawing_sheets', '[]'::jsonb),
                                    'template_version', v_opt ->> 'template_version', 'narrative', p_variant = 'proposal');
  end if;

  -- 일일 플랫폼 상한(베타 비용 서킷 브레이커, PRD 5장). 0 이면 끔. 환불은 빼지 않는다.
  v_cap := arch.config_int('daily_credit_cap', 0);
  if v_cap > 0 and v_credits > 0 then
    perform pg_advisory_xact_lock(hashtext('arch:daily_cap'));
    select coalesce(sum(x.c), 0) into v_used from (
      select r.credits as c from arch.renders r where r.created_at >= (arch.kst_today()::timestamp at time zone 'Asia/Seoul')
      union all select r.credits from arch.reviews r where r.created_at >= (arch.kst_today()::timestamp at time zone 'Asia/Seoul')
      union all select r.credits from arch.intake_runs r where r.created_at >= (arch.kst_today()::timestamp at time zone 'Asia/Seoul')
      union all select r.credits from arch.proposals r where r.created_at >= (arch.kst_today()::timestamp at time zone 'Asia/Seoul')) x;
    if v_used + v_credits > v_cap then
      raise exception 'start_ai_run: daily platform credit cap reached' using errcode = 'AR034';
    end if;
  end if;

  -- 선차감(원자, 멱등). 부족하면 CR001 로 전체 롤백
  if v_credits > 0 then
    select c.ledger_id into v_ledger
    from core.consume_credits(p_org, v_credits, 'arch', 'arch.' || p_variant, 'arch_' || p_kind, v_run_id::text,
                              'consume:arch:' || p_request_id::text,
                              jsonb_build_object('project_ref', p_project_ref, 'variant', p_variant), p_actor) c;
  end if;

  if p_kind = 'render' then
    insert into arch.renders (id, org_id, project_ref, request_id, variant, credits, credit_ledger_id, options, source_render_id, created_by)
    values (v_run_id, p_org, p_project_ref, p_request_id, p_variant, v_credits, v_ledger,
            jsonb_build_object('preset', coalesce(v_opt -> 'preset', '{}'::jsonb), 'inputs', coalesce(v_opt -> 'inputs', '{}'::jsonb)),
            v_src, p_actor);
  elsif p_kind = 'review' then
    insert into arch.reviews (id, org_id, project_ref, request_id, credits, credit_ledger_id, rule_pack_version, application_date,
                              municipality_code, judgment, model_summary, created_by)
    values (v_run_id, p_org, p_project_ref, p_request_id, v_credits, v_ledger, v_opt ->> 'rule_pack_version', (v_opt ->> 'application_date')::date,
            v_opt ->> 'municipality_code', v_opt -> 'judgment', coalesce(v_opt -> 'model_summary', '{}'::jsonb), p_actor);
  elsif p_kind = 'intake' then
    insert into arch.intake_runs (id, org_id, project_ref, request_id, variant, source, input_kind, credits, credit_ledger_id,
                                  input_text, stt_job_id, notice_version, created_by)
    values (v_run_id, p_org, p_project_ref, p_request_id, p_variant, case p_variant when 'intake_consult' then 'consult' else 'chat' end,
            case when v_stt is null then 'text' else 'voice' end, v_credits, v_ledger,
            case when v_stt is null then v_opt ->> 'text' else null end, v_stt, v_opt ->> 'notice_version', p_actor);
  else
    insert into arch.proposals (id, org_id, project_ref, request_id, variant, doc_kind, credits, credit_ledger_id, template_version,
                                content_path, content_sha256, render_ids, sheet_paths, created_by)
    values (v_run_id, p_org, p_project_ref, p_request_id, p_variant, coalesce(v_opt ->> 'doc_kind', 'proposal'), v_credits, v_ledger,
            v_opt ->> 'template_version', v_opt ->> 'content_path', v_opt ->> 'content_sha256',
            coalesce((select array_agg(e::uuid) from jsonb_array_elements_text(coalesce(v_opt -> 'render_ids', '[]'::jsonb)) as e), '{}'),
            coalesce((select array_agg(e) from jsonb_array_elements_text(coalesce(v_opt -> 'drawing_sheets', '[]'::jsonb)) as e), '{}'),
            p_actor);
  end if;

  v_job_type := case p_kind when 'proposal' then 'arch.proposal_pdf' else 'arch.' || p_kind end;
  select * into v_job from core.enqueue_job(
    p_org, 'arch', v_job_type, v_job_type,
    jsonb_build_object('run_id', v_run_id, 'variant', p_variant) || coalesce(v_payload, '{}'::jsonb),
    100, now(), 2, v_ledger, 'job:arch:' || p_request_id::text, null, p_actor, true);

  if p_kind = 'render' then update arch.renders r set job_id = v_job.id where r.id = v_run_id;
  elsif p_kind = 'review' then update arch.reviews r set job_id = v_job.id where r.id = v_run_id;
  elsif p_kind = 'intake' then update arch.intake_runs r set job_id = v_job.id where r.id = v_run_id;
  else update arch.proposals r set job_id = v_job.id where r.id = v_run_id;
  end if;

  return query select v_run_id, v_job.id, v_credits;
end;
$$;

-- 7-8. AI 실행 종료: 결과 검증·저장 + succeeded + 잡 환불 표시 해제를 한 트랜잭션으로. 검증 실패는 예외(워커가 fail_job → fail_ai_run).
create or replace function arch.finish_ai_run(p_run_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status text;
  v_job    uuid;
  v_kind   text;
  v_bad    integer;
  v_days   integer := arch.config_int('render_retention_days', 90);
begin
  if not core.is_privileged_session() then
    raise exception 'finish_ai_run: service_role only' using errcode = '42501';
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'finish_ai_run: result object required' using errcode = '22023';
  end if;
  select r.org_id, r.status, r.job_id, 'render' into v_org, v_status, v_job, v_kind from arch.renders r where r.id = p_run_id for update;
  if not found then
    select r.org_id, r.status, r.job_id, 'review' into v_org, v_status, v_job, v_kind from arch.reviews r where r.id = p_run_id for update;
  end if;
  if not found then
    select r.org_id, r.status, r.job_id, 'intake' into v_org, v_status, v_job, v_kind from arch.intake_runs r where r.id = p_run_id for update;
  end if;
  if not found then
    select r.org_id, r.status, r.job_id, 'proposal' into v_org, v_status, v_job, v_kind from arch.proposals r where r.id = p_run_id for update;
  end if;
  if v_kind is null then
    raise exception 'finish_ai_run: run not found' using errcode = 'P0002';
  end if;
  if v_status not in ('queued', 'running') then
    raise exception 'finish_ai_run: run is %', v_status using errcode = '22023';
  end if;

  if v_kind = 'render' then
    if not arch.valid_user_path(v_org, 'render', p_result ->> 'output_path')
       or coalesce(p_result ->> 'output_path', '') !~ '\.(png|jpg|webp)$' then
      raise exception 'finish_ai_run: render output must be under own org render folder' using errcode = '23514';
    end if;
    if coalesce((p_result ->> 'ai_label')::boolean, false) is not true then
      raise exception 'finish_ai_run: ai_label must be true' using errcode = '22023';
    end if;
    update arch.renders r set status = 'running' where r.id = p_run_id and r.status = 'queued';
    update arch.renders r
       set status = 'succeeded', output_path = p_result ->> 'output_path',
           width = (p_result ->> 'width')::integer, height = (p_result ->> 'height')::integer, bytes = (p_result ->> 'bytes')::bigint,
           provider = left(p_result ->> 'provider', 40), model = left(p_result ->> 'model', 120), seed = (p_result ->> 'seed')::bigint,
           ai_label = true, expires_at = now() + make_interval(days => v_days)
     where r.id = p_run_id;
  elsif v_kind = 'review' then
    -- 출처 없는 문장이 하나라도 있으면 저장하지 않는다(AR033, 02장 5절 cite_check)
    if p_result ->> 'schema_version' is distinct from 'review.v1' or jsonb_typeof(p_result -> 'items') <> 'array' then
      raise exception 'finish_ai_run: review.v1 result required' using errcode = 'AR033';
    end if;
    select count(*) into v_bad
    from (select s.value as sentence
          from jsonb_array_elements(p_result -> 'items') as i(item)
          cross join lateral jsonb_array_elements(coalesce(i.item -> 'sentences', '[]'::jsonb)) as s(value)
          union all
          select n.value from jsonb_array_elements(coalesce(p_result -> 'needs_check', '[]'::jsonb)) as n(value)) z
    where jsonb_typeof(z.sentence -> 'source_ids') is distinct from 'array' or jsonb_array_length(z.sentence -> 'source_ids') = 0;
    if v_bad > 0 then
      raise exception 'finish_ai_run: % sentences without sources', v_bad using errcode = 'AR033';
    end if;
    update arch.reviews r set status = 'running' where r.id = p_run_id and r.status = 'queued';
    update arch.reviews r set status = 'succeeded', result = p_result, disclaimer_version = left(p_result ->> 'disclaimer_version', 40)
     where r.id = p_run_id;
  elsif v_kind = 'intake' then
    -- 고정 스키마(04장 4.3절). 정의 밖 키(좌표·polygon 등)가 하나라도 있으면 AR032
    if p_result ->> 'schema_version' is distinct from 'intake.v1'
       or exists (select 1 from jsonb_object_keys(p_result) k where k not in ('schema_version', 'checklist_answers', 'rooms', 'memo'))
       or jsonb_typeof(p_result -> 'checklist_answers') is distinct from 'array'
       or jsonb_typeof(p_result -> 'rooms') is distinct from 'array'
       or jsonb_typeof(p_result -> 'memo') is distinct from 'array'
       or exists (select 1 from jsonb_array_elements(p_result -> 'rooms') r(room)
                  where jsonb_typeof(r.room) <> 'object'
                     or exists (select 1 from jsonb_object_keys(r.room) k where k not in ('name', 'use', 'count', 'target_area_m2', 'area_evidence'))
                     or (jsonb_typeof(r.room -> 'target_area_m2') = 'number' and jsonb_typeof(r.room -> 'area_evidence') is distinct from 'string'))
       or exists (select 1 from jsonb_array_elements(p_result -> 'checklist_answers') c(item)
                  where jsonb_typeof(c.item) <> 'object'
                     or exists (select 1 from jsonb_object_keys(c.item) k where k not in ('question_id', 'answer', 'confidence', 'evidence'))) then
      raise exception 'finish_ai_run: intake.v1 schema violation' using errcode = 'AR032';
    end if;
    update arch.intake_runs r set status = 'running' where r.id = p_run_id and r.status = 'queued';
    update arch.intake_runs r set status = 'succeeded', result = p_result where r.id = p_run_id;
  else
    if coalesce(p_result ->> 'pdf_path', '') !~ ('^' || v_org::text || '/arch/pdf/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$') then
      raise exception 'finish_ai_run: pdf must be under own org exports folder' using errcode = '23514';
    end if;
    update arch.proposals r set status = 'running' where r.id = p_run_id and r.status = 'queued';
    update arch.proposals r
       set status = 'succeeded', pdf_path = p_result ->> 'pdf_path', pages = (p_result ->> 'pages')::integer,
           bytes = (p_result ->> 'bytes')::bigint, narrative = p_result -> 'narrative'
     where r.id = p_run_id;
  end if;

  -- 결과를 넘긴 실행은 이후 잡 실패로 환불하지 않는다
  if v_job is not null then
    update core.jobs j set refund_on_failure = false where j.id = v_job;
  end if;
  return jsonb_build_object('run_id', p_run_id, 'kind', v_kind, 'status', 'succeeded');
end;
$$;

-- 7-9. AI 실행 실패: failed → 환불(멱등 키 refund:job:<job_id>, fail_job·cancel_job 과 같은 키) → refunded.
create or replace function arch.fail_ai_run(p_run_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status text;
  v_job    uuid;
  v_ledger bigint;
  v_kind   text;
  v_left   integer;
  v_final  text := 'failed';
  v_reason text := left(coalesce(p_reason, 'failed'), 1000);
begin
  if not core.is_privileged_session() then
    raise exception 'fail_ai_run: service_role only' using errcode = '42501';
  end if;
  select r.org_id, r.status, r.job_id, r.credit_ledger_id, 'render' into v_org, v_status, v_job, v_ledger, v_kind from arch.renders r where r.id = p_run_id for update;
  if not found then
    select r.org_id, r.status, r.job_id, r.credit_ledger_id, 'review' into v_org, v_status, v_job, v_ledger, v_kind from arch.reviews r where r.id = p_run_id for update;
  end if;
  if not found then
    select r.org_id, r.status, r.job_id, r.credit_ledger_id, 'intake' into v_org, v_status, v_job, v_ledger, v_kind from arch.intake_runs r where r.id = p_run_id for update;
  end if;
  if not found then
    select r.org_id, r.status, r.job_id, r.credit_ledger_id, 'proposal' into v_org, v_status, v_job, v_ledger, v_kind from arch.proposals r where r.id = p_run_id for update;
  end if;
  if v_kind is null then
    raise exception 'fail_ai_run: run not found' using errcode = 'P0002';
  end if;
  if v_status not in ('queued', 'running', 'failed') then
    raise exception 'fail_ai_run: run is %', v_status using errcode = '22023';
  end if;

  if v_status in ('queued', 'running') then
    if v_kind = 'render' then update arch.renders r set status = 'failed', error = v_reason where r.id = p_run_id;
    elsif v_kind = 'review' then update arch.reviews r set status = 'failed', error = v_reason where r.id = p_run_id;
    elsif v_kind = 'intake' then update arch.intake_runs r set status = 'failed', error = v_reason where r.id = p_run_id;
    else update arch.proposals r set status = 'failed', error = v_reason where r.id = p_run_id;
    end if;
  end if;

  if v_ledger is not null then
    select (-l.amount) - coalesce((select sum(x.amount) from core.credit_ledger x where x.refund_of = l.id), 0) into v_left
    from core.credit_ledger l where l.id = v_ledger;
    if v_left > 0 then
      perform core.refund_credits(v_ledger, 'arch.run_failed', v_left,
                                  case when v_job is null then 'refund:arch:' || p_run_id::text else 'refund:job:' || v_job::text end, null);
    end if;
    v_final := 'refunded';
    if v_kind = 'render' then update arch.renders r set status = 'refunded' where r.id = p_run_id;
    elsif v_kind = 'review' then update arch.reviews r set status = 'refunded' where r.id = p_run_id;
    elsif v_kind = 'intake' then update arch.intake_runs r set status = 'refunded' where r.id = p_run_id;
    else update arch.proposals r set status = 'refunded' where r.id = p_run_id;
    end if;
  end if;
  return jsonb_build_object('run_id', p_run_id, 'kind', v_kind, 'status', v_final);
end;
$$;

-- 7-10. 보존 기간 정리(워커 크론 매일). 만료 렌더는 purged_at 표시 후 삭제할 Storage 경로를 돌려준다.
create or replace function arch.purge_expired()
returns table (bucket text, path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not core.is_privileged_session() then
    raise exception 'purge_expired: service_role only' using errcode = '42501';
  end if;
  delete from arch.site_lookups s where s.created_at < now() - make_interval(days => arch.config_int('site_lookup_retention_days', 90));
  -- 대화형 입력 원문·후보는 90일 뒤 행째 지운다(후보는 이미 로컬에 채택·반영된 뒤다, 제안)
  delete from arch.intake_runs r where r.expires_at < now() and r.status in ('succeeded', 'failed', 'refunded');
  return query
  update arch.renders r set purged_at = now()
   where r.status = 'succeeded' and r.purged_at is null and r.expires_at < now()
  returning 'org-files'::text, r.output_path;
end;
$$;

-- =====================================================================
-- 8. 사용자 RPC (authenticated). 안에서 is_service_caller + 역할을 다시 확인한다.
-- =====================================================================

-- 8-1. 기기 해제(owner/admin). 사용자 셀프 해제는 조직당 30일 3회(AR004). service(고객지원) 해제는 세지 않는다.
create or replace function arch.deactivate_activation(p_activation_id uuid)
returns arch.license_activations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_act  arch.license_activations;
  v_used integer;
  v_svc  boolean := core.is_service_caller();
begin
  select * into v_act from arch.license_activations a where a.id = p_activation_id for update;
  if not found or (not v_svc and not core.is_org_member(v_act.org_id)) then
    raise exception 'deactivate_activation: not found' using errcode = 'P0002';
  end if;
  if not v_svc and not core.has_org_role(v_act.org_id, array['owner', 'admin']) then
    raise exception 'deactivate_activation: owner or admin only' using errcode = '42501';
  end if;
  if v_act.deactivated_at is not null then
    return v_act;
  end if;
  if not v_svc then
    perform pg_advisory_xact_lock(hashtext('arch:deactivate:' || v_act.org_id::text));
    select count(*) into v_used from arch.license_activations a
    where a.org_id = v_act.org_id and a.deactivation_kind = 'self' and a.deactivated_at > now() - interval '30 days';
    if v_used >= arch.config_int('self_deactivations_per_30d', 3) then
      raise exception 'deactivate_activation: self deactivation limit reached' using errcode = 'AR004';
    end if;
  end if;
  update arch.license_activations a
     set deactivated_at = now(), deactivated_by = auth.uid(), deactivation_kind = case when v_svc then 'support' else 'self' end
   where a.id = p_activation_id
  returning * into v_act;
  perform core.write_audit(v_act.org_id, 'license.deactivate', 'license_activation', v_act.id::text, null,
                           jsonb_build_object('kind', v_act.deactivation_kind));
  return v_act;
end;
$$;

-- 8-2. 받을 수 있는 규칙 팩 목록. 업데이트 유효(체험·구독·영구 유효)면 게시된 전부, 폴백이면 published_at <= updates_until.
create or replace function arch.eligible_rule_packs(p_org uuid default null)
returns table (version text, published_at timestamptz, basis_date date, sha256 text, signature text, kid text, bytes bigint, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org   uuid;
  v_feat  jsonb;
  v_limit timestamptz;
begin
  v_org := case when core.is_service_caller() then p_org else arch.caller_org(p_org) end;
  if v_org is null then
    raise exception 'eligible_rule_packs: org required' using errcode = '22023';
  end if;
  v_feat := arch.org_features(v_org);
  if arch.feature_bool(v_feat, 'rule_pack_updates', false) then
    v_limit := 'infinity'::timestamptz;
  elsif v_feat ->> 'state' = 'licensed_fallback' then
    v_limit := (((v_feat ->> 'updates_until')::date + 1)::timestamp at time zone 'Asia/Seoul');
  else
    return;
  end if;
  return query
  select p.version, p.published_at, p.basis_date, p.sha256, p.signature, p.kid, p.bytes, p.status
  from arch.rule_packs p
  where p.status = 'published' and p.published_at < v_limit
  order by p.published_at desc;
end;
$$;

-- 8-3. 받을 수 있는 최신 공사비 단가표(규칙 팩과 같은 자격 원칙, 04장 2.1절). 단가표 내용은 이 함수로만 나간다.
create or replace function arch.latest_cost_catalog(p_org uuid default null)
returns table (version text, basis_date date, published_at timestamptz, items jsonb, source_note text, sha256 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org   uuid;
  v_feat  jsonb;
  v_limit timestamptz;
begin
  v_org := case when core.is_service_caller() then p_org else arch.caller_org(p_org) end;
  if v_org is null then
    raise exception 'latest_cost_catalog: org required' using errcode = '22023';
  end if;
  v_feat := arch.org_features(v_org);
  if arch.feature_bool(v_feat, 'rule_pack_updates', false) then
    v_limit := 'infinity'::timestamptz;
  elsif v_feat ->> 'state' = 'licensed_fallback' then
    v_limit := (((v_feat ->> 'updates_until')::date + 1)::timestamp at time zone 'Asia/Seoul');
  else
    return;
  end if;
  return query
  select c.version, c.basis_date, c.published_at, c.items, c.source_note, c.sha256
  from arch.cost_catalogs c
  where c.status = 'published' and c.published_at < v_limit
  order by c.published_at desc
  limit 1;
end;
$$;

-- 8-4. 표제란·레이어 매핑 저장(owner/admin, AR042). 키 허용 목록 밖(건축주 이름 등)은 22023. 감사에는 바뀐 키 이름만 남긴다.
create or replace function arch.upsert_drafting_profile(p jsonb, p_org uuid default null)
returns arch.drafting_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_row   arch.drafting_profiles;
  v_std   constant text[] := array['A-SITE-BNDY', 'A-SITE-ROAD', 'A-SITE-SETB', 'A-ENVL', 'A-MASS', 'A-WALL', 'A-DOOR', 'A-GLAZ',
                                   'A-AREA', 'A-AREA-IDEN', 'A-PARK', 'A-ANNO-DIMS', 'A-ANNO-TEXT', 'A-ANNO-NRTH', 'A-TTLB', 'A-REFR'];
  v_keys  constant text[] := array['office_name', 'architect_name', 'contact', 'logo_storage_path', 'layer_map',
                                   'default_paper', 'default_text_height_mm', 'font_family'];
begin
  v_org := arch.caller_org(p_org);
  if not core.has_org_role(v_org, array['owner', 'admin']) then
    raise exception 'upsert_drafting_profile: owner or admin only' using errcode = 'AR042';
  end if;
  if not core.has_entitlement(v_org, 'arch') then
    raise exception 'upsert_drafting_profile: no entitlement' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 16384
     or exists (select 1 from jsonb_object_keys(p) k where k <> all (v_keys)) then
    raise exception 'upsert_drafting_profile: unknown keys (allowed: %)', array_to_string(v_keys, ', ') using errcode = '22023';
  end if;
  if p ? 'layer_map' and (jsonb_typeof(p -> 'layer_map') <> 'object'
       or exists (select 1 from jsonb_each(p -> 'layer_map') e
                  where e.key <> all (v_std) or jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^[A-Za-z0-9_$-]{1,64}$')) then
    raise exception 'upsert_drafting_profile: layer_map keys must be standard layers, values ^[A-Za-z0-9_$-]{1,64}$' using errcode = '22023';
  end if;
  if nullif(p ->> 'logo_storage_path', '') is not null and not arch.valid_user_path(v_org, 'drafting-logo', p ->> 'logo_storage_path') then
    raise exception 'upsert_drafting_profile: logo must be own drafting-logo upload' using errcode = '23514';
  end if;
  select * into v_row from arch.drafting_profiles d where d.org_id = v_org for update;
  if not found then
    insert into arch.drafting_profiles (org_id, office_name, architect_name, contact, logo_storage_path, layer_map,
                                        default_paper, default_text_height_mm, font_family, updated_by)
    values (v_org, coalesce(p ->> 'office_name', ''), nullif(p ->> 'architect_name', ''), nullif(p ->> 'contact', ''),
            nullif(p ->> 'logo_storage_path', ''), coalesce(p -> 'layer_map', '{}'::jsonb), coalesce(p ->> 'default_paper', 'A3'),
            coalesce((p ->> 'default_text_height_mm')::numeric, 2.5), coalesce(p ->> 'font_family', 'Noto Sans KR'), auth.uid())
    returning * into v_row;
  else
    -- 보낸 키만 바꾼다(부분 수정). 빈 문자열은 선택 항목을 지운다.
    update arch.drafting_profiles d set
      office_name            = case when p ? 'office_name' then coalesce(p ->> 'office_name', '') else d.office_name end,
      architect_name         = case when p ? 'architect_name' then nullif(p ->> 'architect_name', '') else d.architect_name end,
      contact                = case when p ? 'contact' then nullif(p ->> 'contact', '') else d.contact end,
      logo_storage_path      = case when p ? 'logo_storage_path' then nullif(p ->> 'logo_storage_path', '') else d.logo_storage_path end,
      layer_map              = case when p ? 'layer_map' then p -> 'layer_map' else d.layer_map end,
      default_paper          = case when p ? 'default_paper' then p ->> 'default_paper' else d.default_paper end,
      default_text_height_mm = case when p ? 'default_text_height_mm' then (p ->> 'default_text_height_mm')::numeric else d.default_text_height_mm end,
      font_family            = case when p ? 'font_family' then p ->> 'font_family' else d.font_family end,
      updated_by             = auth.uid()
    where d.org_id = v_org
    returning * into v_row;
  end if;
  perform core.write_audit(v_org, 'drafting_profile.update', 'drafting_profile', v_org::text, null,
                           jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(p) k)));
  return v_row;
end;
$$;

-- 8-5. 클라우드 사본 저장(member+). 조직은 경로 첫 폴더에서 정하고 멤버십을 확인한다. 새 사본은 cloud_projects_max(AR040),
--      기존 사본은 낙관적 동시성(version = p_expected_version, 아니면 AR041).
create or replace function arch.save_cloud_project(p_local_id uuid, p_name text, p_storage_path text, p_expected_version integer)
returns table (id uuid, version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org   uuid := core.storage_org_id(coalesce(p_storage_path, ''));
  v_row   arch.cloud_projects;
  v_count integer;
  v_max   integer;
begin
  if v_org is null or p_local_id is null then
    raise exception 'save_cloud_project: storage path must start with org id' using errcode = '23514';
  end if;
  if not core.is_service_caller() and not core.has_org_role(v_org, array['owner', 'admin', 'member']) then
    raise exception 'save_cloud_project: not a member' using errcode = '42501';
  end if;
  if not core.has_entitlement(v_org, 'arch') then
    raise exception 'save_cloud_project: no entitlement' using errcode = '42501';
  end if;
  if p_storage_path !~ ('^' || v_org::text || '/arch/project_snapshot/' || p_local_id::text
                        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$') then
    raise exception 'save_cloud_project: path must be <org>/arch/project_snapshot/<local_id>/<uuid>.<ext>' using errcode = '23514';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'save_cloud_project: invalid name or expected_version' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:cloud:' || v_org::text));
  select * into v_row from arch.cloud_projects c where c.org_id = v_org and c.local_id = p_local_id for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'save_cloud_project: version conflict (current 0)' using errcode = 'AR041';
    end if;
    v_max := arch.feature_int(arch.org_features(v_org), 'cloud_projects_max', 3);
    select count(*) into v_count from arch.cloud_projects c where c.org_id = v_org;
    if v_count >= v_max then
      raise exception 'save_cloud_project: cloud copy limit % reached', v_max using errcode = 'AR040';
    end if;
    insert into arch.cloud_projects (org_id, local_id, name, storage_path, version, created_by, updated_by)
    values (v_org, p_local_id, btrim(p_name), p_storage_path, 1, auth.uid(), auth.uid())
    returning * into v_row;
  else
    if v_row.version <> p_expected_version then
      raise exception 'save_cloud_project: version conflict (current %)', v_row.version using errcode = 'AR041';
    end if;
    update arch.cloud_projects c
       set name = btrim(p_name), storage_path = p_storage_path, version = c.version + 1, updated_by = auth.uid()
     where c.id = v_row.id
    returning * into v_row;
  end if;
  perform core.write_audit(v_org, 'cloud_project.save', 'cloud_project', v_row.id::text, null, jsonb_build_object('version', v_row.version));
  return query select v_row.id, v_row.version;
end;
$$;

-- =====================================================================
-- 9. RLS 정책과 GRANT. 사용자에게는 SELECT 만(컬럼 단위), 쓰기 정책·쓰기 GRANT 없음.
-- =====================================================================

do $$
declare
  v_schema constant text := 'arch' /*@schema*/;
  t text;
begin
  foreach t in array array['runtime_config', 'license_skus', 'builds', 'rule_packs', 'rule_pack_changes', 'cost_catalogs', 'licenses',
                           'license_activations', 'drafting_profiles', 'cloud_projects', 'renders', 'reviews', 'intake_runs', 'proposals',
                           'site_lookups']
  loop
    execute format('alter table %I.%I enable row level security', v_schema, t);
    execute format('revoke all on table %I.%I from public, anon, authenticated', v_schema, t);
    execute format('grant all on table %I.%I to service_role', v_schema, t);
  end loop;
end $$;
grant usage, select on sequence arch.site_lookups_id_seq to service_role;

-- 상품 목록(가격 화면): 누구나 판매 중인 상품
grant select (code, name, price_krw, includes_updates_months, bonus_credits, max_activations, max_quantity, is_active, sort_order)
  on arch.license_skus to anon, authenticated;
drop policy if exists license_skus_select on arch.license_skus;
create policy license_skus_select on arch.license_skus for select to anon, authenticated using (is_active);

-- 라이선스: 같은 조직 멤버(계정 화면). serial_hash·extension_order_ids 컬럼은 주지 않는다.
grant select (id, org_id, sku_code, serial_last5, status, purchased_at, updates_until, max_activations, status_changed_at, created_at, updated_at)
  on arch.licenses to authenticated;
drop policy if exists licenses_select on arch.licenses;
create policy licenses_select on arch.licenses for select to authenticated
  using (core.is_org_member(org_id) or core.is_platform_admin());

-- 기기: 같은 조직 멤버. device_hash 는 주지 않는다(기기 식별 가명값).
grant select (id, org_id, license_id, source, device_label, activated_at, last_seen_at, deactivated_at, deactivation_kind)
  on arch.license_activations to authenticated;
drop policy if exists license_activations_select on arch.license_activations;
create policy license_activations_select on arch.license_activations for select to authenticated
  using (core.is_org_member(org_id) or core.is_platform_admin());

-- 규칙 팩 메타데이터·개정 제목: arch 사용자. storage_path 는 주지 않는다(다운로드는 서명 URL).
grant select (id, version, status, basis_date, summary, sha256, signature, kid, bytes, published_at, withdrawn_at)
  on arch.rule_packs to authenticated;
drop policy if exists rule_packs_select on arch.rule_packs;
create policy rule_packs_select on arch.rule_packs for select to authenticated
  using ((status in ('published', 'withdrawn') and arch.has_arch_access()) or core.is_platform_admin());
grant select on arch.rule_pack_changes to authenticated;
drop policy if exists rule_pack_changes_select on arch.rule_pack_changes;
create policy rule_pack_changes_select on arch.rule_pack_changes for select to authenticated
  using ((arch.has_arch_access() and exists (select 1 from arch.rule_packs p where p.id = rule_pack_id and p.status = 'published'))
         or core.is_platform_admin());

-- 표제란·클라우드 사본·AI 실행: 같은 조직 멤버 + 엔타이틀먼트
grant select on arch.drafting_profiles, arch.cloud_projects, arch.renders, arch.reviews, arch.intake_runs, arch.proposals to authenticated;
do $$
declare
  v_schema constant text := 'arch' /*@schema*/;
  t text;
begin
  foreach t in array array['drafting_profiles', 'cloud_projects', 'renders', 'reviews', 'intake_runs', 'proposals']
  loop
    execute format('drop policy if exists %I on %I.%I', t || '_select', v_schema, t);
    execute format('create policy %I on %I.%I for select to authenticated using (%s)', t || '_select', v_schema, t,
                   'core.is_org_member(org_id) and core.has_entitlement(org_id, ''arch'')');
  end loop;
end $$;
-- runtime_config, builds, cost_catalogs, site_lookups: 사용자 GRANT·정책 없음(service_role 과 RPC 만)

-- =====================================================================
-- 10. 함수 EXECUTE 정리. PUBLIC·anon 회수 → service_role 전부 → authenticated 허용 목록만.
-- =====================================================================
do $$
declare
  v_schema constant text := 'arch' /*@schema*/;
  v_names  constant text[] := array[
    'has_arch_access', 'config_int', 'feature_int', 'feature_bool', 'kst_today', 'valid_user_path', 'caller_org', 'new_serial_body',
    'org_features', 'reconcile_runs', 'enforce_run_transition', 'enforce_license_transition', 'after_license_status',
    'enforce_activation_rules', 'enforce_release_transition', 'enforce_cloud_project_version', 'issue_license', 'activate_license',
    'activate_plan_device', 'extend_updates', 'eligible_build', 'record_site_lookup', 'start_ai_run', 'finish_ai_run', 'fail_ai_run',
    'purge_expired', 'deactivate_activation', 'eligible_rule_packs', 'latest_cost_catalog', 'upsert_drafting_profile', 'save_cloud_project'];
  r record;
begin
  for r in select p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = v_schema and p.proname = any (v_names)
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
grant execute on function arch.has_arch_access() to authenticated;
grant execute on function arch.feature_int(jsonb, text, integer) to authenticated;
grant execute on function arch.feature_bool(jsonb, text, boolean) to authenticated;
grant execute on function arch.kst_today() to authenticated;
grant execute on function arch.valid_user_path(uuid, text, text) to authenticated;
grant execute on function arch.org_features(uuid) to authenticated;
grant execute on function arch.deactivate_activation(uuid) to authenticated;
grant execute on function arch.eligible_rule_packs(uuid) to authenticated;
grant execute on function arch.latest_cost_catalog(uuid) to authenticated;
grant execute on function arch.upsert_drafting_profile(jsonb, uuid) to authenticated;
grant execute on function arch.save_cloud_project(uuid, text, text, integer) to authenticated;
-- 서버 전용(service_role): config_int, caller_org(내부), new_serial_body, reconcile_runs, issue_license, activate_license,
-- activate_plan_device, extend_updates, eligible_build, record_site_lookup, start_ai_run, finish_ai_run, fail_ai_run, purge_expired.

-- =====================================================================
-- 11. Storage (제품 전용 비공개 버킷, 계약 14 #10). 정책 없음 = 사용자 직접 접근 없음, 서버 서명 URL 만.
--     코어 버킷: org-files(렌더 결과 <org>/arch/render/), exports(제안서 PDF <org>/arch/pdf/), voice-audio(상담 녹음)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('arch-releases', 'arch-releases', false, 524288000, null),   -- 빌드·규칙 팩·단가표(500MB, 제안: 설치 파일 200MB 상한의 여유)
  ('arch-user',     'arch-user',     false, 104857600, null)    -- 사용자 업로드(100MB, PRD 5장 IFC·.3dm 상한)
on conflict (id) do nothing;

-- =====================================================================
-- 12. 운영 상수 seed (설정 데이터라 마이그레이션과 함께 간다. 모놀리스 0002 에도 같은 값)
--     단가는 계약 14 #1 = PRD 4.5·9.4. 상수는 전부 제안(01_PRD.md 5장 "근거 없는 수치는 제안").
-- =====================================================================
insert into arch.runtime_config (key, value_int, note) values
  ('price.render_std',             3,      'AI 렌더 표준 1024px'),
  ('price.render_hq',              5,      'AI 렌더 고품질 2K'),
  ('price.upscale',                2,      '업스케일 4K'),
  ('price.review',                 15,     '클라우드 법규 검토'),
  ('price.intake_text',            2,      '대화형 설계 입력(텍스트·본인 음성). STT 분당 1 은 core-voice 별도'),
  ('price.intake_consult',         5,      '상담 녹음 → 요구사항 후보. STT 분당 1 은 core-voice 별도'),
  ('price.proposal',               10,     '제안서 PDF(서술 LLM 포함, 렌더 별도)'),
  ('price.doc_template',           1,      '설계개요서·면적표·개략 공사비 PDF. 같은 내용·버전 재요청 0'),
  ('price.layout',                 5,      'AI 실 배치 초안(Phase 2)'),
  ('price.walkthrough',            40,     '워크스루 영상(Phase 2)'),
  ('render_max_active_per_org',    3,      '조직당 동시 렌더(PRD 5장)'),
  ('render_retention_days',        90,     '렌더 결과 클라우드 보존(PRD 5장)'),
  ('self_deactivations_per_30d',   3,      '셀프 기기 해제(PRD 4.4)'),
  ('trial_days',                   14,     '체험 기간(PRD 4.2)'),
  ('daily_credit_cap',             200000, '일일 플랫폼 크레딧 상한(제안: 베타 2주 원가 측정 전 서킷 브레이커, 0 = 끔)'),
  ('site_lookup_retention_days',   90,     '대지 조회 집계 보존(제안: 분기 남용 분석)')
on conflict (key) do nothing;

-- @monolith-seed-begin (모놀리스 변환 시 이 표시부터 @monolith-seed-end 까지는 seed.sql 이 소유한다)
-- =====================================================================
-- 13. 플랜·크레딧팩·라이선스 상품(01_PRD 4장, 전부 제안). 모듈러 seed.sql 반영은 코어 요청 C-4.
--     seed 순서와 무관하게 가입이 되도록 do nothing 으로 넣는다. 가격은 VAT 포함.
--     features 키: PRD 4.8(cloud_review ~ max_activations) + 9.4(drafting_watermark, ai_intake, ai_layout).
-- =====================================================================
insert into core.plans (app_id, code, name, description, price_krw, billing_interval, monthly_credits, signup_credits, carry_over, features, is_default, is_active, sort_order) values
  ('arch', 'trial', '체험', '14일 체험(가입 크레딧 30)', 0, 'none', 0, 30, false,
   '{"cloud_review": true, "rule_pack_updates": true, "ai_render": true, "local_gpu_render": false, "render_max_px": 1024, "site_lookups_per_day": 10, "ai_chat_turns_per_day": 20, "cloud_projects_max": 3, "max_activations": 1, "drafting_watermark": true, "ai_intake": true, "ai_layout": false}',
   true, true, 0),
  ('arch', 'updates_yearly', '연간 업데이트', '영구 라이선스 보유자 법규·기능 업데이트(연 480크레딧)', 290000, 'year', 480, 0, false,
   '{"cloud_review": true, "rule_pack_updates": true, "ai_render": true, "local_gpu_render": true, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 200, "cloud_projects_max": 100, "max_activations": 2, "drafting_watermark": false, "ai_intake": true, "ai_layout": true}',
   false, true, 1),
  ('arch', 'sub_monthly', '월 구독', '라이선스 없이 월 구독(월 150크레딧)', 49000, 'month', 150, 0, false,
   '{"cloud_review": true, "rule_pack_updates": true, "ai_render": true, "local_gpu_render": true, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 200, "cloud_projects_max": 100, "max_activations": 1, "drafting_watermark": false, "ai_intake": true, "ai_layout": true}',
   false, true, 2)
on conflict (app_id, code) do nothing;

insert into core.credit_packs (app_id, code, name, credits, price_krw, is_active, sort_order) values
  ('arch', 'pack_100',  '100 크레딧',   100,  10000,  true, 1),
  ('arch', 'pack_550',  '550 크레딧',   550,  50000,  true, 2),
  ('arch', 'pack_1200', '1,200 크레딧', 1200, 100000, true, 3)
on conflict (app_id, code) do nothing;

insert into arch.license_skus (code, name, price_krw, includes_updates_months, bonus_credits, max_activations, max_quantity, fallback_features, is_active, sort_order) values
  ('perpetual_early', '영구 라이선스(사전예약)', 490000, 12, 300, 2, 100,
   '{"cloud_review": false, "rule_pack_updates": false, "ai_render": true, "local_gpu_render": false, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 0, "cloud_projects_max": 100, "max_activations": 2, "drafting_watermark": false, "ai_intake": true, "ai_layout": false}',
   true, 0),
  ('perpetual_standard', '영구 라이선스', 890000, 12, 300, 2, null,
   '{"cloud_review": false, "rule_pack_updates": false, "ai_render": true, "local_gpu_render": false, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 0, "cloud_projects_max": 100, "max_activations": 2, "drafting_watermark": false, "ai_intake": true, "ai_layout": false}',
   false, 1)
on conflict (code) do nothing;

-- =====================================================================
-- 14. AI·음성 기능별 라우팅 기본값(org_id null, app_id 'arch'). 정본 02_ARCHITECTURE.md 5절 표, 계약 14 #11. 모든 값은 제안.
--     이미지 arch.render(fal)는 ai_routing_settings 종류(llm, embedding, stt, tts)가 아니라 워커 서버 상수다(02장 5절 제공자 표).
-- =====================================================================
insert into core.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source) values
  (null, 'arch', 'arch.review',             'llm',       'auto',        '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"google","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, 'arch', 'arch.intake',             'llm',       'auto',        '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, 'arch', 'arch.intake_consult',     'llm',       'open_source', '[{"provider":"oss-llm","model":"*"}]', true),
  (null, 'arch', 'arch.proposal_narrative', 'llm',       'auto',        '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"google","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, 'arch', 'arch.chat',               'llm',       'auto',        '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"google","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, 'arch', 'arch.layout',             'llm',       'auto',        '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, 'arch', 'arch.compliance',         'llm',       'auto',        '[{"provider":"oss-llm","model":"*"},{"provider":"anthropic","model":"*"}]', false),
  (null, 'arch', 'wiki.ingest',             'llm',       'auto',        '[{"provider":"oss-llm","model":"*"},{"provider":"anthropic","model":"*"}]', false),
  (null, 'arch', 'wiki.query',              'llm',       'auto',        '[{"provider":"oss-llm","model":"*"},{"provider":"anthropic","model":"*"}]', false),
  (null, 'arch', 'wiki.lint',               'llm',       'auto',        '[{"provider":"oss-llm","model":"*"},{"provider":"anthropic","model":"*"}]', false),
  (null, 'arch', 'dify.aux',                'llm',       'open_source', '[{"provider":"oss-llm","model":"*"}]', true),
  (null, 'arch', 'arch.knowledge',          'embedding', 'open_source', '[{"provider":"oss-embed","model":"*"}]', false),
  (null, 'arch', 'consult_recording',       'stt',       'open_source', '[{"provider":"oss-voice","model":"*"}]', true),
  (null, 'arch', 'voice_chat',              'stt',       'auto',        '[{"provider":"oss-voice","model":"*"},{"provider":"elevenlabs","model":"*"}]', false)
on conflict ((coalesce(org_id::text, '')), (coalesce(app_id, '')), feature, kind) do update
  set mode = excluded.mode, chain = excluded.chain, force_open_source = excluded.force_open_source;

-- 체인 검사: 제공자 행이 있을 때만 존재·종류·오픈소스 모드를 확인한다.
do $$
declare v_bad text;
begin
  if exists (select 1 from core.ai_providers) then
    select string_agg(s.feature || '/' || s.kind || ':' || coalesce(e.item ->> 'provider', '?'), ', ') into v_bad
    from core.ai_routing_settings s
    cross join lateral jsonb_array_elements(s.chain) as e(item)
    left join core.ai_providers p on p.id = e.item ->> 'provider'
    where s.org_id is null and s.app_id = 'arch'
      and (p.id is null or not (s.kind = any (p.kinds))
           or ((s.mode = 'open_source' or s.force_open_source) and p.source <> 'open_source'));
    if v_bad is not null then
      raise exception 'arch routing defaults: invalid chain providers %', v_bad;
    end if;
  end if;
  if (select count(*) from core.ai_routing_settings s where s.org_id is null and s.app_id = 'arch') <> 14 then
    raise exception 'arch routing defaults: expected 14 rows';
  end if;
end $$;
-- @monolith-seed-end
