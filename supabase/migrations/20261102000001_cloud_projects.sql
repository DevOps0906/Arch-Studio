-- =====================================================================
-- 20261102000001_cloud_projects.sql (모놀리스 arch-studio)
-- 원본: supabase/modular/2402_cloud_projects.sql 의 변환본(DB_CONVENTIONS.md 12장: 스키마 블록 제거, core.·arch. → public.,
--   @monolith-seed 블록은 seed.sql 로 이동). 본문은 변환 외에 같다. 직접 고치지 말고 조각을 고친 뒤 다시 변환한다.
-- arch-studio 도메인 수정 2(AR-06-073 클라우드 프로젝트 저장). 선행: 2400_arch.sql·2401_arch_fixes.sql(수정하지 않는다).
-- 04_API 2.1절 계약(project_uuid 정본 키, local_id nullable, (org_id, project_uuid) 업서트)에 맞춘다. 결정: tasks/logs/AR-06-073.md [DECISION].
-- 1) cloud_projects: id PK 유지(write_audit 호환), project_uuid 추가 + unique(org_id, project_uuid), local_id nullable,
--    bytes(업로드 객체 크기, 목록 표시용) 추가. 백필: local_id 는 uuid 형식 열이라 항상 그대로 project_uuid 로 쓴다
--    (값이 없으면 새 UUID). 기존 경로 폴더 = local_id = project_uuid 라 새 경로 CHECK 를 그대로 만족한다.
--    unique(org_id, local_id) 는 유지(같은 local_id·다른 project_uuid = 23505).
-- 2) 경로 CHECK 와 변경 금지 트리거: 폴더 키를 project_uuid 로. project_uuid·org 불변, local_id 는 비어 있을 때 한 번만 채운다.
-- 3) SELECT 정책: 조직 구성원이면 엔타이틀먼트 없이 읽기(만료·폴백 조직의 데이터 회수 경로, 04_API 1장 402 예외, ADR-001 3.3).
-- 4) save_cloud_project 교체: 옛 (uuid, text, text, integer) DROP, 새 (p_project_uuid, p_local_id, p_name, p_storage_path,
--    p_expected_version). 업로드 객체(storage.objects, 버킷 arch-user) 존재·크기(≤100MB) 를 DB 안에서 재검사하고 bytes 로 저장한다.
--    AR041 은 detail 에 {"current_version": N}, AR040 은 detail 에 {"max": N}(메시지 원문에 숫자 없음).
--    엔타이틀먼트 없음 = AR044(→402, 04_API 7.1절). 반환 previous_path = 교체된 이전 객체 경로(서버가 저장 성공 후 지운다, 최신 1개만 보존). web_edit 재검사는 AR-06-074 몫.
-- 반복 실행 가능.
-- =====================================================================

-- 1. 열 추가·백필·키 교체
alter table public.cloud_projects add column if not exists project_uuid uuid;
alter table public.cloud_projects add column if not exists bytes bigint not null default 0;
-- 백필은 사용자 변경이 아니므로 updated_at(목록 정렬·커서 키)을 보존한다: set_updated_at 트리거를 잠시 끈다.
alter table public.cloud_projects disable trigger cloud_projects_set_updated_at;
update public.cloud_projects set project_uuid = coalesce(local_id, gen_random_uuid()) where project_uuid is null;
update public.cloud_projects c
   set bytes = coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                          where o.bucket_id = 'arch-user' and o.name = c.storage_path), 0)
 where c.bytes = 0;
alter table public.cloud_projects enable trigger cloud_projects_set_updated_at;
alter table public.cloud_projects alter column project_uuid set not null;
alter table public.cloud_projects alter column local_id drop not null;
alter table public.cloud_projects drop constraint if exists cloud_projects_bytes_check;
alter table public.cloud_projects add constraint cloud_projects_bytes_check check (bytes >= 0);
alter table public.cloud_projects drop constraint if exists cloud_projects_org_project_uuid_key;
alter table public.cloud_projects add constraint cloud_projects_org_project_uuid_key unique (org_id, project_uuid);
alter table public.cloud_projects drop constraint if exists cloud_projects_path_check;
alter table public.cloud_projects add constraint cloud_projects_path_check check (
  storage_path ~ ('^' || org_id::text || '/arch/project_snapshot/' || project_uuid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'));
comment on column public.cloud_projects.project_uuid is '정본 프로젝트 키(업로드 폴더 이름). 조직 안에서 유일, 바뀌지 않는다';
comment on column public.cloud_projects.local_id is '설치형에서 올린 사본의 로컬 프로젝트 ID(웹 프로젝트는 null). 한 번 채우면 바뀌지 않는다';
comment on column public.cloud_projects.bytes is '현재 업로드 객체 크기(storage.objects 메타데이터, save_cloud_project 가 기록)';

-- 2. 변경 금지 트리거(2402 재정의): version 은 줄지 않고, project_uuid·org 는 바뀌지 않으며, local_id 는 null → 값 한 번만.
create or replace function public.enforce_cloud_project_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version < old.version
     or new.project_uuid is distinct from old.project_uuid
     or new.org_id is distinct from old.org_id
     or (old.local_id is not null and new.local_id is distinct from old.local_id) then
    raise exception 'cloud_projects: version must not decrease, project_uuid/org/local_id immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 3. SELECT 정책: 조직 구성원(엔타이틀먼트 무관)
drop policy if exists cloud_projects_select on public.cloud_projects;
create policy cloud_projects_select on public.cloud_projects for select to authenticated
  using (public.is_org_member(org_id));

-- 4. 클라우드 사본 저장(2402 교체). 조직은 경로 첫 폴더에서 정하고 멤버십·엔타이틀먼트를 확인한다.
--    새 사본은 cloud_projects_max(AR040, detail max), 기존 사본은 낙관적 동시성(version = p_expected_version, 아니면 AR041, detail current_version).
drop function if exists public.save_cloud_project(uuid, text, text, integer);
create or replace function public.save_cloud_project(
  p_project_uuid     uuid,
  p_local_id         uuid,
  p_name             text,
  p_storage_path     text,
  p_expected_version integer
)
returns table (project_uuid uuid, version integer, previous_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org   uuid := public.storage_org_id(coalesce(p_storage_path, ''));
  v_row   public.cloud_projects;
  v_prev  text;
  v_bytes bigint;
  v_count integer;
  v_max   integer;
begin
  if v_org is null or p_project_uuid is null then
    raise exception 'save_cloud_project: storage path must start with org id' using errcode = '23514';
  end if;
  if not public.is_service_caller() and not public.has_org_role(v_org, array['owner', 'admin', 'member']) then
    raise exception 'save_cloud_project: not a member' using errcode = '42501';
  end if;
  if not public.has_entitlement(v_org, 'arch') then
    raise exception 'save_cloud_project: no entitlement' using errcode = 'AR044';  -- 권리 없음 → 402(04_API 1장·7.1절)
  end if;
  if p_storage_path !~ ('^' || v_org::text || '/arch/project_snapshot/' || p_project_uuid::text
                        || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$') then
    raise exception 'save_cloud_project: path must be <org>/arch/project_snapshot/<project_uuid>/<uuid>.<ext>' using errcode = '23514';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_expected_version is null or p_expected_version < 0 then
    raise exception 'save_cloud_project: invalid name or expected_version' using errcode = '22023';
  end if;
  -- 업로드 객체 재검사(서버 재검사와 별개로 RPC 직접 호출도 막는다). 크기는 Storage 메타데이터 값만 믿는다.
  select (o.metadata ->> 'size')::bigint into v_bytes
    from storage.objects o where o.bucket_id = 'arch-user' and o.name = p_storage_path;
  if v_bytes is null or v_bytes <= 0 then
    raise exception 'save_cloud_project: uploaded object not found' using errcode = '23514';
  end if;
  if v_bytes > 104857600 then
    raise exception 'save_cloud_project: object too large' using errcode = 'AR031';
  end if;
  perform pg_advisory_xact_lock(hashtext('arch:cloud:' || v_org::text));
  select * into v_row from public.cloud_projects c where c.org_id = v_org and c.project_uuid = p_project_uuid for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'save_cloud_project: version conflict' using errcode = 'AR041',
        detail = jsonb_build_object('current_version', 0)::text;
    end if;
    v_max := public.feature_int(public.org_features(v_org), 'cloud_projects_max', 3);
    select count(*) into v_count from public.cloud_projects c where c.org_id = v_org;
    if v_count >= v_max then
      raise exception 'save_cloud_project: cloud copy limit reached' using errcode = 'AR040',
        detail = jsonb_build_object('max', v_max)::text;
    end if;
    insert into public.cloud_projects (org_id, project_uuid, local_id, name, storage_path, bytes, version, created_by, updated_by)
    values (v_org, p_project_uuid, p_local_id, btrim(p_name), p_storage_path, v_bytes, 1, auth.uid(), auth.uid())
    returning * into v_row;
  else
    if v_row.version <> p_expected_version then
      raise exception 'save_cloud_project: version conflict' using errcode = 'AR041',
        detail = jsonb_build_object('current_version', v_row.version)::text;
    end if;
    v_prev := nullif(v_row.storage_path, p_storage_path);
    update public.cloud_projects c
       set name = btrim(p_name), storage_path = p_storage_path, bytes = v_bytes, version = c.version + 1,
           local_id = coalesce(c.local_id, p_local_id), updated_by = auth.uid(), updated_at = now()
     where c.id = v_row.id
    returning * into v_row;
  end if;
  perform public.write_audit(v_org, 'cloud_project.save', 'cloud_project', v_row.id::text, null, jsonb_build_object('version', v_row.version));
  return query select v_row.project_uuid, v_row.version, v_prev;
end;
$$;

-- 5. EXECUTE: PUBLIC·anon 회수 → service_role → authenticated(2400 10절과 같은 방식)
revoke all on function public.save_cloud_project(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.save_cloud_project(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.save_cloud_project(uuid, uuid, text, text, integer) to authenticated;
