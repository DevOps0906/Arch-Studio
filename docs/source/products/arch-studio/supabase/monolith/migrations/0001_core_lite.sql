-- =====================================================================
-- 0001_core_lite.sql (모놀리스 arch-studio)
-- docs/products/_platform-core/MONOLITH_CORE_LITE.sql 의 복사본. [선택] 절 중 SECTION 6-A(oauth_states), 6-B(encrypted_credentials),
-- 9(affiliate)만 제거했다(각 자리에 사유 주석). 3(Toss), 4(크레딧), 6-C(레이트 리밋: 활성화 API IP 10회/시간), 7(잡), 8(Storage)은 쓴다.
-- 코어 본문은 바꾸지 않는다(코어 변경은 _platform-core 담당). 아래부터 원본 그대로.
-- =====================================================================

-- =====================================================================
-- MONOLITH_CORE_LITE.sql
-- 제품별 단독 Supabase 프로젝트(모놀리스)용 코어. 한 파일로 묶은 축소판.
-- 원본: docs/products/_supabase-modular/migrations/0000 ~ 0006 (모듈러 core 스키마)
--
-- 스키마 선택: public
--   - ARCHITECTURE.md:10 "차이는 스키마 접두사(core. 대 public.)뿐" 원칙을 그대로 따른다.
--   - 모놀리스는 PostgREST 노출 스키마 설정 없이 바로 쓸 수 있어야 한다(public은 기본 노출).
--   - 제품 도메인 테이블도 public에 두므로 정책이 public.is_org_member(...) 하나로 통일된다.
--   - 함수 이름과 시그니처는 모듈러 core.*와 같다. 앱 코드는 SUPABASE_DB_SCHEMA 환경변수로 전환한다.
--
-- 사용법 (제품 에이전트)
--   1) 이 파일을 <제품>/supabase/monolith/migrations/0001_core_lite.sql 로 복사한다.
--   2) [선택] 표시가 붙은 절(SECTION)은 제품에 필요 없으면 절 전체를 지운다.
--      절 머리의 "의존" 표를 보고 지울 때 함께 지울 줄을 확인한다.
--   3) [필수] 절은 지우지 않는다. 바꾸지도 않는다(코어 변경은 _platform-core 담당).
--   4) 마지막 "SECTION 10 권한 정리"는 to_regclass / to_regprocedure 로 존재하는 객체에만
--      권한을 주므로 절을 지워도 그대로 동작한다.
--
-- 모듈러(0000~0006)와 다른 점 (DB_CONVENTIONS.md 9장에도 정리)
--   a) 스키마 public. Supabase가 public에 기본으로 주는 anon/authenticated 권한을 이 파일이 회수한다.
--   b) 가입 트리거: signup_app 메타데이터가 없고 apps 행이 정확히 1개면 그 앱으로 자동 부트스트랩한다.
--   c) run_monthly_credit_grants()를 run_subscription_rollover()(SECTION 2) + 크레딧 지급(SECTION 4)으로
--      나눠, 크레딧 절을 지워도 구독 기간 굴림과 해지 만료가 남는다.
--   d) RLS 정책을 테이블이 있는 절 안에 둔다(모듈러는 0004에 모아 둠). 절 단위 삭제를 위해서다.
--
-- 보안 규칙 (SECURITY_BASELINE.md)
--   - 쓰기는 service_role 또는 SECURITY DEFINER RPC만. 사용자(authenticated)에게는 SELECT 정책만.
--   - 사용자에게 EXECUTE를 연 SECURITY DEFINER 함수 안의 호출자 판정은 is_service_caller() 만 쓴다.
--     is_privileged_session()은 DEFINER 안에서 항상 true(current_user = 함수 소유자)라서 검사가 통째로 건너뛰어진다.
--   - 역할 비교는 coalesce(role, '') 로 NULL-safe 하게 한다. 비멤버의 역할은 NULL이고
--     NULL not in (...) 은 NULL이라 분기가 건너뛰어진다.
--   - EXECUTE 권한이 1차 잠금, 함수 안 검사가 2차 잠금, guard 트리거가 3차 잠금이다.
--
-- PostgreSQL 15 / Supabase 표준 객체만 사용. 반복 실행해도 안전하다.
-- =====================================================================


-- =====================================================================
-- SECTION 0. 확장, 기본 권한, 공용 헬퍼  [필수]
-- 원본: 0000_core_extensions_and_schema.sql
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
-- pg_cron은 호스팅 대시보드에서 켠다. 로컬 선택 사항.
-- create extension if not exists pg_cron;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase는 public에 만들어지는 테이블/함수/시퀀스에 anon, authenticated 전체 권한을 기본으로 준다.
-- 이 코어는 "쓰기는 service_role만" 원칙이므로 기본 권한을 회수하고 절마다 SELECT만 명시적으로 준다.
-- (모듈러 core 스키마에는 이런 기본 권한이 없어서 이 줄이 필요 없었다.)
alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- updated_at 갱신 트리거
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 세션 헬퍼
--   jwt_role()              : PostgREST 요청의 JWT role ('anon' | 'authenticated' | 'service_role' | 'none')
--   is_privileged_session() : service_role 요청 또는 DB 소유 세션(마이그레이션, pg_cron, SECURITY DEFINER 내부)
--                             → guard 트리거와 "EXECUTE가 service_role에만 있는" RPC 에서만 쓴다.
--   is_service_caller()     : 실제 호출자가 service_role 이거나 JWT 없는 DB 관리 세션
--                             → authenticated 에 EXECUTE 를 연 DEFINER 함수 안에서는 반드시 이것을 쓴다.
create or replace function public.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'none'
  );
$$;

create or replace function public.is_privileged_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_role() = 'service_role'
      or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin');
$$;

-- session_user 는 SECURITY DEFINER 안에서도 바뀌지 않는다. PostgREST 요청은 session_user 가
-- authenticator 이고 JWT role 이 항상 있으므로, JWT 없는 관리 세션만 두 번째 조건으로 통과한다.
create or replace function public.is_service_caller()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_role() = 'service_role'
      or (public.jwt_role() = 'none' and session_user in ('postgres', 'supabase_admin', 'supabase_auth_admin'));
$$;

-- 쓰기 보호 트리거: service_role 또는 DB 소유 세션이 아니면 어떤 쓰기도 거부(이중 잠금)
create or replace function public.guard_privileged_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_privileged_session() then
    raise exception 'core: % on %.% is allowed only for service_role', tg_op, tg_table_schema, tg_table_name
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- SECTION 1. 신원: profiles, organizations, org_members, 가입 트리거  [필수]
-- 원본: 0001_core_identity.sql
-- 테넌시는 org 기준, 운영은 1인 1워크스페이스(확정 결정 5). 가입 시 개인 조직을 자동 생성한다.
-- =====================================================================

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text not null default '',
  avatar_url    text,
  locale        text not null default 'ko',
  platform_role text not null default 'user'
                constraint profiles_platform_role_check check (platform_role in ('user', 'platform_admin')),
  status        text not null default 'active'
                constraint profiles_status_check check (status in ('active', 'pending', 'suspended')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on column public.profiles.platform_role is '플랫폼 운영자 여부. service_role만 변경 가능';
comment on column public.profiles.status is '승인제 앱에서 pending으로 시작. service_role 또는 approve_profile()만 변경 가능';

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null constraint organizations_name_check check (char_length(name) between 1 and 80),
  slug        text not null unique constraint organizations_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  is_personal boolean not null default true,
  settings    jsonb not null default '{}'::jsonb,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists organizations_owner_idx on public.organizations (owner_id);

create table if not exists public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member'
             constraint org_members_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  status     text not null default 'active'
             constraint org_members_status_check check (status in ('active', 'invited', 'pending', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_active_idx on public.org_members (user_id) where status = 'active';
create unique index if not exists org_members_single_owner_idx on public.org_members (org_id) where role = 'owner';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
drop trigger if exists org_members_set_updated_at on public.org_members;
create trigger org_members_set_updated_at before update on public.org_members
  for each row execute function public.set_updated_at();

alter table public.profiles      enable row level security;
alter table public.organizations enable row level security;
alter table public.org_members   enable row level security;

-- org_members 직접 쓰기는 service_role만(이중 잠금). 멤버 관리는 SECTION 5의 함수로.
drop trigger if exists org_members_guard_write on public.org_members;
create trigger org_members_guard_write before insert or update or delete on public.org_members
  for each row execute function public.guard_privileged_write();

-- 앱 부트스트랩 스텁. SECTION 2(플랜/엔타이틀먼트), SECTION 4(크레딧)에서 순서대로 교체된다.
create or replace function public.on_signup_app_bootstrap(p_org_id uuid, p_user_id uuid, p_app_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

-- 가입 트리거
--   1) profiles  2) 개인 조직 + owner 멤버십  3) 앱 부트스트랩
--   모놀리스 차이: raw_user_meta_data.signup_app 이 없고 apps 행이 정확히 1개면 그 앱으로 부트스트랩한다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_name   text;
  v_app    text;
begin
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );
  v_app := nullif(new.raw_user_meta_data ->> 'signup_app', '');

  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email, left(v_name, 80), new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;

  insert into public.organizations (name, slug, owner_id, is_personal)
  values (left(v_name, 80), 'u' || replace(new.id::text, '-', ''), new.id, true)
  on conflict (slug) do nothing
  returning id into v_org_id;

  if v_org_id is null then
    select id into v_org_id from public.organizations where slug = 'u' || replace(new.id::text, '-', '');
  end if;

  insert into public.org_members (org_id, user_id, role, status, joined_at)
  values (v_org_id, new.id, 'owner', 'active', now())
  on conflict (org_id, user_id) do nothing;

  if v_app is null and to_regclass('public.apps') is not null then
    -- apps 행이 정확히 1개일 때만 그 앱으로. 2개 이상이면 signup_app 을 요구한다(모듈러와 같은 동작).
    select min(a.id) into v_app from public.apps a where a.status <> 'disabled'
    having count(*) = 1;
  end if;

  -- 초대제(invite) 앱은 가입만으로 이용 권한을 만들지 않는다.
  -- 운영자가 서버(service_role)에서 bootstrap_app_for_org로 부여하거나, 초대받은 조직의 권한을 쓴다.
  if v_app is not null and to_regclass('public.apps') is not null then
    if exists (select 1 from public.apps a where a.id = v_app and a.signup_policy = 'invite') then
      v_app := null;
    end if;
  end if;

  if v_app is not null then
    perform public.on_signup_app_bootstrap(v_org_id, new.id, v_app);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 현재 사용자의 개인 조직 id (SECURITY INVOKER)
create or replace function public.personal_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select o.id
  from public.organizations o
  where o.owner_id = auth.uid() and o.is_personal and o.deleted_at is null
  order by o.created_at
  limit 1;
$$;


-- =====================================================================
-- SECTION 5-A. RLS 헬퍼, 권한 컬럼 보호, audit_log, 멤버 관리  [필수]
-- 원본: 0004_core_security.sql 1~4절
-- 정책이 헬퍼를 쓰므로 테이블 절(2~9)보다 먼저 둔다.
-- 헬퍼는 모두 SECURITY DEFINER + set search_path='' + STABLE. 정책 안에서 org_members 를
-- 다시 조회할 때 생기는 재귀(42P17)를 끊는다.
-- =====================================================================

create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.org_members m
  where m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.status = 'active' and m.role = any (roles)
  );
$$;

create or replace function public.current_org_role(org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.org_members m
  where m.org_id = org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role = 'platform_admin' and p.status = 'active'
  );
$$;

-- 권한 컬럼 보호 트리거: 컬럼 단위 GRANT가 1차, 이 트리거가 2차
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if new.platform_role is distinct from old.platform_role
     or new.status is distinct from old.status
     or new.email is distinct from old.email
     or new.id is distinct from old.id then
    raise exception 'profiles: privileged columns can only be changed by service_role' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns before update on public.profiles
  for each row execute function public.guard_profile_columns();

create or replace function public.guard_organization_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
       new.owner_id is distinct from old.owner_id
    or new.is_personal is distinct from old.is_personal
    or new.deleted_at is distinct from old.deleted_at
    or new.slug is distinct from old.slug
    or new.id is distinct from old.id) then
    raise exception 'organizations: privileged columns can only be changed by service_role' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists organizations_guard_columns on public.organizations;
create trigger organizations_guard_columns before update on public.organizations
  for each row execute function public.guard_organization_columns();

-- audit_log (append-only)
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid,
  actor_id    uuid,
  actor_role  text not null default 'user' constraint audit_log_actor_role_check check (actor_role in ('user', 'service', 'system')),
  action      text not null,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  metadata    jsonb not null default '{}'::jsonb,
  ip          inet,
  user_agent  text,
  request_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id);

create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('core.allow_purge', true) = 'on' and public.is_privileged_session() then
    return old;
  end if;
  raise exception 'audit_log is append-only (%)', tg_op using errcode = 'AU000';
end;
$$;
drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
drop trigger if exists audit_log_guard_write on public.audit_log;
create trigger audit_log_guard_write before insert on public.audit_log
  for each row execute function public.guard_privileged_write();
alter table public.audit_log enable row level security;

-- 사용자 세션에서 감사 기록을 남기는 유일한 경로. actor 는 auth.uid() 로 강제.
create or replace function public.write_audit(
  p_org_id      uuid,
  p_action      text,
  p_target_type text  default null,
  p_target_id   text  default null,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.is_service_caller() then
    if auth.uid() is null or (p_org_id is not null and not public.is_org_member(p_org_id)) then
      raise exception 'write_audit: not a member of the organization' using errcode = '42501';
    end if;
  end if;
  insert into public.audit_log (org_id, actor_id, actor_role, action, target_type, target_id, before, after, metadata)
  values (p_org_id, auth.uid(),
          case when public.jwt_role() = 'service_role' then 'service' when auth.uid() is null then 'system' else 'user' end,
          p_action, p_target_type, p_target_id, p_before, p_after, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- 멤버 관리 (SECURITY DEFINER, authenticated 호출 가능, 안에서 역할 검사: is_service_caller + coalesce)
create or replace function public.invite_member(p_org_id uuid, p_user_id uuid, p_role text default 'member')
returns public.org_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_caller_role text; v_row public.org_members;
begin
  v_caller_role := public.current_org_role(p_org_id);
  if not public.is_service_caller() then
    if coalesce(v_caller_role, '') not in ('owner', 'admin') then
      raise exception 'invite_member: owner/admin only' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'invite_member: cannot invite yourself' using errcode = '22023';
    end if;
  end if;
  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'invite_member: role must be admin/member/viewer' using errcode = '22023';
  end if;
  if v_caller_role = 'admin' and p_role = 'admin' then
    raise exception 'invite_member: admin cannot grant admin' using errcode = '42501';
  end if;

  insert into public.org_members (org_id, user_id, role, status, invited_by)
  values (p_org_id, p_user_id, p_role, 'invited', auth.uid())
  on conflict (org_id, user_id) do update
    set role = excluded.role, status = case when public.org_members.status = 'active' then 'active' else 'invited' end,
        invited_by = excluded.invited_by
  returning * into v_row;

  perform public.write_audit(p_org_id, 'org_member.invite', 'user', p_user_id::text, null, jsonb_build_object('role', p_role));
  return v_row;
end;
$$;

create or replace function public.accept_invite(p_org_id uuid)
returns public.org_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.org_members;
begin
  update public.org_members
  set status = 'active', joined_at = now()
  where org_id = p_org_id and user_id = auth.uid() and status = 'invited'
  returning * into v_row;
  if not found then
    raise exception 'accept_invite: no pending invitation' using errcode = 'P0002';
  end if;
  perform public.write_audit(p_org_id, 'org_member.accept', 'user', auth.uid()::text);
  return v_row;
end;
$$;

create or replace function public.approve_member(p_org_id uuid, p_user_id uuid)
returns public.org_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.org_members;
begin
  if not public.is_service_caller() and not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'approve_member: owner/admin only' using errcode = '42501';
  end if;
  update public.org_members set status = 'active', joined_at = coalesce(joined_at, now())
  where org_id = p_org_id and user_id = p_user_id and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'approve_member: no pending member' using errcode = 'P0002';
  end if;
  perform public.write_audit(p_org_id, 'org_member.approve', 'user', p_user_id::text);
  return v_row;
end;
$$;

create or replace function public.change_member_role(p_org_id uuid, p_user_id uuid, p_role text)
returns public.org_members
language plpgsql
security definer
set search_path = ''
as $$
declare v_caller_role text; v_target public.org_members; v_row public.org_members;
begin
  v_caller_role := public.current_org_role(p_org_id);
  if not public.is_service_caller() then
    if coalesce(v_caller_role, '') not in ('owner', 'admin') then
      raise exception 'change_member_role: owner/admin only' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'change_member_role: cannot change your own role' using errcode = '42501';
    end if;
  end if;
  if p_role not in ('admin', 'member', 'viewer') then
    raise exception 'change_member_role: role must be admin/member/viewer' using errcode = '22023';
  end if;
  select * into v_target from public.org_members where org_id = p_org_id and user_id = p_user_id for update;
  if not found then
    raise exception 'change_member_role: member not found' using errcode = 'P0002';
  end if;
  if v_target.role = 'owner' then
    raise exception 'change_member_role: use transfer_ownership for the owner' using errcode = '42501';
  end if;
  if v_caller_role = 'admin' and (p_role = 'admin' or v_target.role = 'admin') then
    raise exception 'change_member_role: admin cannot change admin roles' using errcode = '42501';
  end if;

  update public.org_members set role = p_role where org_id = p_org_id and user_id = p_user_id returning * into v_row;
  perform public.write_audit(p_org_id, 'org_member.role', 'user', p_user_id::text,
                             jsonb_build_object('role', v_target.role), jsonb_build_object('role', p_role));
  return v_row;
end;
$$;

create or replace function public.remove_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_caller_role text; v_target public.org_members;
begin
  v_caller_role := public.current_org_role(p_org_id);
  select * into v_target from public.org_members where org_id = p_org_id and user_id = p_user_id for update;
  if not found then
    return;
  end if;
  if v_target.role = 'owner' then
    raise exception 'remove_member: owner cannot be removed' using errcode = '42501';
  end if;
  if not public.is_service_caller() then
    if p_user_id <> auth.uid() and coalesce(v_caller_role, '') not in ('owner', 'admin') then
      raise exception 'remove_member: owner/admin only' using errcode = '42501';
    end if;
    if v_caller_role = 'admin' and v_target.role = 'admin' and p_user_id <> auth.uid() then
      raise exception 'remove_member: admin cannot remove admin' using errcode = '42501';
    end if;
  end if;
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
  perform public.write_audit(p_org_id, 'org_member.remove', 'user', p_user_id::text, jsonb_build_object('role', v_target.role), null);
end;
$$;

create or replace function public.transfer_ownership(p_org_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_service_caller() and coalesce(public.current_org_role(p_org_id), '') <> 'owner' then
    raise exception 'transfer_ownership: owner only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_members where org_id = p_org_id and user_id = p_new_owner and status = 'active') then
    raise exception 'transfer_ownership: new owner must be an active member' using errcode = 'P0002';
  end if;
  update public.org_members set role = 'admin' where org_id = p_org_id and role = 'owner';
  update public.org_members set role = 'owner' where org_id = p_org_id and user_id = p_new_owner;
  update public.organizations set owner_id = p_new_owner where id = p_org_id;
  perform public.write_audit(p_org_id, 'organization.transfer_ownership', 'user', p_new_owner::text);
end;
$$;

create or replace function public.approve_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_service_caller() and not public.is_platform_admin() then
    raise exception 'approve_profile: platform_admin only' using errcode = '42501';
  end if;
  update public.profiles set status = 'active' where id = p_user_id and status = 'pending';
  perform public.write_audit(null, 'profile.approve', 'user', p_user_id::text);
end;
$$;

-- SECTION 1 테이블의 RLS 정책 (읽기 + 비권한 컬럼 UPDATE)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or id in (select m.user_id from public.org_members m where m.org_id in (select public.current_org_ids()))
  );
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (deleted_at is null and (public.is_org_member(id) or public.is_platform_admin()));
drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin on public.organizations for update to authenticated
  using (deleted_at is null and public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select to authenticated
  using (public.is_org_member(org_id) or user_id = auth.uid() or public.is_platform_admin());

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using ((org_id is not null and public.has_org_role(org_id, array['owner', 'admin'])) or public.is_platform_admin());


-- =====================================================================
-- SECTION 2. 앱 레지스트리, 플랜, 크레딧팩, 구독, 엔타이틀먼트  [필수]
-- 원본: 0002_core_billing.sql (결제 테이블은 SECTION 3), 0003의 부트스트랩 1단계
-- 유료 플랜이 없는 제품도 apps 1행 + 기본 플랜 1행은 둔다. app_entitlements 가 기능 게이팅의 단일 출처다.
-- =====================================================================

create table if not exists public.apps (
  id            text primary key constraint apps_id_check check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  name          text not null,
  schema_name   text not null unique,
  signup_policy text not null default 'open'
                constraint apps_signup_policy_check check (signup_policy in ('open', 'approval', 'invite')),
  status        text not null default 'active'
                constraint apps_status_check check (status in ('active', 'beta', 'disabled')),
  created_at    timestamptz not null default now()
);

create table if not exists public.plans (
  id               uuid primary key default gen_random_uuid(),
  app_id           text not null references public.apps(id) on delete cascade,
  code             text not null constraint plans_code_check check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name             text not null,
  description      text,
  price_krw        integer not null default 0 constraint plans_price_check check (price_krw >= 0),
  billing_interval text not null default 'none'
                   constraint plans_interval_check check (billing_interval in ('none', 'month', 'year')),
  monthly_credits  integer not null default 0 constraint plans_monthly_credits_check check (monthly_credits >= 0),
  signup_credits   integer not null default 0 constraint plans_signup_credits_check check (signup_credits >= 0),
  carry_over       boolean not null default false,
  features         jsonb not null default '{}'::jsonb,
  is_default       boolean not null default false,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (app_id, code)
);
create unique index if not exists plans_one_default_per_app_idx on public.plans (app_id) where is_default;
comment on column public.plans.carry_over is 'false면 월 지급 시 남은 플랜 크레딧을 만료(expire)시킨다';
comment on column public.plans.features is '서버에서만 읽는 기능 플래그. 예: {"tracks":["A"],"max_channels":1}';

create table if not exists public.credit_packs (
  id         uuid primary key default gen_random_uuid(),
  app_id     text not null references public.apps(id) on delete cascade,
  code       text not null constraint credit_packs_code_check check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name       text not null,
  credits    integer not null constraint credit_packs_credits_check check (credits > 0),
  price_krw  integer not null constraint credit_packs_price_check check (price_krw > 0),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (app_id, code)
);

-- billing_keys 는 SECTION 3 에 있지만 subscriptions 가 참조하므로 FK 없이 uuid 로만 둔다(모듈러와의 차이).
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  app_id                 text not null references public.apps(id) on delete cascade,
  plan_id                uuid not null references public.plans(id),
  status                 text not null default 'active'
                         constraint subscriptions_status_check check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  billing_key_id         uuid,
  current_period_start   timestamptz not null default now(),
  current_period_end     timestamptz,
  next_charge_at         timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  failed_charge_count    integer not null default 0,
  last_credit_grant_key  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, app_id)
);
create index if not exists subscriptions_charge_due_idx on public.subscriptions (next_charge_at)
  where status in ('active', 'past_due') and next_charge_at is not null;

create table if not exists public.app_entitlements (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  app_id     text not null references public.apps(id) on delete cascade,
  plan_id    uuid not null references public.plans(id),
  status     text not null default 'active'
             constraint app_entitlements_status_check check (status in ('active', 'suspended', 'expired')),
  source     text not null default 'signup'
             constraint app_entitlements_source_check check (source in ('signup', 'subscription', 'manual', 'trial')),
  expires_at timestamptz,
  granted_by uuid,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, app_id)
);

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans for each row execute function public.set_updated_at();
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
drop trigger if exists app_entitlements_set_updated_at on public.app_entitlements;
create trigger app_entitlements_set_updated_at before update on public.app_entitlements for each row execute function public.set_updated_at();

alter table public.apps             enable row level security;
alter table public.plans            enable row level security;
alter table public.credit_packs     enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.app_entitlements enable row level security;

do $$
declare t text;
begin
  foreach t in array array['apps', 'plans', 'credit_packs', 'subscriptions', 'app_entitlements']
  loop
    execute format('drop trigger if exists %I_guard_write on public.%I', t, t);
    execute format('create trigger %I_guard_write before insert or update or delete on public.%I for each row execute function public.guard_privileged_write()', t, t);
  end loop;
end $$;

-- 엔타이틀먼트 헬퍼
create or replace function public.has_entitlement(org uuid, app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_entitlements e
    where e.org_id = org and e.app_id = app and e.status = 'active'
      and (e.expires_at is null or e.expires_at > now())
  );
$$;

create or replace function public.entitled_plan_code(org uuid, app text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.code
  from public.app_entitlements e
  join public.plans p on p.id = e.plan_id
  where e.org_id = org and e.app_id = app and e.status = 'active'
    and (e.expires_at is null or e.expires_at > now());
$$;

-- 세션 컨텍스트: 요청당 1회. 반환 {user_id, email, display_name, platform_role, status, org, app_id, plan_code, entitled, credit_balance}
-- 프로필이 없으면 null → 호출 측은 로그아웃 처리(기본 admin 금지). credit_balance 는 wallets(SECTION 4)가 없으면 0.
create or replace function public.session_context(p_app text default null, p_org uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_org     uuid;
  v_org_row public.organizations;
  v_role    text;
  v_plan    text;
  v_balance integer;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_profile from public.profiles p where p.id = v_uid;
  if not found then
    return null;
  end if;

  v_org := coalesce(p_org, (
    select o.id from public.organizations o
    where o.owner_id = v_uid and o.is_personal and o.deleted_at is null
    order by o.created_at limit 1));

  if v_org is not null then
    select m.role into v_role from public.org_members m
    where m.org_id = v_org and m.user_id = v_uid and m.status = 'active';
    if v_role is null then
      v_org := null;
    else
      select * into v_org_row from public.organizations o where o.id = v_org and o.deleted_at is null;
      if p_app is not null then
        v_plan := public.entitled_plan_code(v_org, p_app);
      end if;
      if to_regclass('public.wallets') is not null then
        execute 'select w.plan_balance + w.pack_balance from public.wallets w where w.org_id = $1' into v_balance using v_org;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'user_id',        v_uid,
    'email',          v_profile.email,
    'display_name',   v_profile.display_name,
    'platform_role',  v_profile.platform_role,
    'status',         v_profile.status,
    'org',            case when v_org is null then null else jsonb_build_object(
                        'id', v_org, 'name', v_org_row.name, 'slug', v_org_row.slug, 'role', v_role) end,
    'app_id',         p_app,
    'plan_code',      v_plan,
    'entitled',       v_plan is not null,
    'credit_balance', coalesce(v_balance, 0)
  );
end;
$$;

-- 구독 상태 머신 (service_role 전용)
--   trialing → active | canceled | expired / active → past_due | canceled | expired
--   past_due → active | canceled | expired / canceled → active | expired / expired → active
create or replace function public.apply_subscription_transition(
  p_subscription_id uuid,
  p_to              text,
  p_reason          text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub          public.subscriptions;
  v_allowed      boolean;
  v_default_plan uuid;
begin
  if not public.is_privileged_session() then
    raise exception 'apply_subscription_transition: service_role only' using errcode = '42501';
  end if;

  select * into v_sub from public.subscriptions where id = p_subscription_id for update;
  if not found then
    raise exception 'subscription not found: %', p_subscription_id using errcode = 'P0002';
  end if;

  v_allowed := case v_sub.status
    when 'trialing' then p_to in ('active', 'canceled', 'expired')
    when 'active'   then p_to in ('past_due', 'canceled', 'expired')
    when 'past_due' then p_to in ('active', 'canceled', 'expired')
    when 'canceled' then p_to in ('active', 'expired')
    when 'expired'  then p_to in ('active')
    else false
  end;
  if not v_allowed then
    raise exception 'invalid subscription transition % -> %', v_sub.status, p_to using errcode = 'SB001';
  end if;

  update public.subscriptions
  set status               = p_to,
      canceled_at          = case when p_to = 'canceled' then now() else canceled_at end,
      cancel_at_period_end = case when p_to = 'canceled' then true
                                  when p_to = 'active' then false
                                  else cancel_at_period_end end,
      failed_charge_count  = case when p_to = 'active' then 0 else failed_charge_count end,
      next_charge_at       = case when p_to in ('canceled', 'expired') then null else next_charge_at end
  where id = p_subscription_id
  returning * into v_sub;

  if p_to in ('trialing', 'active', 'past_due') then
    insert into public.app_entitlements (org_id, app_id, plan_id, status, source, expires_at)
    values (v_sub.org_id, v_sub.app_id, v_sub.plan_id, 'active', 'subscription', null)
    on conflict (org_id, app_id) do update
      set plan_id = excluded.plan_id, status = 'active', source = 'subscription', expires_at = null;
  elsif p_to = 'canceled' then
    update public.app_entitlements
    set expires_at = v_sub.current_period_end
    where org_id = v_sub.org_id and app_id = v_sub.app_id;
  elsif p_to = 'expired' then
    select id into v_default_plan from public.plans where app_id = v_sub.app_id and is_default and is_active limit 1;
    if v_default_plan is not null then
      insert into public.app_entitlements (org_id, app_id, plan_id, status, source, expires_at)
      values (v_sub.org_id, v_sub.app_id, v_default_plan, 'active', 'signup', null)
      on conflict (org_id, app_id) do update
        set plan_id = excluded.plan_id, status = 'active', source = 'signup', expires_at = null;
    else
      update public.app_entitlements set status = 'expired'
      where org_id = v_sub.org_id and app_id = v_sub.app_id;
    end if;
  end if;

  insert into public.audit_log (org_id, actor_id, actor_role, action, target_type, target_id, after)
  values (v_sub.org_id, null, 'service', 'subscription.' || p_to, 'subscription', v_sub.id::text,
          jsonb_build_object('reason', p_reason, 'plan_id', v_sub.plan_id));

  return v_sub;
end;
$$;

-- 부트스트랩 1단계(크레딧 없음): 기본 플랜으로 구독 + 엔타이틀먼트. SECTION 4 가 크레딧 지급 버전으로 교체한다.
create or replace function public.on_signup_app_bootstrap(p_org_id uuid, p_user_id uuid, p_app_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app  public.apps;
  v_plan public.plans;
  v_period_end timestamptz;
begin
  select * into v_app from public.apps where id = p_app_id and status <> 'disabled';
  if not found then
    return;
  end if;
  if v_app.signup_policy = 'approval' then
    update public.profiles set status = 'pending' where id = p_user_id and status = 'active';
  end if;
  select * into v_plan from public.plans where app_id = p_app_id and is_default and is_active limit 1;
  if not found then
    return;
  end if;
  v_period_end := case v_plan.billing_interval
    when 'month' then now() + interval '1 month'
    when 'year'  then now() + interval '1 year'
    else null end;
  insert into public.subscriptions (org_id, app_id, plan_id, status, current_period_start, current_period_end)
  values (p_org_id, p_app_id, v_plan.id, 'active', now(), v_period_end)
  on conflict (org_id, app_id) do nothing;
  insert into public.app_entitlements (org_id, app_id, plan_id, status, source)
  values (p_org_id, p_app_id, v_plan.id, 'active', 'signup')
  on conflict (org_id, app_id) do nothing;
end;
$$;

-- 기존 사용자가 앱을 처음 열 때(SSO) 호출. owner/admin 만.
create or replace function public.bootstrap_app_for_org(p_app_id text, p_org_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  v_org := coalesce(p_org_id, public.personal_org_id());
  if v_org is null then
    raise exception 'bootstrap_app_for_org: no organization' using errcode = 'P0002';
  end if;
  if not public.is_service_caller() then
    if not public.has_org_role(v_org, array['owner', 'admin']) then
      raise exception 'bootstrap_app_for_org: owner/admin only' using errcode = '42501';
    end if;
  end if;
  if not public.is_service_caller()
     and exists (select 1 from public.apps a where a.id = p_app_id and a.signup_policy = 'invite') then
    raise exception 'bootstrap_app_for_org: % is invite-only', p_app_id using errcode = '42501';
  end if;
  perform public.on_signup_app_bootstrap(v_org, auth.uid(), p_app_id);
end;
$$;

-- 구독 기간 굴림 + 해지 예약 만료 (service_role / pg_cron). 모듈러 run_monthly_credit_grants 의 1), 3) 단계.
create or replace function public.run_subscription_rollover()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_count integer := 0;
begin
  if not public.is_privileged_session() then
    raise exception 'run_subscription_rollover: service_role only' using errcode = '42501';
  end if;

  update public.subscriptions s
  set current_period_start = s.current_period_end,
      current_period_end   = s.current_period_end + case p.billing_interval when 'year' then interval '1 year' else interval '1 month' end
  from public.plans p
  where p.id = s.plan_id
    and p.price_krw = 0
    and p.billing_interval in ('month', 'year')
    and s.status in ('active', 'trialing')
    and s.current_period_end is not null
    and s.current_period_end <= now();

  for r in
    select s.id from public.subscriptions s
    where s.status = 'canceled' and s.current_period_end is not null and s.current_period_end <= now()
  loop
    perform public.apply_subscription_transition(r.id, 'expired', 'period_end');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- RLS 정책: 가격표는 공개 읽기, 조직 데이터는 멤버 읽기, 쓰기 정책 없음
drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps for select to anon, authenticated using (status <> 'disabled');
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select to anon, authenticated using (is_active);
drop policy if exists credit_packs_select on public.credit_packs;
create policy credit_packs_select on public.credit_packs for select to anon, authenticated using (is_active);
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated using (public.is_org_member(org_id));
drop policy if exists app_entitlements_select on public.app_entitlements;
create policy app_entitlements_select on public.app_entitlements for select to authenticated using (public.is_org_member(org_id));


-- =====================================================================
-- SECTION 3. Toss Payments: 빌링키, 주문, 결제, 웹훅 이벤트, 결제 이행  [선택]
-- 원본: 0002_core_billing.sql, 0003 confirm_payment_order
-- 의존: SECTION 2(plans, subscriptions, app_entitlements). confirm_payment_order 의 credit_pack 분기는 SECTION 4 가 필요하다.
--       SECTION 4 를 지우면 confirm_payment_order 의 "if v_order.kind = 'credit_pack'" 분기도 지운다.
-- 지울 때: 이 절 전체. SECTION 2 의 subscriptions.billing_key_id 컬럼은 남겨도 무해하다.
-- =====================================================================

-- 빌링키 자체는 앱 계층 AES-256-GCM 암호문으로만. customer_key 는 'org_' || org_id 로 결정적 생성(Date.now() 금지).
create table if not exists public.billing_keys (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  customer_key           text not null,
  billing_key_ciphertext text not null,
  key_version            integer not null default 1,
  card_company           text,
  card_number_masked     text,
  status                 text not null default 'active'
                         constraint billing_keys_status_check check (status in ('active', 'revoked')),
  created_by             uuid,
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz
);
create unique index if not exists billing_keys_one_active_per_org_idx on public.billing_keys (org_id) where status = 'active';

-- 결제창을 열기 전에 서버가 먼저 저장하는 주문. 금액의 정본. orderId 파싱으로 org/plan 을 꺼내지 않는다.
create table if not exists public.payment_orders (
  id             uuid primary key default gen_random_uuid(),
  order_id       text not null unique constraint payment_orders_order_id_check check (order_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  app_id         text not null references public.apps(id),
  kind           text not null constraint payment_orders_kind_check check (kind in ('subscription', 'credit_pack', 'billing_key_charge')),
  plan_id        uuid references public.plans(id),
  credit_pack_id uuid references public.credit_packs(id),
  credits        integer constraint payment_orders_credits_check check (credits is null or credits > 0),
  amount_krw     integer not null constraint payment_orders_amount_check check (amount_krw > 0),
  currency       text not null default 'KRW',
  status         text not null default 'created'
                 constraint payment_orders_status_check check (status in ('created', 'confirmed', 'failed', 'canceled', 'refunded', 'expired')),
  customer_key   text,
  created_by     uuid,
  expires_at     timestamptz not null default (now() + interval '1 hour'),
  confirmed_at   timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint payment_orders_kind_ref_check check (
    (kind = 'credit_pack' and credit_pack_id is not null and credits is not null)
    or (kind in ('subscription', 'billing_key_charge') and plan_id is not null)
  )
);
create index if not exists payment_orders_org_idx on public.payment_orders (org_id, created_at desc);

-- Toss 승인 결과. payment_key 유일 → 같은 승인을 두 번 지급하지 않는다.
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            text not null references public.payment_orders(order_id),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  payment_key         text not null unique,
  method              text,
  amount_krw          integer not null constraint payments_amount_check check (amount_krw > 0),
  canceled_amount_krw integer not null default 0,
  status              text not null default 'done'
                      constraint payments_status_check check (status in ('done', 'canceled', 'partial_canceled', 'failed')),
  approved_at         timestamptz,
  receipt_url         text,
  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists payments_org_idx on public.payments (org_id, created_at desc);

-- 인바운드 웹훅 멱등 처리. (provider, event_id) 유일. 서명 검증 실패 이벤트는 처리하지 않는다.
create table if not exists public.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  event_id        text not null,
  event_type      text,
  signature_valid boolean not null default false,
  payload         jsonb not null,
  status          text not null default 'received'
                  constraint webhook_events_status_check check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts        integer not null default 0,
  error           text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  unique (provider, event_id)
);

drop trigger if exists payment_orders_set_updated_at on public.payment_orders;
create trigger payment_orders_set_updated_at before update on public.payment_orders for each row execute function public.set_updated_at();
drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

alter table public.billing_keys   enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payments       enable row level security;
alter table public.webhook_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['billing_keys', 'payment_orders', 'payments', 'webhook_events']
  loop
    execute format('drop trigger if exists %I_guard_write on public.%I', t, t);
    execute format('create trigger %I_guard_write before insert or update or delete on public.%I for each row execute function public.guard_privileged_write()', t, t);
  end loop;
end $$;

-- 빌링키 요약 뷰(암호문 제외). 정의자 뷰이므로 멤버십 필터를 뷰 안에서 건다.
create or replace view public.billing_key_summaries as
  select b.id, b.org_id, b.customer_key, b.card_company, b.card_number_masked, b.status, b.created_at, b.revoked_at
  from public.billing_keys b
  where b.org_id in (
    select m.org_id from public.org_members m where m.user_id = auth.uid() and m.status = 'active'
  );

create or replace function public.expire_stale_payment_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if not public.is_privileged_session() then
    raise exception 'expire_stale_payment_orders: service_role only' using errcode = '42501';
  end if;
  update public.payment_orders set status = 'expired'
  where status = 'created' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 결제 이행: Toss confirm 성공 후 서버가 1회 호출. 주문 잠금 → 금액 대조 → payments 기록 → 종류별 지급. 한 트랜잭션.
-- SQLSTATE: PM404 주문 없음 / PM409 다른 결제키로 재확인 / PM410 상태 불가 / PM001 금액 불일치
-- 알려진 한계(모듈러 0003:577-583 과 동일, 코어 결정 전까지 유지): PM001 분기의 "주문 failed" UPDATE 는 뒤따르는
-- raise 로 같은 트랜잭션에서 롤백된다. 앱 계층은 PM001 을 받으면 별도 호출로 주문을 failed 로 표시해야 한다.
create or replace function public.confirm_payment_order(
  p_order_id    text,
  p_payment_key text,
  p_amount_krw  integer,
  p_method      text        default null,
  p_raw         jsonb       default '{}'::jsonb,
  p_approved_at timestamptz default now()
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.payment_orders;
  v_payment public.payments;
  v_plan    public.plans;
  v_sub     public.subscriptions;
  v_start   timestamptz := now();
  v_end     timestamptz;
  v_key     text;
begin
  if not public.is_privileged_session() then
    raise exception 'confirm_payment_order: service_role only' using errcode = '42501';
  end if;

  select * into v_order from public.payment_orders where order_id = p_order_id for update;
  if not found then
    raise exception 'payment order not found: %', p_order_id using errcode = 'PM404';
  end if;

  if v_order.status = 'confirmed' then
    select * into v_payment from public.payments where order_id = p_order_id;
    if v_payment.payment_key = p_payment_key then
      return v_payment;
    end if;
    raise exception 'order % already confirmed with another payment key', p_order_id using errcode = 'PM409';
  end if;

  if v_order.status <> 'created' then
    raise exception 'order % is %, cannot confirm', p_order_id, v_order.status using errcode = 'PM410';
  end if;

  if v_order.amount_krw <> p_amount_krw then
    -- 이 raise는 트랜잭션 전체를 되돌리므로 여기서 상태를 바꿔도 남지 않는다.
    -- PM001을 받은 서버는 별도 트랜잭션에서 fail_payment_order()로 주문을 failed로 남긴다.
    raise exception 'amount mismatch for order %: expected % got %', p_order_id, v_order.amount_krw, p_amount_krw
      using errcode = 'PM001';
  end if;

  insert into public.payments (order_id, org_id, payment_key, method, amount_krw, status, approved_at, raw)
  values (p_order_id, v_order.org_id, p_payment_key, p_method, p_amount_krw, 'done', p_approved_at, coalesce(p_raw, '{}'::jsonb))
  returning * into v_payment;

  update public.payment_orders set status = 'confirmed', confirmed_at = now() where order_id = p_order_id;

  if v_order.kind = 'credit_pack' then
    -- SECTION 4 (크레딧) 필요. 크레딧 절을 지웠으면 이 분기도 지운다.
    perform public.grant_credits(v_order.org_id, v_order.credits, v_order.app_id, 'credit_pack_purchase', 'pack',
                                 'payment_order', p_order_id, 'order:' || p_order_id,
                                 jsonb_build_object('payment_key', p_payment_key, 'credit_pack_id', v_order.credit_pack_id),
                                 v_order.created_by, false);
  else
    select * into v_plan from public.plans where id = v_order.plan_id;
    v_end := case v_plan.billing_interval when 'year' then v_start + interval '1 year' else v_start + interval '1 month' end;

    insert into public.subscriptions (org_id, app_id, plan_id, status, current_period_start, current_period_end, next_charge_at, failed_charge_count)
    values (v_order.org_id, v_order.app_id, v_plan.id, 'active', v_start, v_end, v_end, 0)
    on conflict (org_id, app_id) do update
      set plan_id              = excluded.plan_id,
          status               = 'active',
          current_period_start = excluded.current_period_start,
          current_period_end   = excluded.current_period_end,
          next_charge_at       = excluded.next_charge_at,
          failed_charge_count  = 0,
          cancel_at_period_end = false,
          canceled_at          = null
    returning * into v_sub;

    insert into public.app_entitlements (org_id, app_id, plan_id, status, source, expires_at)
    values (v_order.org_id, v_order.app_id, v_plan.id, 'active', 'subscription', null)
    on conflict (org_id, app_id) do update
      set plan_id = excluded.plan_id, status = 'active', source = 'subscription', expires_at = null;

    if v_plan.monthly_credits > 0 and to_regprocedure('public.grant_credits(uuid,integer,text,text,text,text,text,text,jsonb,uuid,boolean)') is not null then
      v_key := 'monthly:' || v_sub.id::text || ':' || to_char(v_sub.current_period_start, 'YYYY-MM-DD');
      perform public.grant_credits(v_order.org_id, v_plan.monthly_credits, v_order.app_id, 'monthly_plan_credits', 'plan',
                                   'subscription', v_sub.id::text, v_key,
                                   jsonb_build_object('order_id', p_order_id, 'payment_key', p_payment_key),
                                   v_order.created_by, not v_plan.carry_over);
      update public.subscriptions set last_credit_grant_key = v_key where id = v_sub.id;
    end if;
  end if;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------
-- fail_payment_order (service_role 전용): 확정하지 못한 주문을 failed로 남긴다.
--   confirm_payment_order는 PM001 등에서 raise로 끝나 상태 변경이 롤백되므로,
--   서버가 PM001을 받으면 별도 트랜잭션에서 이 함수를 호출한다.
--   created 상태에서만 바뀌고, 이미 failed면 그대로 돌려준다(멱등).
--   SQLSTATE: PM404 주문 없음 / PM410 상태 불가
-- ---------------------------------------------------------------------
create or replace function public.fail_payment_order(p_order_id text, p_reason text, p_detail jsonb default '{}'::jsonb)
returns public.payment_orders
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.payment_orders;
begin
  if not public.is_service_caller() then
    raise exception 'fail_payment_order: service_role only' using errcode = '42501';
  end if;
  select * into v_order from public.payment_orders where order_id = p_order_id for update;
  if not found then
    raise exception 'payment order not found: %', p_order_id using errcode = 'PM404';
  end if;
  if v_order.status = 'failed' then
    return v_order;
  end if;
  if v_order.status <> 'created' then
    raise exception 'order % is %, cannot mark failed', p_order_id, v_order.status using errcode = 'PM410';
  end if;
  update public.payment_orders
     set status = 'failed',
         metadata = metadata || jsonb_build_object('failure', coalesce(p_reason, 'unknown')) || coalesce(p_detail, '{}'::jsonb)
   where order_id = p_order_id
  returning * into v_order;
  insert into public.audit_log (org_id, actor_id, actor_role, action, target_type, target_id, after)
  values (v_order.org_id, null, 'service', 'payment_order.failed', 'payment_order', p_order_id,
          jsonb_build_object('reason', p_reason));
  return v_order;
end;
$$;
revoke execute on function public.fail_payment_order(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fail_payment_order(text, text, jsonb) to service_role;

drop policy if exists payment_orders_select on public.payment_orders;
create policy payment_orders_select on public.payment_orders for select to authenticated using (public.is_org_member(org_id));
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (public.is_org_member(org_id));
-- billing_keys, webhook_events: 정책 없음(사용자 접근 불가). 빌링키 요약은 뷰로만.


-- =====================================================================
-- SECTION 4. 크레딧: wallets, credit_ledger(append-only), ai_usage, consume/grant/refund, 월 지급  [선택]
-- 원본: 0003_core_credits.sql
-- 의존: SECTION 2. 지울 때 함께 지울 것:
--   - SECTION 3 confirm_payment_order 의 credit_pack 분기
--   - SECTION 7 jobs.credit_ledger_id 컬럼과 fail_job / cancel_job 의 refund_credits 호출
-- 설계: 잔액 정본은 wallets 1행. FOR UPDATE 잠금 후 검사·갱신·원장 INSERT 를 한 트랜잭션에서.
--       원장은 UPDATE/DELETE 불가, 환불은 refund_of 를 가리키는 새 행. 멱등 키 같으면 첫 결과 반환.
--       버킷 2개: plan(월 지급, 이월 정책) / pack(구매·가입·환불). 차감은 plan 부터.
-- =====================================================================

create table if not exists public.wallets (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  plan_balance integer not null default 0 constraint wallets_plan_balance_check check (plan_balance >= 0),
  pack_balance integer not null default 0 constraint wallets_pack_balance_check check (pack_balance >= 0),
  updated_at   timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  app_id          text references public.apps(id),
  entry_type      text not null constraint credit_ledger_type_check check (entry_type in ('grant', 'consume', 'refund', 'expire', 'adjust')),
  amount          integer not null constraint credit_ledger_amount_check check (amount <> 0),
  plan_delta      integer not null default 0,
  pack_delta      integer not null default 0,
  balance_after   integer not null,
  reason          text not null,
  ref_type        text,
  ref_id          text,
  refund_of       bigint references public.credit_ledger(id),
  idempotency_key text unique,
  actor_id        uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint credit_ledger_delta_sum_check check (amount = plan_delta + pack_delta)
);
create index if not exists credit_ledger_org_created_idx on public.credit_ledger (org_id, created_at desc);
create index if not exists credit_ledger_ref_idx on public.credit_ledger (ref_type, ref_id);
create index if not exists credit_ledger_refund_of_idx on public.credit_ledger (refund_of) where refund_of is not null;

create or replace function public.credit_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('core.allow_purge', true) = 'on' and public.is_privileged_session() then
    return old;
  end if;
  raise exception 'credit_ledger is append-only (%)', tg_op using errcode = 'CR000';
end;
$$;
drop trigger if exists credit_ledger_immutable on public.credit_ledger;
create trigger credit_ledger_immutable before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_immutable();
drop trigger if exists credit_ledger_guard_write on public.credit_ledger;
create trigger credit_ledger_guard_write before insert on public.credit_ledger
  for each row execute function public.guard_privileged_write();
drop trigger if exists wallets_guard_write on public.wallets;
create trigger wallets_guard_write before insert or update or delete on public.wallets
  for each row execute function public.guard_privileged_write();

-- LLM/이미지 호출 사용량(게이트웨이가 기록). 과금 행과 ledger_id 로 연결.
create table if not exists public.ai_usage (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  app_id          text references public.apps(id),
  provider        text not null,
  model           text not null,
  purpose         text,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_usd_micros bigint not null default 0,
  credits         integer not null default 0,
  ledger_id       bigint references public.credit_ledger(id),
  latency_ms      integer,
  status          text not null default 'ok' constraint ai_usage_status_check check (status in ('ok', 'error', 'fallback')),
  error_code      text,
  request_id      text,
  created_at      timestamptz not null default now()
);
create index if not exists ai_usage_org_created_idx on public.ai_usage (org_id, created_at desc);
drop trigger if exists ai_usage_guard_write on public.ai_usage;
create trigger ai_usage_guard_write before insert or update or delete on public.ai_usage
  for each row execute function public.guard_privileged_write();

alter table public.wallets       enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.ai_usage      enable row level security;

create or replace view public.credit_balances
with (security_invoker = true) as
  select w.org_id, w.plan_balance, w.pack_balance, w.plan_balance + w.pack_balance as balance, w.updated_at
  from public.wallets w;

-- 운영용(service_role): 원장 합계 대 지갑 검증
create or replace view public.credit_ledger_reconciliation as
  select w.org_id,
         w.plan_balance + w.pack_balance as wallet_balance,
         coalesce(sum(l.amount), 0)::integer as ledger_balance,
         (w.plan_balance + w.pack_balance) - coalesce(sum(l.amount), 0)::integer as drift
  from public.wallets w
  left join public.credit_ledger l on l.org_id = w.org_id
  group by w.org_id, w.plan_balance, w.pack_balance;

-- consume_credits: 원자 차감. 부족하면 SQLSTATE 'CR001'. 반환 ledger_id, new_balance, plan_used, pack_used
create or replace function public.consume_credits(
  p_org_id          uuid,
  p_amount          integer,
  p_app_id          text,
  p_reason          text,
  p_ref_type        text    default null,
  p_ref_id          text    default null,
  p_idempotency_key text    default null,
  p_metadata        jsonb   default '{}'::jsonb,
  p_actor_id        uuid    default null
)
returns table (ledger_id bigint, new_balance integer, plan_used integer, pack_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan      integer;
  v_pack      integer;
  v_take_plan integer;
  v_take_pack integer;
  v_row       public.credit_ledger;
begin
  if not public.is_privileged_session() then
    raise exception 'consume_credits: service_role only' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'consume_credits: amount must be positive' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('credit:' || p_idempotency_key));
    select * into v_row from public.credit_ledger l where l.idempotency_key = p_idempotency_key;
    if found then
      return query select v_row.id, v_row.balance_after, -v_row.plan_delta, -v_row.pack_delta;
      return;
    end if;
  end if;

  insert into public.wallets (org_id) values (p_org_id) on conflict (org_id) do nothing;

  select w.plan_balance, w.pack_balance into v_plan, v_pack
  from public.wallets w where w.org_id = p_org_id for update;

  if v_plan + v_pack < p_amount then
    raise exception 'insufficient_credits: balance=% required=%', v_plan + v_pack, p_amount
      using errcode = 'CR001';
  end if;

  v_take_plan := least(v_plan, p_amount);
  v_take_pack := p_amount - v_take_plan;

  update public.wallets
  set plan_balance = plan_balance - v_take_plan,
      pack_balance = pack_balance - v_take_pack,
      updated_at   = now()
  where org_id = p_org_id;

  insert into public.credit_ledger
    (org_id, app_id, entry_type, amount, plan_delta, pack_delta, balance_after,
     reason, ref_type, ref_id, idempotency_key, actor_id, metadata)
  values
    (p_org_id, p_app_id, 'consume', -p_amount, -v_take_plan, -v_take_pack, v_plan + v_pack - p_amount,
     p_reason, p_ref_type, p_ref_id, p_idempotency_key, p_actor_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return query select v_row.id, v_row.balance_after, v_take_plan, v_take_pack;
end;
$$;

-- grant_credits: 지급. p_bucket = 'plan' | 'pack'. p_reset_plan_bucket = true 면 지급 전 plan 잔액을 expire(이월 불가 플랜).
create or replace function public.grant_credits(
  p_org_id            uuid,
  p_amount            integer,
  p_app_id            text,
  p_reason            text,
  p_bucket            text    default 'pack',
  p_ref_type          text    default null,
  p_ref_id            text    default null,
  p_idempotency_key   text    default null,
  p_metadata          jsonb   default '{}'::jsonb,
  p_actor_id          uuid    default null,
  p_reset_plan_bucket boolean default false
)
returns table (ledger_id bigint, new_balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan integer;
  v_pack integer;
  v_row  public.credit_ledger;
begin
  if not public.is_privileged_session() then
    raise exception 'grant_credits: service_role only' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'grant_credits: amount must be positive' using errcode = '22023';
  end if;
  if p_bucket not in ('plan', 'pack') then
    raise exception 'grant_credits: bucket must be plan or pack' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('credit:' || p_idempotency_key));
    select * into v_row from public.credit_ledger l where l.idempotency_key = p_idempotency_key;
    if found then
      return query select v_row.id, v_row.balance_after;
      return;
    end if;
  end if;

  insert into public.wallets (org_id) values (p_org_id) on conflict (org_id) do nothing;

  select w.plan_balance, w.pack_balance into v_plan, v_pack
  from public.wallets w where w.org_id = p_org_id for update;

  if p_reset_plan_bucket and v_plan > 0 then
    update public.wallets set plan_balance = 0, updated_at = now() where org_id = p_org_id;
    insert into public.credit_ledger
      (org_id, app_id, entry_type, amount, plan_delta, pack_delta, balance_after, reason, ref_type, ref_id, idempotency_key, actor_id, metadata)
    values
      (p_org_id, p_app_id, 'expire', -v_plan, -v_plan, 0, v_pack, 'plan_bucket_reset', p_ref_type, p_ref_id,
       case when p_idempotency_key is null then null else p_idempotency_key || ':expire' end, p_actor_id, '{}'::jsonb);
    v_plan := 0;
  end if;

  if p_bucket = 'plan' then
    update public.wallets set plan_balance = plan_balance + p_amount, updated_at = now() where org_id = p_org_id;
    v_plan := v_plan + p_amount;
  else
    update public.wallets set pack_balance = pack_balance + p_amount, updated_at = now() where org_id = p_org_id;
    v_pack := v_pack + p_amount;
  end if;

  insert into public.credit_ledger
    (org_id, app_id, entry_type, amount, plan_delta, pack_delta, balance_after,
     reason, ref_type, ref_id, idempotency_key, actor_id, metadata)
  values
    (p_org_id, p_app_id, 'grant', p_amount,
     case when p_bucket = 'plan' then p_amount else 0 end,
     case when p_bucket = 'pack' then p_amount else 0 end,
     v_plan + v_pack, p_reason, p_ref_type, p_ref_id, p_idempotency_key, p_actor_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return query select v_row.id, v_row.balance_after;
end;
$$;

-- refund_credits: consume 행을 가리키는 환불. 부분 환불 가능, 누적 환불은 원 차감액을 넘지 못한다(CR003).
create or replace function public.refund_credits(
  p_consume_ledger_id bigint,
  p_reason            text,
  p_amount            integer default null,
  p_idempotency_key   text    default null,
  p_actor_id          uuid    default null
)
returns table (ledger_id bigint, new_balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig       public.credit_ledger;
  v_row        public.credit_ledger;
  v_ref_plan   integer;
  v_ref_pack   integer;
  v_rem_plan   integer;
  v_rem_pack   integer;
  v_amount     integer;
  v_back_plan  integer;
  v_back_pack  integer;
  v_plan       integer;
  v_pack       integer;
begin
  if not public.is_privileged_session() then
    raise exception 'refund_credits: service_role only' using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('credit:' || p_idempotency_key));
    select * into v_row from public.credit_ledger l where l.idempotency_key = p_idempotency_key;
    if found then
      return query select v_row.id, v_row.balance_after;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('refund:' || p_consume_ledger_id::text));

  select * into v_orig from public.credit_ledger l where l.id = p_consume_ledger_id;
  if not found or v_orig.entry_type <> 'consume' then
    raise exception 'refund_credits: ledger % is not a consume entry', p_consume_ledger_id using errcode = 'CR002';
  end if;

  select coalesce(sum(l.plan_delta), 0), coalesce(sum(l.pack_delta), 0)
  into v_ref_plan, v_ref_pack
  from public.credit_ledger l where l.refund_of = p_consume_ledger_id;

  v_rem_plan := (-v_orig.plan_delta) - v_ref_plan;
  v_rem_pack := (-v_orig.pack_delta) - v_ref_pack;
  v_amount   := coalesce(p_amount, v_rem_plan + v_rem_pack);

  if v_amount <= 0 or v_amount > v_rem_plan + v_rem_pack then
    raise exception 'refund_credits: amount % exceeds refundable %', v_amount, v_rem_plan + v_rem_pack using errcode = 'CR003';
  end if;

  v_back_plan := least(v_rem_plan, v_amount);
  v_back_pack := v_amount - v_back_plan;

  select w.plan_balance, w.pack_balance into v_plan, v_pack
  from public.wallets w where w.org_id = v_orig.org_id for update;

  update public.wallets
  set plan_balance = plan_balance + v_back_plan,
      pack_balance = pack_balance + v_back_pack,
      updated_at   = now()
  where org_id = v_orig.org_id;

  insert into public.credit_ledger
    (org_id, app_id, entry_type, amount, plan_delta, pack_delta, balance_after,
     reason, ref_type, ref_id, refund_of, idempotency_key, actor_id, metadata)
  values
    (v_orig.org_id, v_orig.app_id, 'refund', v_amount, v_back_plan, v_back_pack, v_plan + v_pack + v_amount,
     p_reason, v_orig.ref_type, v_orig.ref_id, p_consume_ledger_id, p_idempotency_key, p_actor_id, '{}'::jsonb)
  returning * into v_row;

  return query select v_row.id, v_row.balance_after;
end;
$$;

-- 부트스트랩 2단계(SECTION 2 버전 교체): 구독/엔타이틀먼트 + 가입 크레딧(pack) + 첫 달 플랜 크레딧(plan)
create or replace function public.on_signup_app_bootstrap(p_org_id uuid, p_user_id uuid, p_app_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app    public.apps;
  v_plan   public.plans;
  v_sub    public.subscriptions;
  v_period_end timestamptz;
  v_key    text;
begin
  select * into v_app from public.apps where id = p_app_id and status <> 'disabled';
  if not found then
    return;
  end if;

  if v_app.signup_policy = 'approval' then
    update public.profiles set status = 'pending' where id = p_user_id and status = 'active';
  end if;

  select * into v_plan from public.plans where app_id = p_app_id and is_default and is_active limit 1;
  if not found then
    return;
  end if;

  v_period_end := case v_plan.billing_interval
    when 'month' then now() + interval '1 month'
    when 'year'  then now() + interval '1 year'
    else null end;

  insert into public.subscriptions (org_id, app_id, plan_id, status, current_period_start, current_period_end)
  values (p_org_id, p_app_id, v_plan.id, 'active', now(), v_period_end)
  on conflict (org_id, app_id) do nothing;

  select * into v_sub from public.subscriptions where org_id = p_org_id and app_id = p_app_id;

  insert into public.app_entitlements (org_id, app_id, plan_id, status, source)
  values (p_org_id, p_app_id, v_plan.id, 'active', 'signup')
  on conflict (org_id, app_id) do nothing;

  if v_plan.signup_credits > 0 then
    perform public.grant_credits(p_org_id, v_plan.signup_credits, p_app_id, 'signup_credits', 'pack',
                                 'signup', p_user_id::text, 'signup:' || p_org_id::text || ':' || p_app_id,
                                 '{}'::jsonb, null, false);
  end if;

  if v_plan.monthly_credits > 0 and v_sub.id is not null then
    v_key := 'monthly:' || v_sub.id::text || ':' || to_char(v_sub.current_period_start, 'YYYY-MM-DD');
    perform public.grant_credits(p_org_id, v_plan.monthly_credits, p_app_id, 'monthly_plan_credits', 'plan',
                                 'subscription', v_sub.id::text, v_key, '{}'::jsonb, null, not v_plan.carry_over);
    update public.subscriptions set last_credit_grant_key = v_key where id = v_sub.id;
  end if;
end;
$$;

-- 월 크레딧 지급 (service_role / pg_cron). 구독 굴림(SECTION 2) → 지급. 멱등 키 = monthly:<sub>:<period_start>
create or replace function public.run_monthly_credit_grants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_key text; v_count integer := 0;
begin
  if not public.is_privileged_session() then
    raise exception 'run_monthly_credit_grants: service_role only' using errcode = '42501';
  end if;

  perform public.run_subscription_rollover();

  for r in
    select s.id, s.org_id, s.app_id, s.current_period_start, p.monthly_credits, p.carry_over
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('active', 'trialing')
      and p.monthly_credits > 0
      and p.billing_interval in ('month', 'year')
      and s.current_period_start <= now()
      and (s.current_period_end is null or s.current_period_end > now())
      and coalesce(s.last_credit_grant_key, '') <> 'monthly:' || s.id::text || ':' || to_char(s.current_period_start, 'YYYY-MM-DD')
  loop
    v_key := 'monthly:' || r.id::text || ':' || to_char(r.current_period_start, 'YYYY-MM-DD');
    perform public.grant_credits(r.org_id, r.monthly_credits, r.app_id, 'monthly_plan_credits', 'plan',
                                 'subscription', r.id::text, v_key, '{}'::jsonb, null, not r.carry_over);
    update public.subscriptions set last_credit_grant_key = v_key where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 조직 영구 삭제(탈퇴 유예 종료 후). 원장/감사 삭제 허용 GUC 를 트랜잭션 범위로 켠다.
create or replace function public.purge_organization(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_privileged_session() then
    raise exception 'purge_organization: service_role only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org_id and o.deleted_at is not null) then
    raise exception 'purge_organization: organization must be soft-deleted first' using errcode = 'P0001';
  end if;
  perform set_config('core.allow_purge', 'on', true);
  delete from public.organizations where id = p_org_id;
end;
$$;

drop policy if exists wallets_select on public.wallets;
create policy wallets_select on public.wallets for select to authenticated using (public.is_org_member(org_id));
drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger for select to authenticated using (public.is_org_member(org_id));
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using (public.is_org_member(org_id));


-- [arch-studio 제거] SECTION 6-A oauth_states, 6-B encrypted_credentials: 이 제품은 제3자 OAuth 연결(채널·마켓)과 서버 보관 API 키가 없다.
--   로그인 OAuth 는 Supabase Auth 가 맡고, 사용자 키(BYOK)는 PRD D-10 에 따라 Phase 2 데스크톱 OS 키체인 검토 대상이라 서버에 저장하지 않는다.
--   SECTION 10 은 to_regclass/to_regprocedure 로 없는 객체를 건너뛰므로 그대로 동작한다.

-- =====================================================================
-- SECTION 6-C. rate_limit_buckets: 고정 윈도우 카운터 (Redis 없는 제품의 기본 레이트 리밋)  [선택]
-- 원본: 0004_core_security.sql 7절. 의존: SECTION 0 만
-- =====================================================================

create table if not exists public.rate_limit_buckets (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.rate_limit_buckets enable row level security;
drop trigger if exists rate_limit_buckets_guard_write on public.rate_limit_buckets;
create trigger rate_limit_buckets_guard_write before insert or update or delete on public.rate_limit_buckets
  for each row execute function public.guard_privileged_write();

-- 반환: allowed, remaining, reset_at. 호출 1회 = 1 히트.
create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer; v_start timestamptz; v_win interval;
begin
  if not public.is_privileged_session() then
    raise exception 'rate_limit_hit: service_role only' using errcode = '42501';
  end if;
  v_win := make_interval(secs => p_window_seconds);
  insert into public.rate_limit_buckets as b (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count        = case when b.window_start + v_win <= now() then 1 else b.count + 1 end,
        window_start = case when b.window_start + v_win <= now() then now() else b.window_start end,
        updated_at   = now()
  returning b.count, b.window_start into v_count, v_start;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_start + v_win;
end;
$$;

create or replace function public.purge_rate_limit_buckets(p_older_than interval default interval '1 day')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if not public.is_privileged_session() then
    raise exception 'purge_rate_limit_buckets: service_role only' using errcode = '42501';
  end if;
  delete from public.rate_limit_buckets where updated_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- =====================================================================
-- SECTION 7. jobs: 범용 잡 테이블(SKIP LOCKED), 실패 시 자동 환불, Realtime 발행  [선택]
-- 원본: 0005_core_jobs_storage.sql 1절. 의존: SECTION 1, 2(apps), 4(credit_ledger FK, refund_credits)
-- SECTION 4 를 지웠으면: credit_ledger_id 컬럼, fail_job / cancel_job 의 refund 블록을 지운다.
-- 워커 규약: claim_jobs → (heartbeat_job)* → complete_job | fail_job. BullMQ 를 쓰는 파이프라인도 상태 정본은 이 테이블.
-- =====================================================================

create table if not exists public.jobs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  app_id            text not null references public.apps(id),
  queue             text not null default 'default',
  job_type          text not null,
  payload           jsonb not null default '{}'::jsonb,
  result            jsonb,
  status            text not null default 'queued'
                    constraint jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  priority          integer not null default 100,
  attempts          integer not null default 0,
  max_attempts      integer not null default 3,
  run_after         timestamptz not null default now(),
  locked_at         timestamptz,
  locked_by         text,
  heartbeat_at      timestamptz,
  progress          integer not null default 0 constraint jobs_progress_check check (progress between 0 and 100),
  progress_message  text,
  last_error        text,
  credit_ledger_id  bigint references public.credit_ledger(id),   -- SECTION 4 의존
  refund_on_failure boolean not null default true,
  idempotency_key   text unique,
  parent_job_id     uuid references public.jobs(id) on delete set null,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists jobs_claim_idx on public.jobs (queue, priority, run_after, created_at) where status = 'queued';
create index if not exists jobs_org_created_idx on public.jobs (org_id, created_at desc);
create index if not exists jobs_running_heartbeat_idx on public.jobs (heartbeat_at) where status = 'running';
create index if not exists jobs_parent_idx on public.jobs (parent_job_id) where parent_job_id is not null;

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();
drop trigger if exists jobs_guard_write on public.jobs;
create trigger jobs_guard_write before insert or update or delete on public.jobs
  for each row execute function public.guard_privileged_write();

alter table public.jobs enable row level security;
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated using (public.is_org_member(org_id));

create or replace function public.enqueue_job(
  p_org_id            uuid,
  p_app_id            text,
  p_queue             text,
  p_job_type          text,
  p_payload           jsonb       default '{}'::jsonb,
  p_priority          integer     default 100,
  p_run_after         timestamptz default now(),
  p_max_attempts      integer     default 3,
  p_credit_ledger_id  bigint      default null,
  p_idempotency_key   text        default null,
  p_parent_job_id     uuid        default null,
  p_created_by        uuid        default null,
  p_refund_on_failure boolean     default true
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.jobs;
begin
  if not public.is_privileged_session() then
    raise exception 'enqueue_job: service_role only' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtext('job:' || p_idempotency_key));
    select * into v_row from public.jobs j where j.idempotency_key = p_idempotency_key;
    if found then
      return v_row;
    end if;
  end if;
  insert into public.jobs (org_id, app_id, queue, job_type, payload, priority, run_after, max_attempts,
                           credit_ledger_id, idempotency_key, parent_job_id, created_by, refund_on_failure)
  values (p_org_id, p_app_id, coalesce(p_queue, 'default'), p_job_type, coalesce(p_payload, '{}'::jsonb), p_priority,
          coalesce(p_run_after, now()), greatest(p_max_attempts, 1), p_credit_ledger_id, p_idempotency_key,
          p_parent_job_id, p_created_by, p_refund_on_failure)
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.claim_jobs(
  p_queue     text,
  p_worker_id text,
  p_limit     integer default 1,
  p_job_types text[]  default null
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_privileged_session() then
    raise exception 'claim_jobs: service_role only' using errcode = '42501';
  end if;
  return query
  with picked as (
    select j.id
    from public.jobs j
    where j.queue = p_queue
      and j.status = 'queued'
      and j.run_after <= now()
      and (p_job_types is null or j.job_type = any (p_job_types))
    order by j.priority asc, j.run_after asc, j.created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.jobs j
  set status       = 'running',
      locked_at    = now(),
      locked_by    = p_worker_id,
      heartbeat_at = now(),
      started_at   = coalesce(j.started_at, now()),
      attempts     = j.attempts + 1
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.heartbeat_job(p_job_id uuid, p_worker_id text, p_progress integer default null, p_message text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ok boolean;
begin
  if not public.is_privileged_session() then
    raise exception 'heartbeat_job: service_role only' using errcode = '42501';
  end if;
  update public.jobs
  set heartbeat_at     = now(),
      progress         = coalesce(p_progress, progress),
      progress_message = coalesce(p_message, progress_message)
  where id = p_job_id and status = 'running' and locked_by = p_worker_id;
  v_ok := found;
  return v_ok;
end;
$$;

create or replace function public.complete_job(p_job_id uuid, p_worker_id text, p_result jsonb default '{}'::jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.jobs;
begin
  if not public.is_privileged_session() then
    raise exception 'complete_job: service_role only' using errcode = '42501';
  end if;
  update public.jobs
  set status = 'succeeded', result = coalesce(p_result, '{}'::jsonb), progress = 100,
      finished_at = now(), locked_at = null, locked_by = null
  where id = p_job_id and status = 'running' and locked_by = p_worker_id
  returning * into v_row;
  if not found then
    raise exception 'complete_job: job % is not running under worker %', p_job_id, p_worker_id using errcode = 'JB001';
  end if;
  return v_row;
end;
$$;

-- 실패 처리. 재시도 가능 + attempts < max_attempts 면 지수 백오프 재큐잉, 아니면 최종 실패 + 자동 환불.
create or replace function public.fail_job(
  p_job_id              uuid,
  p_worker_id           text,
  p_error               text,
  p_retryable           boolean default true,
  p_retry_delay_seconds integer default 60
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.jobs; v_delay interval;
begin
  if not public.is_privileged_session() then
    raise exception 'fail_job: service_role only' using errcode = '42501';
  end if;
  select * into v_row from public.jobs where id = p_job_id for update;
  if not found or v_row.status <> 'running' or v_row.locked_by is distinct from p_worker_id then
    raise exception 'fail_job: job % is not running under worker %', p_job_id, p_worker_id using errcode = 'JB001';
  end if;

  if p_retryable and v_row.attempts < v_row.max_attempts then
    v_delay := make_interval(secs => p_retry_delay_seconds * power(2, greatest(v_row.attempts - 1, 0)));
    update public.jobs
    set status = 'queued', run_after = now() + v_delay, last_error = left(p_error, 4000),
        locked_at = null, locked_by = null, heartbeat_at = null
    where id = p_job_id
    returning * into v_row;
    return v_row;
  end if;

  update public.jobs
  set status = 'failed', last_error = left(p_error, 4000), finished_at = now(),
      locked_at = null, locked_by = null
  where id = p_job_id
  returning * into v_row;

  -- SECTION 4 의존(자동 환불)
  if v_row.refund_on_failure and v_row.credit_ledger_id is not null then
    perform public.refund_credits(v_row.credit_ledger_id, 'job_failed:' || v_row.job_type, null,
                                  'refund:job:' || v_row.id::text, null);
  end if;
  return v_row;
end;
$$;

-- 사용자가 대기 중(queued)인 자기 조직 잡을 취소(환불 포함). running 은 워커가 취소 플래그를 봐야 하므로 제외.
create or replace function public.cancel_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.jobs;
begin
  select * into v_row from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'cancel_job: not found' using errcode = 'P0002';
  end if;
  if not public.is_service_caller() and not public.is_org_member(v_row.org_id) then
    raise exception 'cancel_job: not a member' using errcode = '42501';
  end if;
  if v_row.status <> 'queued' then
    raise exception 'cancel_job: only queued jobs can be canceled (status=%)', v_row.status using errcode = 'JB002';
  end if;
  update public.jobs set status = 'canceled', finished_at = now() where id = p_job_id returning * into v_row;
  -- SECTION 4 의존(환불)
  if v_row.refund_on_failure and v_row.credit_ledger_id is not null then
    perform public.refund_credits(v_row.credit_ledger_id, 'job_canceled:' || v_row.job_type, null,
                                  'refund:job:' || v_row.id::text, auth.uid());
  end if;
  perform public.write_audit(v_row.org_id, 'job.cancel', 'job', v_row.id::text);
  return v_row;
end;
$$;

-- 하트비트가 끊긴 running 잡을 실패 처리(스케줄러)
create or replace function public.reap_stale_jobs(p_stale_seconds integer default 600)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; v_count integer := 0;
begin
  if not public.is_privileged_session() then
    raise exception 'reap_stale_jobs: service_role only' using errcode = '42501';
  end if;
  for r in
    select j.id, j.locked_by from public.jobs j
    where j.status = 'running' and coalesce(j.heartbeat_at, j.locked_at) < now() - make_interval(secs => p_stale_seconds)
    for update skip locked
  loop
    perform public.fail_job(r.id, r.locked_by, 'stale heartbeat', true, 60);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Realtime: 진행률 UI 는 jobs 변경을 RLS 하에서 구독한다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;
end $$;


-- =====================================================================
-- SECTION 8. Storage: 버킷 3개 + "폴더 = org_id" 정책  [선택]
-- 원본: 0005_core_jobs_storage.sql 2절. 의존: SECTION 5-A 헬퍼
-- 경로 규칙: <org_id>/<app_id>/<entity>/<uuid>.<ext>
-- 버킷: org-files(비공개 50MB), exports(비공개 200MB, 서명 URL), public-assets(공개 읽기, 10MB 이미지)
-- =====================================================================

create or replace function public.storage_org_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('org-files',     'org-files',     false, 52428800,  null),
  ('exports',       'exports',       false, 209715200, null),
  ('public-assets', 'public-assets', true,  10485760,  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;

drop policy if exists org_files_select on storage.objects;
create policy org_files_select on storage.objects for select to authenticated
  using (bucket_id = 'org-files' and public.is_org_member(public.storage_org_id(name)));
drop policy if exists org_files_insert on storage.objects;
create policy org_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'org-files' and public.is_org_member(public.storage_org_id(name)));
drop policy if exists org_files_update on storage.objects;
create policy org_files_update on storage.objects for update to authenticated
  using (bucket_id = 'org-files' and public.is_org_member(public.storage_org_id(name)))
  with check (bucket_id = 'org-files' and public.is_org_member(public.storage_org_id(name)));
drop policy if exists org_files_delete on storage.objects;
create policy org_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'org-files' and (owner_id = auth.uid()::text or public.has_org_role(public.storage_org_id(name), array['owner', 'admin'])));

drop policy if exists exports_select on storage.objects;
create policy exports_select on storage.objects for select to authenticated
  using (bucket_id = 'exports' and public.is_org_member(public.storage_org_id(name)));

drop policy if exists public_assets_select on storage.objects;
create policy public_assets_select on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-assets');
drop policy if exists public_assets_insert on storage.objects;
create policy public_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-assets' and public.is_org_member(public.storage_org_id(name)));
drop policy if exists public_assets_update on storage.objects;
create policy public_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'public-assets' and public.is_org_member(public.storage_org_id(name)))
  with check (bucket_id = 'public-assets' and public.is_org_member(public.storage_org_id(name)));
drop policy if exists public_assets_delete on storage.objects;
create policy public_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-assets' and public.has_org_role(public.storage_org_id(name), array['owner', 'admin']));


-- [arch-studio 제거] SECTION 9 affiliate: 제휴마케팅은 video·blog 계열 전용이고(절 머리 [선택: video, blog 계열만]) 이 제품에 제휴 링크가 없다.
--   또 6-B(encrypted_credentials)에 의존하므로 6-B 와 함께 지운다.

-- =====================================================================
-- SECTION 10. 권한 정리  [필수]  -- 절을 지워도 동작한다(존재하는 객체에만 적용)
-- 1) public 의 모든 테이블/뷰/시퀀스/함수에서 anon, authenticated, PUBLIC 권한을 회수한다.
--    (Supabase 가 public 에 기본으로 준 권한 + 위에서 만들어진 모든 객체)
-- 2) 허용 목록만 다시 준다. 테이블은 SELECT(일부 컬럼 UPDATE), 함수는 사용자용 RPC 만.
-- 3) service_role 은 모든 것을 가진다(BYPASSRLS).
-- 이 파일은 제품 도메인 마이그레이션보다 먼저 적용되므로 이 시점의 public 객체는 코어 객체만이다.
-- =====================================================================

do $$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'v', 'p')
  loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);
    execute format('grant all on table public.%I to service_role', r.relname);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', r.relname);
    execute format('grant all on sequence public.%I to service_role', r.relname);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 허용 목록: 테이블 SELECT (+ 비권한 컬럼 UPDATE)
do $$
declare
  t text;
  v_auth_select text[] := array[
    'profiles', 'organizations', 'org_members', 'audit_log',
    'subscriptions', 'app_entitlements',
    'payment_orders', 'payments', 'billing_key_summaries',
    'wallets', 'credit_ledger', 'ai_usage', 'credit_balances',
    'credential_summaries',
    'jobs',
    'affiliate_accounts', 'affiliate_links', 'affiliate_clicks', 'affiliate_disclosures', 'brandconnect_applications'
  ];
  v_public_select text[] := array['apps', 'plans', 'credit_packs'];
begin
  foreach t in array v_auth_select loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
  foreach t in array v_public_select loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to anon, authenticated', t);
    end if;
  end loop;
  if to_regclass('public.profiles') is not null then
    grant update (display_name, avatar_url, locale, last_seen_at) on public.profiles to authenticated;
  end if;
  if to_regclass('public.organizations') is not null then
    grant update (name, settings) on public.organizations to authenticated;
  end if;
end $$;

-- 허용 목록: 함수 EXECUTE
--   anon + authenticated : 정책 안에서 쓰는 헬퍼(SECURITY DEFINER, 읽기 전용)
--   authenticated        : 사용자용 RPC (안에서 is_service_caller + 역할 검사)
--   service_role 전용    : consume/grant/refund_credits, confirm_payment_order, enqueue/claim/heartbeat/complete/fail_job,
--                          create/consume_oauth_state, rate_limit_hit, record_affiliate_click, 스케줄 함수, purge_* (위 1)에서 이미 부여)
do $$
declare
  s text;
  v_anon_auth text[] := array[
    'public.jwt_role()', 'public.is_privileged_session()', 'public.is_service_caller()',
    'public.current_org_ids()', 'public.is_org_member(uuid)', 'public.has_org_role(uuid,text[])',
    'public.current_org_role(uuid)', 'public.is_platform_admin()',
    'public.storage_org_id(text)'
  ];
  v_auth text[] := array[
    'public.has_entitlement(uuid,text)', 'public.entitled_plan_code(uuid,text)',
    'public.personal_org_id()', 'public.session_context(text,uuid)', 'public.bootstrap_app_for_org(text,uuid)',
    'public.write_audit(uuid,text,text,text,jsonb,jsonb,jsonb)',
    'public.invite_member(uuid,uuid,text)', 'public.accept_invite(uuid)', 'public.approve_member(uuid,uuid)',
    'public.change_member_role(uuid,uuid,text)', 'public.remove_member(uuid,uuid)',
    'public.transfer_ownership(uuid,uuid)', 'public.approve_profile(uuid)',
    'public.revoke_credential(uuid)',
    'public.cancel_job(uuid)',
    'public.effective_disclosure(uuid,text,text)', 'public.upsert_affiliate_disclosure(uuid,text,text,text)',
    'public.consent_brandconnect_risk(uuid)',
    'public.create_brandconnect_application(uuid,text,text,text,text,text,text,text,text)'
  ];
begin
  foreach s in array v_anon_auth loop
    if to_regprocedure(s) is not null then
      execute format('grant execute on function %s to anon, authenticated', s);
    end if;
  end loop;
  foreach s in array v_auth loop
    if to_regprocedure(s) is not null then
      execute format('grant execute on function %s to authenticated', s);
    end if;
  end loop;
end $$;

-- =====================================================================
-- SECTION 11. AI 계층: 제공자·단가·라우팅(상용/오픈소스 이원화), RAG(pgvector), 제품 지식 위키,
--             채팅 대화 사본, LangGraph 실행 기록  [필수: 12개 제품 모두 MVP에 AI 기능]
-- 원본: _supabase-modular/migrations/0008_core_ai.sql. 설계: _platform-core/AI_ARCHITECTURE.md, LLM_WIKI.md
-- 모듈러와의 차이: credit_ledger, jobs 외래키 없음(선택 절을 지운 제품 대응), ai_usage가 없으면 생성,
--                  제공자·단가·기본 라우팅을 이 절에서 넣는다(모듈러는 seed.sql).
-- =====================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 1. 제공자, 모델 단가, 라우팅 설정, 조직 AI 설정(국외 이전 동의)
-- ---------------------------------------------------------------------
create table if not exists public.ai_providers (
  id            text primary key,                         -- anthropic, openai, google, openrouter, oss-llm, voyage, oss-embed, elevenlabs, oss-voice (hms는 hms-*)
  name          text not null,
  source        text not null constraint ai_providers_source_check check (source in ('commercial', 'open_source')),
  kinds         text[] not null,                          -- llm, embedding, stt, tts 중 지원 목록
  cross_border  boolean not null default false,           -- 국외 이전 여부(개인정보 처리방침 고지 대상)
  is_active     boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ai_providers_kinds_check check (kinds <@ array['llm', 'embedding', 'stt', 'tts']::text[] and cardinality(kinds) > 0),
  constraint ai_providers_oss_domestic_check check (source = 'commercial' or not cross_border)
);

create table if not exists public.ai_model_prices (
  id                uuid primary key default gen_random_uuid(),
  provider_id       text not null references public.ai_providers(id) on delete cascade,
  model             text not null default '*',            -- '*' = 그 제공자의 기본 단가
  kind              text not null constraint ai_model_prices_kind_check check (kind in ('llm', 'embedding', 'stt', 'tts')),
  unit              text not null constraint ai_model_prices_unit_check
                    check (unit in ('1k_input_tokens', '1k_output_tokens', '1k_tokens', 'minute', '1k_characters')),
  credits_per_unit  numeric(12, 4) not null constraint ai_model_prices_credits_check check (credits_per_unit >= 0),
  license           text,                                 -- 오픈소스 모델의 라이선스(상업 이용 가능 여부 확인 결과)
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider_id, model, kind, unit)
);

-- org_id null = 플랫폼 기본값, app_id null = 모든 앱, feature '*' = 앱의 기본값
create table if not exists public.ai_routing_settings (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references public.organizations(id) on delete cascade,
  app_id             text references public.apps(id) on delete cascade,
  feature            text not null default '*' constraint ai_routing_settings_feature_check check (feature = lower(btrim(feature)) and feature <> ''),
  kind               text not null constraint ai_routing_settings_kind_check check (kind in ('llm', 'embedding', 'stt', 'tts')),
  mode               text not null default 'auto' constraint ai_routing_settings_mode_check check (mode in ('commercial', 'open_source', 'auto')),
  chain              jsonb not null default '[]'::jsonb,  -- [{"provider":"anthropic","model":"*"}, ...] 대체 순서
  force_open_source  boolean not null default false,      -- 민감 데이터: 상용 API로 보내지 않는다
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ai_routing_settings_chain_check check (jsonb_typeof(chain) = 'array'),
  constraint ai_routing_settings_force_check check (not force_open_source or mode = 'open_source')
);
create unique index if not exists ai_routing_settings_scope_uniq
  on public.ai_routing_settings (coalesce(org_id::text, ''), coalesce(app_id, ''), feature, kind);

-- 조직 AI 설정: 국외 이전(상용 제공자) 동의. 동의가 없으면 라우터는 국외 제공자를 쓰지 않는다.
create table if not exists public.ai_org_settings (
  org_id               uuid primary key references public.organizations(id) on delete cascade,
  cross_border_ack_at  timestamptz,
  cross_border_notice  text,                              -- 동의한 고지문 버전
  ack_by               uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. RAG: 컬렉션, 문서, 청크
-- ---------------------------------------------------------------------
create table if not exists public.ai_collections (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  app_id              text not null references public.apps(id),
  kind                text not null constraint ai_collections_kind_check check (kind in ('rag', 'wiki')),
  name                text not null,
  embedding_provider  text not null references public.ai_providers(id),
  embedding_model     text not null,
  embedding_dim       integer not null default 1024 constraint ai_collections_dim_check check (embedding_dim = 1024),
  status              text not null default 'active' constraint ai_collections_status_check check (status in ('active', 'reindexing', 'archived')),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, app_id, name),
  unique (id, org_id, app_id)
);

create table if not exists public.ai_documents (
  id             uuid primary key default gen_random_uuid(),
  collection_id  uuid not null,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  app_id         text not null references public.apps(id),
  source_type    text not null constraint ai_documents_source_check check (source_type in ('upload', 'url', 'text', 'product', 'wiki')),
  title          text,
  storage_path   text,
  source_url     text,
  content_hash   text not null,
  mime           text,
  byte_size      bigint,
  status         text not null default 'pending'
                 constraint ai_documents_status_check check (status in ('pending', 'indexing', 'ready', 'failed', 'deleted')),
  contains_pii   boolean not null default false,          -- true면 오픈소스 임베딩·LLM만 허용(라우터가 강제)
  error          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (collection_id, content_hash),
  unique (id, org_id, app_id, collection_id),
  foreign key (collection_id, org_id, app_id) references public.ai_collections(id, org_id, app_id) on delete cascade
);
create index if not exists ai_documents_org_idx on public.ai_documents (org_id, app_id, status);

create table if not exists public.ai_chunks (
  id             bigint generated always as identity primary key,
  document_id    uuid not null,
  collection_id  uuid not null,
  org_id         uuid not null references public.organizations(id) on delete cascade,
  app_id         text not null references public.apps(id),
  chunk_index    integer not null,
  content        text not null,
  token_count    integer,
  embedding      extensions.vector(1024) not null,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (document_id, chunk_index),
  foreign key (document_id, org_id, app_id, collection_id)
    references public.ai_documents(id, org_id, app_id, collection_id) on delete cascade
);
create index if not exists ai_chunks_scope_idx on public.ai_chunks (org_id, app_id, collection_id);
create index if not exists ai_chunks_embedding_hnsw on public.ai_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------
-- 3. 제품 지식 위키 (LLM Wiki)
-- ---------------------------------------------------------------------
create table if not exists public.wiki_pages (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  app_id               text not null references public.apps(id),
  collection_id        uuid references public.ai_collections(id) on delete set null,  -- 위키 페이지 임베딩 컬렉션(kind=wiki)
  slug                 text not null constraint wiki_pages_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$'),
  title                text not null,
  summary              text,
  body_md              text not null default '',
  page_type            text not null default 'topic' constraint wiki_pages_type_check check (page_type in ('index', 'topic', 'entity', 'concept', 'source', 'log')),
  version              integer not null default 1,
  status               text not null default 'published' constraint wiki_pages_status_check check (status in ('draft', 'published', 'archived')),
  last_editor          text not null default 'agent' constraint wiki_pages_editor_check check (last_editor in ('agent', 'user')),
  last_edited_by       uuid,
  source_document_ids  uuid[] not null default '{}',      -- 근거 원본(낡음 판정, 개인정보 유래 추적)
  derived_from_pii     boolean not null default false,    -- 개인정보 원본에서 유래하면 오픈소스로만 처리
  stale_since          timestamptz,                       -- lint가 원본보다 오래됐다고 판정한 시각
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, app_id, slug),
  unique (id, org_id)
);

create table if not exists public.wiki_links (
  org_id        uuid not null references public.organizations(id) on delete cascade,
  from_page_id  uuid not null,
  to_page_id    uuid not null,
  created_at    timestamptz not null default now(),
  primary key (from_page_id, to_page_id),
  constraint wiki_links_self_check check (from_page_id <> to_page_id),
  foreign key (from_page_id, org_id) references public.wiki_pages(id, org_id) on delete cascade,
  foreign key (to_page_id, org_id) references public.wiki_pages(id, org_id) on delete cascade
);

create table if not exists public.wiki_revisions (
  id                   bigint generated always as identity primary key,
  page_id              uuid not null,
  org_id               uuid not null references public.organizations(id) on delete cascade,
  version              integer not null,
  body_md              text not null,
  editor_kind          text not null constraint wiki_revisions_editor_check check (editor_kind in ('agent', 'user')),
  edited_by            uuid,
  reason               text,
  source_document_ids  uuid[] not null default '{}',
  created_at           timestamptz not null default now(),
  unique (page_id, version),
  foreign key (page_id, org_id) references public.wiki_pages(id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 4. 채팅 대화(플랫폼 대화 id ↔ Dify 매핑), 메시지, LangGraph 실행 기록
--    Next.js가 대화를 시작할 때 이 행을 먼저 만들고, 플랫폼 대화 id와 dify_user를 Dify에 넘긴다.
--    FastAPI는 Dify가 보낸 (플랫폼 대화 id, dify_user)가 이 행과 일치할 때만 org를 확정한다.
-- ---------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id                     uuid primary key default gen_random_uuid(),   -- 플랫폼 대화 id(Dify 입력 platform_conversation_id)
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  app_id                 text not null references public.apps(id),
  user_id                uuid,                              -- 로그인 사용자
  visitor_key            text,                              -- 비로그인 방문자: 서버가 만든 쿠키 값의 해시
  dify_user              text not null,                     -- 서버가 만든 불투명 값. 클라이언트 입력 금지
  dify_conversation_id   text,                              -- 첫 응답 후 Next.js가 채운다
  channel                text not null default 'text' constraint ai_conversations_channel_check check (channel in ('text', 'voice')),
  status                 text not null default 'active' constraint ai_conversations_status_check check (status in ('active', 'closed')),
  title                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (app_id, dify_conversation_id),
  unique (id, org_id),
  constraint ai_conversations_owner_check check (user_id is not null or visitor_key is not null)
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (org_id, user_id, updated_at desc);

create table if not exists public.ai_messages (
  id                bigint generated always as identity primary key,
  conversation_id   uuid not null,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  role              text not null constraint ai_messages_role_check check (role in ('user', 'assistant', 'tool')),
  content           text not null,
  citations         jsonb not null default '[]'::jsonb,     -- [{"type":"chunk","id":..},{"type":"wiki","slug":..}]
  provider_id       text references public.ai_providers(id),
  model             text,
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  credits           integer not null default 0,
  credit_ledger_id  bigint,
  created_at        timestamptz not null default now(),
  foreign key (conversation_id, org_id) references public.ai_conversations(id, org_id) on delete cascade
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

create table if not exists public.ai_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  app_id            text not null references public.apps(id),
  graph             text not null,                          -- 예: astro.reading, blog.post_draft
  status            text not null default 'queued'
                    constraint ai_runs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,
  error             text,
  provider_id       text references public.ai_providers(id),
  model             text,
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  credits           integer not null default 0,
  credit_ledger_id  bigint,
  job_id            uuid,
  trace_id          text,
  thread_id         text,                                   -- LangGraph 체크포인트 thread
  created_by        uuid,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now(),
  unique (id, org_id)
);
create index if not exists ai_runs_org_idx on public.ai_runs (org_id, app_id, created_at desc);

create table if not exists public.ai_run_steps (
  id           bigint generated always as identity primary key,
  run_id       uuid not null,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  node         text not null,
  status       text not null constraint ai_run_steps_status_check check (status in ('running', 'succeeded', 'failed', 'skipped')),
  provider_id  text references public.ai_providers(id),
  model        text,
  tokens       integer not null default 0,
  detail       jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  foreign key (run_id, org_id) references public.ai_runs(id, org_id) on delete cascade
);

-- ai_usage는 SECTION 4(크레딧)에 있다. 그 절을 지운 제품을 위해 없으면 여기서 만든다(ledger 외래키 없음).
create table if not exists public.ai_usage (
  id              bigint generated always as identity primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  app_id          text references public.apps(id),
  provider        text not null,
  model           text not null,
  purpose         text,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_usd_micros bigint not null default 0,
  credits         integer not null default 0,
  ledger_id       bigint,
  latency_ms      integer,
  status          text not null default 'ok' constraint ai_usage_status_check check (status in ('ok', 'error', 'fallback')),
  error_code      text,
  request_id      text,
  created_at      timestamptz not null default now()
);
create index if not exists ai_usage_org_created_idx on public.ai_usage (org_id, created_at desc);
alter table public.ai_usage enable row level security;
grant select on public.ai_usage to authenticated;
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated using (public.is_org_member(org_id));

-- ai_usage 확장: 임베딩·음성 사용량과 제공자 구분, 실행 연결, 정산 상태
--   과금: 턴·실행 시작 때 예상 크레딧을 선차감(멱등 키 = conv:<id>:turn:<n> 등)하고,
--   실제 사용량을 기록한 뒤 차액을 정산한다. settled_at이 비어 있는 행은 정산 잡이 처리한다.
alter table public.ai_usage add column if not exists kind text not null default 'llm';
alter table public.ai_usage add column if not exists source text;
alter table public.ai_usage add column if not exists feature text;
alter table public.ai_usage add column if not exists audio_seconds numeric(10, 2);
alter table public.ai_usage add column if not exists characters integer;
alter table public.ai_usage add column if not exists run_id uuid;
alter table public.ai_usage add column if not exists conversation_id uuid;
alter table public.ai_usage add column if not exists settled_at timestamptz;
do $$ begin
  alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('llm', 'embedding', 'stt', 'tts', 'image'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_usage add constraint ai_usage_source_check check (source is null or source in ('commercial', 'open_source'));
exception when duplicate_object then null; end $$;
create index if not exists ai_usage_unsettled_idx on public.ai_usage (created_at) where settled_at is null;

-- LangGraph 체크포인트: langgraph-checkpoint-postgres가 setup() 때 이 스키마에 표준 테이블을 만든다.
create schema if not exists ai_runtime;
revoke all on schema ai_runtime from public, anon, authenticated;
grant usage, create on schema ai_runtime to service_role;

-- ---------------------------------------------------------------------
-- 5. updated_at, 쓰기 보호, 위키 이력 불변
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ai_providers', 'ai_model_prices', 'ai_routing_settings', 'ai_org_settings', 'ai_collections',
                           'ai_documents', 'wiki_pages', 'ai_conversations', 'ai_runs'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['ai_providers', 'ai_model_prices', 'ai_routing_settings', 'ai_org_settings', 'ai_collections',
                           'ai_documents', 'ai_chunks', 'wiki_pages', 'wiki_links', 'wiki_revisions', 'ai_conversations',
                           'ai_messages', 'ai_runs', 'ai_run_steps'] loop
    execute format('drop trigger if exists %1$s_guard_write on public.%1$s', t);
    execute format('create trigger %1$s_guard_write before insert or update or delete on public.%1$s for each row execute function public.guard_privileged_write()', t);
    execute format('alter table public.%s enable row level security', t);
  end loop;
end $$;

-- 위키 이력은 수정·삭제 불가. 예외: 조직 삭제(purge_organization)와 개인정보 삭제(purge_wiki_page)만
-- public.allow_purge를 켜고 service_role 세션에서 지운다.
create or replace function public.wiki_revisions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('core.allow_purge', true) = 'on' and public.is_privileged_session() then
    return old;
  end if;
  raise exception 'wiki_revisions is append-only' using errcode = '42501';
end;
$$;
drop trigger if exists wiki_revisions_immutable on public.wiki_revisions;
create trigger wiki_revisions_immutable before update or delete on public.wiki_revisions
  for each row execute function public.wiki_revisions_immutable();

-- ---------------------------------------------------------------------
-- 6. 함수
-- ---------------------------------------------------------------------

-- 체인 정규화(내부용): 존재·활성·종류가 맞는 제공자만 남기고, 강제 시 오픈소스만, 국외 동의가 없으면 국외 제공자 제외
create or replace function public.ai_filter_chain(p_chain jsonb, p_kind text, p_force boolean, p_cross_border_ok boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.item order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_chain, '[]'::jsonb)) with ordinality as e(item, ord)
  join public.ai_providers p on p.id = e.item ->> 'provider'
  where p.is_active
    and p_kind = any (p.kinds)
    and (not p_force or p.source = 'open_source')
    and (p_cross_border_ok or not p.cross_border);
$$;

-- 벡터 검색(service_role 전용): 조직·앱 필터를 항상 강제한다. 컬렉션을 주면 그 조직 소유인지 확인한다.
-- HNSW + 조직 필터에서 결과가 k보다 적게 나오는 문제를 줄이려고 반복 스캔을 켠다(pgvector 0.8 이상).
create or replace function public.match_ai_chunks(
  p_org_id         uuid,
  p_app_id         text,
  p_embedding      extensions.vector,
  p_k              integer default 8,
  p_collection_id  uuid default null,
  p_min_similarity real default 0
)
returns table (chunk_id bigint, document_id uuid, collection_id uuid, content text, metadata jsonb, similarity real)
language plpgsql
stable
security definer
set search_path = ''
set hnsw.ef_search = 100
set hnsw.iterative_scan = relaxed_order
as $$
begin
  if not public.is_privileged_session() then
    raise exception 'match_ai_chunks: service_role only' using errcode = '42501';
  end if;
  if p_org_id is null or p_app_id is null then
    raise exception 'match_ai_chunks: org and app are required' using errcode = '22023';
  end if;
  if p_k is null or p_k < 1 or p_k > 50 then
    raise exception 'match_ai_chunks: k must be 1..50' using errcode = '22023';
  end if;
  if p_collection_id is not null and not exists (
    select 1 from public.ai_collections c where c.id = p_collection_id and c.org_id = p_org_id and c.app_id = p_app_id
  ) then
    raise exception 'match_ai_chunks: collection not in org/app' using errcode = '42501';
  end if;
  return query
    select ch.id, ch.document_id, ch.collection_id, ch.content, ch.metadata,
           (1 - (ch.embedding operator(extensions.<=>) p_embedding))::real as similarity
    from public.ai_chunks ch
    join public.ai_documents d on d.id = ch.document_id and d.org_id = ch.org_id and d.status = 'ready'
    where ch.org_id = p_org_id
      and ch.app_id = p_app_id
      and (p_collection_id is null or ch.collection_id = p_collection_id)
      and (1 - (ch.embedding operator(extensions.<=>) p_embedding)) >= p_min_similarity
    order by ch.embedding operator(extensions.<=>) p_embedding
    limit p_k;
end;
$$;

-- 유효 라우팅 계산(service_role 전용).
--   1) 가장 구체적인 설정(조직 > 플랫폼, 앱 > 전체, 기능 > '*')의 모드와 체인을 고른다.
--   2) 범위 안의 어떤 행이라도 force_open_source면 오픈소스로 강제하고 체인에서 상용 제공자를 뺀다.
--   3) 조직이 국외 이전에 동의하지 않았으면 국외 제공자를 체인에서 뺀다.
--   4) 걸러진 체인이 비면 플랫폼 기본 체인을 같은 규칙으로 걸러 쓴다. 그래도 비면 빈 체인(라우터는 실패 처리).
create or replace function public.resolve_ai_route(p_org_id uuid, p_app_id text, p_feature text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_feature text := lower(btrim(coalesce(p_feature, '*')));
  v_row     public.ai_routing_settings;
  v_force   boolean;
  v_ack     boolean;
  v_chain   jsonb;
  v_default jsonb;
begin
  if not public.is_privileged_session() then
    raise exception 'resolve_ai_route: service_role only' using errcode = '42501';
  end if;
  select * into v_row
  from public.ai_routing_settings s
  where s.kind = p_kind
    and (s.org_id = p_org_id or s.org_id is null)
    and (s.app_id = p_app_id or s.app_id is null)
    and (s.feature = v_feature or s.feature = '*')
  order by (s.org_id is not null) desc, (s.app_id is not null) desc, (s.feature <> '*') desc
  limit 1;

  select coalesce(bool_or(s.force_open_source), false) into v_force
  from public.ai_routing_settings s
  where s.kind = p_kind
    and (s.org_id = p_org_id or s.org_id is null)
    and (s.app_id = p_app_id or s.app_id is null)
    and (s.feature = v_feature or s.feature = '*');

  select exists (select 1 from public.ai_org_settings o where o.org_id = p_org_id and o.cross_border_ack_at is not null)
    into v_ack;

  v_chain := public.ai_filter_chain(v_row.chain, p_kind, v_force, v_ack);
  if jsonb_array_length(v_chain) = 0 then
    select s.chain into v_default from public.ai_routing_settings s
    where s.org_id is null and s.app_id is null and s.feature = '*' and s.kind = p_kind;
    v_chain := public.ai_filter_chain(v_default, p_kind, v_force, v_ack);
    if jsonb_array_length(v_chain) = 0 then
      select coalesce(jsonb_agg(jsonb_build_object('provider', p.id, 'model', '*') order by p.id), '[]'::jsonb) into v_chain
      from public.ai_providers p
      where p.is_active and p_kind = any (p.kinds) and p.source = 'open_source';
    end if;
  end if;

  return jsonb_build_object(
    'mode', case when v_force then 'open_source' else coalesce(v_row.mode, 'auto') end,
    'chain', v_chain,
    'force_open_source', v_force,
    'cross_border_ack', v_ack,
    'setting_id', v_row.id
  );
end;
$$;

-- 조직 라우팅 변경(owner/admin).
--   - 엔타이틀먼트가 있는 앱만, 기능 키는 소문자·공백 제거로 정규화
--   - 체인 제공자는 존재·활성·종류 일치, open_source 모드는 오픈소스 제공자만
--   - 국외 제공자를 체인에 넣으려면 조직의 국외 이전 동의가 먼저 있어야 한다(AI002)
--   - 플랫폼이 강제한 오픈소스 범위는 풀 수 없다(AI001)
create or replace function public.set_ai_routing(
  p_org_id uuid, p_app_id text, p_feature text, p_kind text, p_mode text,
  p_chain jsonb default '[]'::jsonb, p_force_open_source boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_feature text := lower(btrim(coalesce(p_feature, '*')));
  v_chain jsonb := coalesce(p_chain, '[]'::jsonb);
  v_platform_force boolean;
  v_bad integer;
begin
  if not public.is_service_caller() and not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'set_ai_routing: owner/admin only' using errcode = '42501';
  end if;
  if p_org_id is null or p_app_id is null or v_feature = '' then
    raise exception 'set_ai_routing: org, app and feature are required' using errcode = '22023';
  end if;
  if not public.is_service_caller() and not public.has_entitlement(p_org_id, p_app_id) then
    raise exception 'set_ai_routing: no entitlement for app %', p_app_id using errcode = '42501';
  end if;
  if p_mode not in ('commercial', 'open_source', 'auto') or p_kind not in ('llm', 'embedding', 'stt', 'tts') then
    raise exception 'set_ai_routing: invalid mode or kind' using errcode = '22023';
  end if;
  if jsonb_typeof(v_chain) <> 'array' then
    raise exception 'set_ai_routing: chain must be an array' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(v_chain) e(item)
  left join public.ai_providers p on p.id = e.item ->> 'provider'
  where p.id is null or not p.is_active or not (p_kind = any (p.kinds))
     or ((p_mode = 'open_source' or p_force_open_source) and p.source <> 'open_source');
  if v_bad > 0 then
    raise exception 'set_ai_routing: chain has unknown, inactive, wrong-kind or non-open-source providers' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_chain) e(item)
    join public.ai_providers p on p.id = e.item ->> 'provider'
    where p.cross_border
  ) and not exists (
    select 1 from public.ai_org_settings o where o.org_id = p_org_id and o.cross_border_ack_at is not null
  ) then
    raise exception 'set_ai_routing: cross-border consent required' using errcode = 'AI002';
  end if;
  select coalesce(bool_or(s.force_open_source), false) into v_platform_force
  from public.ai_routing_settings s
  where s.org_id is null and s.kind = p_kind
    and (s.app_id = p_app_id or s.app_id is null)
    and (s.feature = v_feature or s.feature = '*');
  if v_platform_force and (p_mode <> 'open_source' or not coalesce(p_force_open_source, false)) then
    raise exception 'set_ai_routing: platform requires open_source for this scope' using errcode = 'AI001';
  end if;
  insert into public.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source, updated_by)
  values (p_org_id, p_app_id, v_feature, p_kind, p_mode, v_chain, coalesce(p_force_open_source, false), auth.uid())
  on conflict ((coalesce(org_id::text, '')), (coalesce(app_id, '')), feature, kind)
  do update set mode = excluded.mode, chain = excluded.chain,
                force_open_source = excluded.force_open_source, updated_by = excluded.updated_by
  returning id into v_id;
  perform public.write_audit(p_org_id, 'ai.routing.set', 'ai_routing_setting', v_id::text, null,
                           jsonb_build_object('app', p_app_id, 'feature', v_feature, 'kind', p_kind, 'mode', p_mode,
                                              'force_open_source', p_force_open_source));
  return v_id;
end;
$$;

-- 국외 이전 동의 기록·철회(owner/admin). 철회하면 라우터는 국외 제공자를 즉시 빼고 쓴다.
create or replace function public.set_ai_cross_border_ack(p_org_id uuid, p_ack boolean, p_notice_version text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_service_caller() and not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'set_ai_cross_border_ack: owner/admin only' using errcode = '42501';
  end if;
  if p_ack and coalesce(btrim(p_notice_version), '') = '' then
    raise exception 'set_ai_cross_border_ack: notice version required' using errcode = '22023';
  end if;
  insert into public.ai_org_settings (org_id, cross_border_ack_at, cross_border_notice, ack_by)
  values (p_org_id, case when p_ack then now() end, case when p_ack then p_notice_version end, auth.uid())
  on conflict (org_id) do update
    set cross_border_ack_at = excluded.cross_border_ack_at,
        cross_border_notice = excluded.cross_border_notice,
        ack_by = excluded.ack_by;
  perform public.write_audit(p_org_id, case when p_ack then 'ai.cross_border.ack' else 'ai.cross_border.revoke' end,
                           'organization', p_org_id::text, null, jsonb_build_object('notice', p_notice_version));
end;
$$;

-- 위키 페이지 개인정보 삭제(service_role 전용): 페이지·링크·이력을 실제로 지운다. 평소 삭제는 status='archived'.
create or replace function public.purge_wiki_page(p_page_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  if not public.is_privileged_session() then
    raise exception 'purge_wiki_page: service_role only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'purge_wiki_page: reason required' using errcode = '22023';
  end if;
  select org_id into v_org from public.wiki_pages where id = p_page_id;
  if v_org is null then
    return;
  end if;
  perform set_config('core.allow_purge', 'on', true);
  delete from public.wiki_pages where id = p_page_id;
  perform set_config('core.allow_purge', 'off', true);
  perform public.write_audit(v_org, 'ai.wiki.purge', 'wiki_page', p_page_id::text, null, jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- 7. 권한과 RLS 정책 (SELECT만)
--    ai_chunks는 사용자에게 열지 않는다(임베딩·원문 대량 조회 차단). 검색은 FastAPI가 RPC로만.
-- ---------------------------------------------------------------------
grant select on public.ai_providers, public.ai_model_prices to authenticated;
grant select on public.ai_routing_settings, public.ai_org_settings, public.ai_collections, public.ai_documents,
                public.wiki_pages, public.wiki_links, public.wiki_revisions,
                public.ai_conversations, public.ai_messages, public.ai_runs, public.ai_run_steps to authenticated;
revoke all on public.ai_chunks from anon, authenticated;

drop policy if exists ai_providers_select on public.ai_providers;
create policy ai_providers_select on public.ai_providers for select to authenticated using (is_active);
drop policy if exists ai_model_prices_select on public.ai_model_prices;
create policy ai_model_prices_select on public.ai_model_prices for select to authenticated using (is_active);
drop policy if exists ai_routing_settings_select on public.ai_routing_settings;
create policy ai_routing_settings_select on public.ai_routing_settings for select to authenticated
  using (org_id is null or public.is_org_member(org_id));
drop policy if exists ai_org_settings_select on public.ai_org_settings;
create policy ai_org_settings_select on public.ai_org_settings for select to authenticated
  using (public.is_org_member(org_id));

do $$
declare t text;
begin
  foreach t in array array['ai_collections', 'ai_documents', 'wiki_pages', 'wiki_links', 'wiki_revisions',
                           'ai_runs', 'ai_run_steps'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_org_member(org_id))', t);
  end loop;
end $$;
drop policy if exists ai_chunks_select on public.ai_chunks;

-- 대화는 본인 것만 본다(같은 조직의 다른 멤버 대화, 방문자 대화는 보이지 않는다)
drop policy if exists ai_conversations_select on public.ai_conversations;
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id));
drop policy if exists ai_messages_select on public.ai_messages;
create policy ai_messages_select on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c
                 where c.id = conversation_id and c.user_id = auth.uid() and public.is_org_member(c.org_id)));

-- 함수 실행 권한: PUBLIC 회수 후 필요한 역할만
revoke execute on function public.ai_filter_chain(jsonb, text, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.match_ai_chunks(uuid, text, extensions.vector, integer, uuid, real) from public, anon, authenticated;
revoke execute on function public.resolve_ai_route(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.set_ai_routing(uuid, text, text, text, text, jsonb, boolean) from public, anon;
revoke execute on function public.set_ai_cross_border_ack(uuid, boolean, text) from public, anon;
revoke execute on function public.purge_wiki_page(uuid, text) from public, anon, authenticated;
revoke execute on function public.wiki_revisions_immutable() from public, anon, authenticated;
grant execute on function public.ai_filter_chain(jsonb, text, boolean, boolean) to service_role;
grant execute on function public.match_ai_chunks(uuid, text, extensions.vector, integer, uuid, real) to service_role;
grant execute on function public.resolve_ai_route(uuid, text, text, text) to service_role;
grant execute on function public.set_ai_routing(uuid, text, text, text, text, jsonb, boolean) to authenticated, service_role;
grant execute on function public.set_ai_cross_border_ack(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.purge_wiki_page(uuid, text) to service_role;

insert into public.ai_providers (id, name, source, kinds, cross_border, notes) values
  ('anthropic',  'Anthropic Claude',          'commercial',  array['llm'],        true,  '국외 이전 고지 대상'),
  ('openai',     'OpenAI ChatGPT',            'commercial',  array['llm'],        true,  '국외 이전 고지 대상'),
  ('google',     'Google Gemini',             'commercial',  array['llm'],        true,  '국외 이전 고지 대상'),
  ('openrouter', 'OpenRouter',                'commercial',  array['llm'],        true,  '대체 경로. 국외 이전 고지 대상'),
  ('oss-llm',    '오픈소스 LLM 서버(vLLM)',     'open_source', array['llm'],        false, '공용 GPU 서버. 상업 이용 가능 라이선스 모델만 등록'),
  ('voyage',     'Voyage AI',                 'commercial',  array['embedding'],  true,  '기본 임베딩. 국외 이전 고지 대상'),
  ('oss-embed',  '오픈소스 임베딩',              'open_source', array['embedding'],  false, '민감 데이터 컬렉션용'),
  ('elevenlabs', 'ElevenLabs',                'commercial',  array['stt', 'tts'], true,  'TypeScript SDK, Next.js 서버에서만 호출. 국외 이전 고지 대상'),
  ('oss-voice',  '오픈소스 음성 서버',           'open_source', array['stt', 'tts'], false, 'faster-whisper + 상업 이용 가능 TTS')
on conflict (id) do update
  set name = excluded.name, source = excluded.source, kinds = excluded.kinds,
      cross_border = excluded.cross_border, notes = excluded.notes;

insert into public.ai_model_prices (provider_id, model, kind, unit, credits_per_unit, license) values
  ('anthropic',  '*', 'llm',       '1k_input_tokens',  1.0000, null),
  ('anthropic',  '*', 'llm',       '1k_output_tokens', 4.0000, null),
  ('openai',     '*', 'llm',       '1k_input_tokens',  1.0000, null),
  ('openai',     '*', 'llm',       '1k_output_tokens', 4.0000, null),
  ('google',     '*', 'llm',       '1k_input_tokens',  1.0000, null),
  ('google',     '*', 'llm',       '1k_output_tokens', 4.0000, null),
  ('openrouter', '*', 'llm',       '1k_input_tokens',  1.0000, null),
  ('openrouter', '*', 'llm',       '1k_output_tokens', 4.0000, null),
  ('oss-llm',    '*', 'llm',       '1k_input_tokens',  0.2000, '모델별 확인'),
  ('oss-llm',    '*', 'llm',       '1k_output_tokens', 0.5000, '모델별 확인'),
  ('voyage',     '*', 'embedding', '1k_tokens',        0.0500, null),
  ('oss-embed',  '*', 'embedding', '1k_tokens',        0.0100, '모델별 확인'),
  ('elevenlabs', '*', 'stt',       'minute',           3.0000, null),
  ('elevenlabs', '*', 'tts',       '1k_characters',    5.0000, null),
  ('oss-voice',  '*', 'stt',       'minute',           0.5000, 'faster-whisper MIT'),
  ('oss-voice',  '*', 'tts',       '1k_characters',    1.0000, '모델별 확인')
on conflict (provider_id, model, kind, unit) do update
  set credits_per_unit = excluded.credits_per_unit, license = excluded.license;

-- 플랫폼 기본 라우팅(org 없음, 앱 없음). 제품은 기능별 기본값을 자기 seed나 운영 화면에서 추가한다.
insert into public.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source) values
  (null, null, '*', 'llm',       'auto',       '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"google","model":"*"},{"provider":"oss-llm","model":"*"}]', false),
  (null, null, '*', 'embedding', 'commercial', '[{"provider":"voyage","model":"*"},{"provider":"oss-embed","model":"*"}]', false),
  (null, null, '*', 'stt',       'auto',       '[{"provider":"oss-voice","model":"*"},{"provider":"elevenlabs","model":"*"}]', false),
  (null, null, '*', 'tts',       'auto',       '[{"provider":"elevenlabs","model":"*"},{"provider":"oss-voice","model":"*"}]', false)
on conflict ((coalesce(org_id::text, '')), (coalesce(app_id, '')), feature, kind) do update
  set mode = excluded.mode, chain = excluded.chain, force_open_source = excluded.force_open_source;

-- =====================================================================
-- SECTION 12. 음성: voice_sessions, voice_jobs, voice-audio 버킷, 만료 정리  [필수]
-- 원본: _supabase-modular/migrations/0009_core_voice.sql. 설계: _platform-core/VOICE_ARCHITECTURE.md
-- 의존: SECTION 11(ai_providers, ai_conversations)
-- =====================================================================

create table if not exists public.voice_sessions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  app_id           text not null references public.apps(id),
  user_id          uuid,                                   -- 비로그인 방문자 상담이면 null
  conversation_id  uuid,
  visitor_key      text,                                   -- 비로그인 방문자(ai_conversations.visitor_key와 같은 값)
  stt_provider_id  text references public.ai_providers(id),
  tts_provider_id  text references public.ai_providers(id),
  total_seconds    numeric(10, 2) not null default 0 constraint voice_sessions_seconds_check check (total_seconds >= 0),
  status           text not null default 'active' constraint voice_sessions_status_check check (status in ('active', 'ended')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  updated_at       timestamptz not null default now(),
  unique (id, org_id),
  constraint voice_sessions_owner_check check (user_id is not null or visitor_key is not null),
  foreign key (conversation_id, org_id) references public.ai_conversations(id, org_id) on delete set null (conversation_id)
);
create index if not exists voice_sessions_user_idx on public.voice_sessions (org_id, user_id, started_at desc);

create table if not exists public.voice_jobs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  app_id            text not null references public.apps(id),
  user_id           uuid,
  session_id        uuid,
  feature           text not null default 'voice_chat',     -- 예: voice_chat, dictation, lecture_note, narration
  kind              text not null constraint voice_jobs_kind_check check (kind in ('stt', 'tts')),
  provider_id       text not null references public.ai_providers(id),
  model             text,
  voice_id          text,                                   -- TTS 보이스(상용 보이스 id 또는 오픈소스 화자 키)
  status            text not null default 'queued'
                    constraint voice_jobs_status_check check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  duration_seconds  numeric(10, 2) constraint voice_jobs_duration_check check (duration_seconds is null or duration_seconds >= 0),
  characters        integer constraint voice_jobs_chars_check check (characters is null or characters >= 0),
  store_audio       boolean not null default false,
  consent_at        timestamptz,                            -- 녹음 저장 동의 시각(저장하는 기능은 필수)
  consent_kind      text constraint voice_jobs_consent_kind_check check (consent_kind is null or consent_kind in ('self', 'third_party_notice')),
  notice_version    text,                                   -- 동의한 고지문 버전
  storage_path      text,
  expires_at        timestamptz,
  fallback_from     text,                                   -- 대체 실행이면 원래 제공자
  credits           integer not null default 0,
  credit_ledger_id  bigint,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint voice_jobs_store_check check (not store_audio or (storage_path is not null and expires_at is not null)),
  constraint voice_jobs_no_store_check check (store_audio or storage_path is null),
  constraint voice_jobs_consent_check check (not store_audio or (consent_at is not null and consent_kind is not null)),
  foreign key (session_id, org_id) references public.voice_sessions(id, org_id) on delete set null (session_id)
);
create index if not exists voice_jobs_org_idx on public.voice_jobs (org_id, app_id, created_at desc);
create index if not exists voice_jobs_expiry_idx on public.voice_jobs (expires_at) where store_audio and status <> 'expired';

do $$
declare t text;
begin
  foreach t in array array['voice_sessions', 'voice_jobs'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$s', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists %1$s_guard_write on public.%1$s', t);
    execute format('create trigger %1$s_guard_write before insert or update or delete on public.%1$s for each row execute function public.guard_privileged_write()', t);
    execute format('alter table public.%s enable row level security', t);
  end loop;
end $$;

grant select on public.voice_sessions, public.voice_jobs to authenticated;
drop policy if exists voice_sessions_select on public.voice_sessions;
create policy voice_sessions_select on public.voice_sessions for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id));
drop policy if exists voice_jobs_select on public.voice_jobs;
create policy voice_jobs_select on public.voice_jobs for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id));

-- 녹음 보관 버킷: 비공개, 50MB, 오디오만. 경로 = <org_id>/<voice_job_id>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-audio', 'voice-audio', false, 52428800,
        array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/mp4'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 읽기: 그 녹음의 작업 주인(본인)만. 쓰기·삭제: service_role만(정책 없음)
drop policy if exists voice_audio_select on storage.objects;
create policy voice_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'voice-audio'
         and exists (select 1 from public.voice_jobs j
                     where j.storage_path = name and j.user_id = auth.uid() and public.is_org_member(j.org_id)));

-- 만료 녹음 정리(service_role / pg_cron): 만료된 작업을 expired로 바꾸고 지울 Storage 경로를 돌려준다.
-- 실제 객체 삭제는 서버가 Storage API로 한다(storage.objects 직접 삭제 금지).
create or replace function public.expire_voice_audio(p_limit integer default 500)
returns table (job_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_privileged_session() then
    raise exception 'expire_voice_audio: service_role only' using errcode = '42501';
  end if;
  return query
    with due as (
      select j.id
      from public.voice_jobs j
      where j.store_audio and j.status <> 'expired' and j.expires_at <= now()
      order by j.expires_at
      limit greatest(1, least(coalesce(p_limit, 500), 5000))
      for update skip locked
    )
    update public.voice_jobs v
       set status = 'expired', error = coalesce(v.error, 'audio expired')
      from due
     where v.id = due.id
    returning v.id, v.storage_path;
end;
$$;

revoke execute on function public.expire_voice_audio(integer) from public, anon, authenticated;
grant execute on function public.expire_voice_audio(integer) to service_role;

-- =====================================================================
-- 끝. 다음 파일: 0002_<product>_domain.sql (제품 도메인 테이블. org_id FK + RLS + 명시적 GRANT)
-- seed: apps 1행(id = 제품 스키마 이름), 기본 플랜 1행(is_default), 필요하면 affiliate 기본 문구.
-- =====================================================================
