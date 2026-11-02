-- =====================================================================
-- 20261102000001_arch_cloud_projects.sql (모놀리스 arch-studio)
-- 원본: supabase/modular/2402_arch_cloud_projects.sql 의 변환본(DB_CONVENTIONS.md 12장: 스키마 블록 제거, core.·arch. → public.,
--   @monolith-seed 블록은 seed.sql 로 이동). 본문은 변환 외에 같다. 직접 고치지 말고 조각을 고친 뒤 다시 변환한다.
-- arch-studio 도메인 수정 2: 클라우드 프로젝트 blob(AR-06-073). 선행: 2400_arch.sql, 2401_arch_fixes.sql(수정하지 않는다).
-- 1) cloud_projects 정본 키를 project_uuid 로 바꾼다. 유일성 (org_id, project_uuid), local_id 는 nullable + 부분 유일.
--    업로드 폴더 키 = project_uuid 하나(CHECK). 기존 행은 project_uuid = local_id 로 백필(로컬 데이터만).
-- 2) 조회 RLS = 조직 멤버십만(has_entitlement 제거): 만료·폴백 조직도 목록·열람 가능. 쓰기는 RPC 만.
-- 3) save_cloud_project 는 service_role 전용으로 재정의(옛 4인자 시그니처 drop). 행위자·조직은 route 가 세션에서 정해 넘기고
--    함수가 멤버십을 다시 확인한다. 오류 수치(현재 버전·상한)는 DETAIL(JSON)로 넘긴다.
-- 4) delete_cloud_project(service_role 전용) 추가. 반환한 storage_path 의 객체 정리는 route 몫.
-- 적용 순서: 2400 → 2401 → 2402 → 2403(모놀리스는 변환본 마이그레이션 번호 순). 2402 단독 반복 실행만 안전하다.
-- 2400 을 다시 적용하면 옛 4인자 save_cloud_project·엔타이틀먼트 SELECT 정책·local_id 폴더 CHECK 가 되살아나므로 2402 를 반드시 다시 적용한다.
-- =====================================================================

-- 1. 컬럼
alter table public.cloud_projects add column if not exists project_uuid uuid;
alter table public.cloud_projects add column if not exists blob_bytes bigint not null default 0;
alter table public.cloud_projects add column if not exists schema_version integer not null default 1;
update public.cloud_projects set project_uuid = local_id where project_uuid is null;
alter table public.cloud_projects alter column project_uuid set not null;
alter table public.cloud_projects alter column local_id drop not null;

alter table public.cloud_projects drop constraint if exists cloud_projects_blob_bytes_check;
alter table public.cloud_projects add constraint cloud_projects_blob_bytes_check check (blob_bytes >= 0);
alter table public.cloud_projects drop constraint if exists cloud_projects_schema_version_check;
alter table public.cloud_projects add constraint cloud_projects_schema_version_check check (schema_version >= 1);

alter table public.cloud_projects drop constraint if exists cloud_projects_org_id_local_id_key;
drop index if exists public.cloud_projects_org_local_uidx;
create unique index cloud_projects_org_local_uidx on public.cloud_projects (org_id, local_id) where local_id is not null;
drop index if exists public.cloud_projects_org_project_uidx;
create unique index cloud_projects_org_project_uidx on public.cloud_projects (org_id, project_uuid);

alter table public.cloud_projects drop constraint if exists cloud_projects_path_check;
alter table public.cloud_projects add constraint cloud_projects_path_check check (
  storage_path ~ ('^' || org_id::text || '/arch/project_snapshot/' || project_uuid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'));

comment on column public.cloud_projects.project_uuid is '정본 키. 업서트 기준 (org_id, project_uuid). 불변';

-- 불변 규칙: version 은 줄지 않고, org·project_uuid 는 바뀌지 않는다. local_id 는 null → 값 설정만 허용.
create or replace function public.enforce_cloud_project_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version < old.version
     or new.org_id is distinct from old.org_id
     or new.project_uuid is distinct from old.project_uuid
     or (old.local_id is not null and new.local_id is distinct from old.local_id) then
    raise exception 'cloud_projects: version must not decrease, org/project_uuid/local_id immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 2. 조회 RLS: 조직 멤버십만
drop policy if exists cloud_projects_select on public.cloud_projects;
create policy cloud_projects_select on public.cloud_projects for select to authenticated using (public.is_org_member(org_id));

-- 3. 저장 RPC(service_role 전용)
drop function if exists public.save_cloud_project(uuid, text, text, integer);

create or replace function public.save_cloud_project(
  p_org            uuid,
  p_actor          uuid,
  p_project_uuid   uuid,
  p_name           text,
  p_storage_path   text,
  p_expected_version integer,
  p_blob_bytes     bigint,
  p_schema_version integer,
  p_local_id       uuid default null
)
returns table (project_uuid uuid, version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row   public.cloud_projects;
  v_count integer;
  v_max   integer;
begin
  if not public.is_service_caller() then
    raise exception 'save_cloud_project: service only' using errcode = '42501';
  end if;
  if p_org is null or p_actor is null or p_project_uuid is null then
    raise exception 'save_cloud_project: org, actor, project required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = p_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')) then
    raise exception 'save_cloud_project: not a member' using errcode = '42501';
  end if;
  if not public.has_entitlement(p_org, 'arch') then
    raise exception 'save_cloud_project: no entitlement' using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || p_org::text || '/arch/project_snapshot/' || p_project_uuid::text
                        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$') then
    raise exception 'save_cloud_project: path must be <org>/arch/project_snapshot/<project_uuid>/<uuid>.<ext>' using errcode = '23514';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
     or p_expected_version is null or p_expected_version < 0
     or p_blob_bytes is null or p_blob_bytes <= 0
     or p_schema_version is null or p_schema_version < 1 then
    raise exception 'save_cloud_project: invalid name, expected_version, bytes or schema_version' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('arch:cloud:' || p_org::text));
  select * into v_row from public.cloud_projects c where c.org_id = p_org and c.project_uuid = p_project_uuid for update;

  if not found then
    if p_expected_version <> 0 then
      raise exception 'save_cloud_project: version conflict' using errcode = 'AR041', detail = jsonb_build_object('current_version', 0)::text;
    end if;
    v_max := public.feature_int(public.org_features(p_org), 'cloud_projects_max', 3);
    select count(*) into v_count from public.cloud_projects c where c.org_id = p_org;
    if v_count >= v_max then
      raise exception 'save_cloud_project: cloud copy limit reached' using errcode = 'AR040', detail = jsonb_build_object('max', v_max)::text;
    end if;
    if p_local_id is not null and exists (select 1 from public.cloud_projects c where c.org_id = p_org and c.local_id = p_local_id) then
      raise exception 'save_cloud_project: local_id already used' using errcode = '23505';
    end if;
    insert into public.cloud_projects (org_id, project_uuid, local_id, name, storage_path, version, blob_bytes, schema_version, created_by, updated_by)
    values (p_org, p_project_uuid, p_local_id, btrim(p_name), p_storage_path, 1, p_blob_bytes, p_schema_version, p_actor, p_actor)
    returning * into v_row;
  else
    if v_row.version <> p_expected_version then
      raise exception 'save_cloud_project: version conflict' using errcode = 'AR041', detail = jsonb_build_object('current_version', v_row.version)::text;
    end if;
    if p_local_id is not null then
      if v_row.local_id is not null and v_row.local_id <> p_local_id then
        raise exception 'save_cloud_project: local_id immutable' using errcode = '22023';
      end if;
      if v_row.local_id is null and exists (select 1 from public.cloud_projects c where c.org_id = p_org and c.local_id = p_local_id) then
        raise exception 'save_cloud_project: local_id already used' using errcode = '23505';
      end if;
    end if;
    update public.cloud_projects c
       set name = btrim(p_name), storage_path = p_storage_path, version = c.version + 1, blob_bytes = p_blob_bytes,
           schema_version = p_schema_version, local_id = coalesce(c.local_id, p_local_id), updated_by = p_actor
     where c.id = v_row.id
    returning * into v_row;
  end if;
  perform public.write_audit(p_org, 'cloud_project.save', 'cloud_project', v_row.id::text, null,
                           jsonb_build_object('version', v_row.version), jsonb_build_object('actor', p_actor));
  return query select v_row.project_uuid, v_row.version;
end;
$$;

-- 4. 삭제 RPC(service_role 전용). 다른 조직의 uuid 는 P0002 로 존재를 숨긴다. expected_version 은 선택(null 이면 무조건 삭제).
create or replace function public.delete_cloud_project(
  p_org              uuid,
  p_actor            uuid,
  p_project_uuid     uuid,
  p_expected_version integer default null
)
returns table (storage_path text, version integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.cloud_projects;
begin
  if not public.is_service_caller() then
    raise exception 'delete_cloud_project: service only' using errcode = '42501';
  end if;
  if p_org is null or p_actor is null or p_project_uuid is null or (p_expected_version is not null and p_expected_version < 0) then
    raise exception 'delete_cloud_project: invalid arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from public.org_members m
                 where m.org_id = p_org and m.user_id = p_actor and m.status = 'active' and m.role in ('owner', 'admin', 'member')) then
    raise exception 'delete_cloud_project: not a member' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:cloud:' || p_org::text));
  select * into v_row from public.cloud_projects c where c.org_id = p_org and c.project_uuid = p_project_uuid for update;
  if not found then
    raise exception 'delete_cloud_project: not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and v_row.version <> p_expected_version then
    raise exception 'delete_cloud_project: version conflict' using errcode = 'AR041', detail = jsonb_build_object('current_version', v_row.version)::text;
  end if;
  delete from public.cloud_projects c where c.id = v_row.id;
  perform public.write_audit(p_org, 'cloud_project.delete', 'cloud_project', v_row.id::text, null,
                           jsonb_build_object('version', v_row.version), jsonb_build_object('actor', p_actor));
  return query select v_row.storage_path, v_row.version;
end;
$$;

revoke all on function public.save_cloud_project(uuid, uuid, uuid, text, text, integer, bigint, integer, uuid) from public, anon, authenticated;
grant execute on function public.save_cloud_project(uuid, uuid, uuid, text, text, integer, bigint, integer, uuid) to service_role;
revoke all on function public.delete_cloud_project(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_cloud_project(uuid, uuid, uuid, integer) to service_role;
revoke all on function public.enforce_cloud_project_version() from public, anon, authenticated;
grant execute on function public.enforce_cloud_project_version() to service_role;
