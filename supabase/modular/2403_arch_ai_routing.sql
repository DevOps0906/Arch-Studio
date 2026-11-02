-- =====================================================================
-- 2403_arch_ai_routing.sql
-- arch-studio AI 라우팅 강제 행 + 공개 지식 컬렉션. 선행: 2400, 2401, 2402. 적용 순서 2400 → 2401 → 2402 → 2403. 2400 은 수정하지 않는다(AR-06-049).
-- 1) 라우팅 기본값 14행(org null, app 'arch')을 마이그레이션으로도 멱등 upsert 한다. 2400 의 seed 블록은 모놀리스에서 seed.sql 로
--    빠지므로, 운영에서 seed 를 안 돌리면 오픈소스 강제 행(arch.intake_consult·consult_recording·dify.aux)이 없어
--    '*' auto 행으로 떨어질 수 있었다. 값은 2400 seed 블록과 같아야 하며 scripts/db/convert.mjs(buildAll)가 대조한다(다르면 convert --check·pnpm test:db 실패).
--    불변식: 국외 이전 미동의 조직의 체인에는 cross_border 제공자가 없다(core.resolve_ai_route). force 행은 동의 조직도 오픈소스만.
-- 2) 공통 지식(법령·지구단위계획·질의회신): 플랫폼 코어(match_ai_chunks)는 org 일치만 검색한다. 코어를 바꾸지 않고
--    공개 컬렉션 등록부(arch.public_knowledge_collections, 플랫폼 운영자 조직 소유 컬렉션만)와 검색 래퍼를 둔다.
--    래퍼는 자기 조직 + 등록된 공개 컬렉션만 검색한다(service_role 전용, 다른 조직 id 인자 없음).
-- 반복 실행 가능.
-- =====================================================================

-- =====================================================================
-- 1. AI·음성 기능별 라우팅 기본값 14행 (2400 14절 seed 블록과 같은 값)
-- =====================================================================
-- 의도: do update 는 운영에서 손댄 기본 행(mode·chain·force)을 이 파일 값으로 되돌린다. 이 14행은 마이그레이션이 정본이다(조정은 org 행 또는 새 마이그레이션).
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

-- 체인 검사: 제공자 행이 있을 때만 존재·종류·오픈소스 모드를 확인한다. 14행 고정.
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
  if (select count(*) from core.ai_routing_settings s
      where s.org_id is null and s.app_id = 'arch'
        and s.feature in ('arch.review','arch.intake','arch.intake_consult','arch.proposal_narrative','arch.chat','arch.layout','arch.compliance',
                          'wiki.ingest','wiki.query','wiki.lint','dify.aux','arch.knowledge','consult_recording','voice_chat')) <> 14 then
    raise exception 'arch routing defaults: expected 14 rows';
  end if;
end $$;

-- =====================================================================
-- 2. 공개 지식 컬렉션 등록부 + 검색 래퍼
-- =====================================================================
-- 공개로 표시된 컬렉션(모든 조직이 검색 가능). 쓰기 service_role 뿐, 사용자 GRANT·정책 없음. 컬렉션 삭제 시 함께 사라진다.
create table if not exists arch.public_knowledge_collections (
  collection_id uuid primary key references core.ai_collections(id) on delete cascade,
  note          text,
  created_at    timestamptz not null default now()
);
comment on table arch.public_knowledge_collections is 'arch 공개 지식 컬렉션 등록부: 플랫폼 운영자 조직 소유 컬렉션만, 쓰기 service_role';

-- 등록 조건: 앱 arch 컬렉션이고 소유 조직의 owner 가 platform_admin. (조직 소유 컬렉션을 공개로 만드는 길을 막는다.)
create or replace function arch.check_public_knowledge_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from core.ai_collections c
    join core.organizations o on o.id = c.org_id
    join core.profiles p on p.id = o.owner_id
    where c.id = new.collection_id and c.app_id = 'arch' and p.platform_role = 'platform_admin'
  ) then
    raise exception 'public_knowledge_collections: only arch collections owned by a platform org' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists public_knowledge_collections_check on arch.public_knowledge_collections;
create trigger public_knowledge_collections_check before insert or update on arch.public_knowledge_collections
  for each row execute function arch.check_public_knowledge_collection();
drop trigger if exists public_knowledge_collections_guard_write on arch.public_knowledge_collections;
create trigger public_knowledge_collections_guard_write before insert or update or delete on arch.public_knowledge_collections
  for each row execute function core.guard_privileged_write();

alter table arch.public_knowledge_collections enable row level security;
revoke all on table arch.public_knowledge_collections from public, anon, authenticated;
grant all on table arch.public_knowledge_collections to service_role;

-- 벡터 검색 래퍼(service_role 전용). p_org 는 Route Handler 가 세션에서 정한 자기 조직이다(다른 조직 id 를 받는 인자는 없다).
-- 결과 = 자기 조직의 arch 청크 + 등록된 공개 컬렉션의 청크. p_collection_id 를 주면 그 두 범위 안이어야 한다(42501).
-- 공개 자격(소유 조직 owner 가 platform_admin)은 등록 때만이 아니라 검색 때마다 다시 확인한다(운영자 강등 시 즉시 0건).
-- 본문 쿼리는 core.match_ai_chunks 와 같은 모양이고, 코어 함수는 호출하지 않는다.
create or replace function arch.match_public_knowledge(
  p_org            uuid,
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
  if not core.is_service_caller() then
    raise exception 'match_public_knowledge: service_role only' using errcode = '42501';
  end if;
  if p_org is null or p_embedding is null then
    raise exception 'match_public_knowledge: org and embedding are required' using errcode = '22023';
  end if;
  if p_k is null or p_k < 1 or p_k > 50 then
    raise exception 'match_public_knowledge: k must be 1..50' using errcode = '22023';
  end if;
  if p_collection_id is not null and not exists (
    select 1 from core.ai_collections c
    where c.id = p_collection_id and c.app_id = 'arch'
      and (c.org_id = p_org or exists (select 1 from arch.public_knowledge_collections k
                  join core.ai_collections kc on kc.id = k.collection_id and kc.app_id = 'arch'
                  join core.organizations ko on ko.id = kc.org_id
                  join core.profiles kp on kp.id = ko.owner_id and kp.platform_role = 'platform_admin'
                  where k.collection_id = c.id))
  ) then
    raise exception 'match_public_knowledge: collection not in org or public set' using errcode = '42501';
  end if;
  return query
    select ch.id, ch.document_id, ch.collection_id, ch.content, ch.metadata,
           (1 - (ch.embedding operator(extensions.<=>) p_embedding))::real as similarity
    from core.ai_chunks ch
    join core.ai_documents d on d.id = ch.document_id and d.org_id = ch.org_id and d.status = 'ready'
    where ch.app_id = 'arch'
      and (ch.org_id = p_org
           or exists (select 1 from arch.public_knowledge_collections k
                  join core.ai_collections kc on kc.id = k.collection_id and kc.app_id = 'arch'
                  join core.organizations ko on ko.id = kc.org_id
                  join core.profiles kp on kp.id = ko.owner_id and kp.platform_role = 'platform_admin'
                  where k.collection_id = ch.collection_id))
      and (p_collection_id is null or ch.collection_id = p_collection_id)
      and (1 - (ch.embedding operator(extensions.<=>) p_embedding)) >= p_min_similarity
    order by ch.embedding operator(extensions.<=>) p_embedding
    limit p_k;
end;
$$;

-- ACL: PUBLIC·anon·authenticated 회수 → service_role 만.
revoke all on function arch.check_public_knowledge_collection() from public, anon, authenticated;
revoke all on function arch.match_public_knowledge(uuid, extensions.vector, integer, uuid, real) from public, anon, authenticated;
grant execute on function arch.match_public_knowledge(uuid, extensions.vector, integer, uuid, real) to service_role;
