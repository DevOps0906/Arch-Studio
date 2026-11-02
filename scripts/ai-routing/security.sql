-- 실행: node scripts/ai-routing/run-sql.mjs (선행: npx supabase@2.122.0 start, 로컬 DB 에 마이그레이션·seed 적용)
-- AR-06-049 AI 라우팅·RAG 격리 SQL 단언(tasks/logs/AR-06-049.md [DECISION] 3). 형식은 supabase/tests/rls_smoke.sql 과 같다.
-- 러너가 전체를 한 트랜잭션으로 감싸고 끝에 rollback 한다(데이터 남지 않음, 반복 실행 가능).
-- 조직: oP(국외 미동의, override 없음), oQ(국외 미동의 + 상용 org override), oR(국외 동의 + 강제 기능에 상용 org override)
-- =====================================================================

-- SETUP (관리 세션)
insert into auth.users (id, email, raw_user_meta_data) values
  ('04900000-0000-4000-8000-00000000000a', 'p049@test.local', '{"signup_app": "arch", "full_name": "P"}'),
  ('04900000-0000-4000-8000-00000000000b', 'q049@test.local', '{"signup_app": "arch", "full_name": "Q"}'),
  ('04900000-0000-4000-8000-00000000000c', 'r049@test.local', '{"signup_app": "arch", "full_name": "R"}');
create temp table t_ai as
  select (select id from @C@.organizations where owner_id = '04900000-0000-4000-8000-00000000000a') as op,
         (select id from @C@.organizations where owner_id = '04900000-0000-4000-8000-00000000000b') as oq,
         (select id from @C@.organizations where owner_id = '04900000-0000-4000-8000-00000000000c') as orr,
         '04900000-0000-4000-8000-0000000000c1'::uuid as cp,
         '04900000-0000-4000-8000-0000000000c3'::uuid as cr,
         array_fill(0.1::real, array[1024])::extensions.vector(1024) as emb;
grant select on t_ai to anon, authenticated, service_role;
insert into @C@.ai_org_settings (org_id, cross_border_ack_at, cross_border_notice) select orr, now(), 'test-049' from t_ai;
-- oQ: 미동의인데 상용 체인을 org 기본('*')과 기능 행에 둔다(국외 필터만으로 막혀야 한다)
insert into @C@.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source)
  select oq, 'arch', '*', 'llm', 'commercial', '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"}]'::jsonb, false from t_ai
  union all
  select oq, 'arch', 'arch.review', 'llm', 'commercial', '[{"provider":"google","model":"*"},{"provider":"openrouter","model":"*"}]'::jsonb, false from t_ai;
-- oR: 동의 + 상용 org override(강제 기능 포함). 강제 기능은 그래도 오픈소스만이어야 한다
insert into @C@.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source)
  select orr, 'arch', '*', 'llm', 'commercial', '[{"provider":"anthropic","model":"*"},{"provider":"openai","model":"*"},{"provider":"google","model":"*"}]'::jsonb, false from t_ai
  union all
  select orr, 'arch', 'arch.intake_consult', 'llm', 'commercial', '[{"provider":"anthropic","model":"*"},{"provider":"oss-llm","model":"*"}]'::jsonb, false from t_ai
  union all
  select orr, 'arch', 'dify.aux', 'llm', 'auto', '[{"provider":"openai","model":"*"},{"provider":"oss-llm","model":"*"}]'::jsonb, false from t_ai
  union all
  select orr, 'arch', 'consult_recording', 'stt', 'commercial', '[{"provider":"elevenlabs","model":"*"},{"provider":"oss-voice","model":"*"}]'::jsonb, false from t_ai;
-- RAG: oP·oR 에 컬렉션 1개·문서 1개(ready)·청크 1개씩
insert into @C@.ai_collections (id, org_id, app_id, kind, name, embedding_provider, embedding_model)
  select cp, op, 'arch', 'rag', 'c049-p', 'oss-embed', 'test' from t_ai
  union all
  select cr, orr, 'arch', 'rag', 'c049-r', 'oss-embed', 'test' from t_ai;
insert into @C@.ai_documents (id, collection_id, org_id, app_id, source_type, content_hash, status)
  select '04900000-0000-4000-8000-0000000000d1'::uuid, cp, op, 'arch', 'text', 'h049p', 'ready' from t_ai
  union all
  select '04900000-0000-4000-8000-0000000000d3'::uuid, cr, orr, 'arch', 'text', 'h049r', 'ready' from t_ai;
insert into @C@.ai_chunks (document_id, collection_id, org_id, app_id, chunk_index, content, embedding)
  select '04900000-0000-4000-8000-0000000000d1'::uuid, cp, op, 'arch', 0, 'P 청크', emb from t_ai
  union all
  select '04900000-0000-4000-8000-0000000000d3'::uuid, cr, orr, 'arch', 0, 'R 청크', emb from t_ai;
-- END SETUP

-- AS service
-- TEST 대조군: arch 기본 llm 기능 11개 | expect=rows:11
select f.feature from @C@.ai_routing_settings f where f.org_id is null and f.app_id = 'arch' and f.kind = 'llm'

-- TEST 미동의 oP: 모든 llm 기능 chain 에 cross_border 제공자 0 | expect=rows:0
select f.feature, e.item from t_ai t
  cross join @C@.ai_routing_settings f
  cross join lateral jsonb_array_elements(@C@.resolve_ai_route(t.op, 'arch', f.feature, 'llm') -> 'chain') as e(item)
  join @C@.ai_providers p on p.id = e.item ->> 'provider'
  where f.org_id is null and f.app_id = 'arch' and f.kind = 'llm' and p.cross_border

-- TEST 미동의 oP: 모든 llm 기능 chain 이 비지 않는다(대조군) | expect=rows:0
select f.feature from t_ai t cross join @C@.ai_routing_settings f
  where f.org_id is null and f.app_id = 'arch' and f.kind = 'llm'
    and jsonb_array_length(@C@.resolve_ai_route(t.op, 'arch', f.feature, 'llm') -> 'chain') = 0

-- TEST 미동의 oQ(상용 org override): 모든 llm 기능 chain 에 cross_border 제공자 0 | expect=rows:0
select f.feature, e.item from t_ai t
  cross join @C@.ai_routing_settings f
  cross join lateral jsonb_array_elements(@C@.resolve_ai_route(t.oq, 'arch', f.feature, 'llm') -> 'chain') as e(item)
  join @C@.ai_providers p on p.id = e.item ->> 'provider'
  where f.org_id is null and f.app_id = 'arch' and f.kind = 'llm' and p.cross_border

-- TEST 미동의 oQ: voice_chat stt chain 에 cross_border 제공자 0(elevenlabs 제외) | expect=rows:0
select e.item from t_ai t
  cross join lateral jsonb_array_elements(@C@.resolve_ai_route(t.oq, 'arch', 'voice_chat', 'stt') -> 'chain') as e(item)
  join @C@.ai_providers p on p.id = e.item ->> 'provider'
  where p.cross_border

-- TEST 대조군: 동의 oR 의 arch.review 는 org override 상용 3개(anthropic·openai·google)를 쓴다 | expect=rows:3
select e.item from t_ai t
  cross join lateral jsonb_array_elements(@C@.resolve_ai_route(t.orr, 'arch', 'arch.review', 'llm') -> 'chain') as e(item)
  join @C@.ai_providers p on p.id = e.item ->> 'provider'
  where p.cross_border

-- TEST 동의 oR + 상용 override: 강제 기능 3개 chain 에 상용 제공자 0 | expect=rows:0
select x.feature, e.item from t_ai t
  cross join (values ('arch.intake_consult', 'llm'), ('dify.aux', 'llm'), ('consult_recording', 'stt')) as x(feature, kind)
  cross join lateral jsonb_array_elements(@C@.resolve_ai_route(t.orr, 'arch', x.feature, x.kind) -> 'chain') as e(item)
  join @C@.ai_providers p on p.id = e.item ->> 'provider'
  where p.source <> 'open_source'

-- TEST 동의 oR: 강제 기능 3개 chain = oss-llm·oss-llm·oss-voice(비지 않음, 대조군) | expect=rows:3
select x.feature from t_ai t
  cross join (values ('arch.intake_consult', 'llm', 'oss-llm'), ('dify.aux', 'llm', 'oss-llm'), ('consult_recording', 'stt', 'oss-voice')) as x(feature, kind, prov)
  where @C@.resolve_ai_route(t.orr, 'arch', x.feature, x.kind) -> 'chain' = jsonb_build_array(jsonb_build_object('provider', x.prov, 'model', '*'))

-- TEST 동의 oR: 강제 기능 3개는 mode=open_source·force_open_source=true | expect=rows:3
select x.feature from t_ai t
  cross join (values ('arch.intake_consult', 'llm'), ('dify.aux', 'llm'), ('consult_recording', 'stt')) as x(feature, kind)
  cross join lateral (select @C@.resolve_ai_route(t.orr, 'arch', x.feature, x.kind) as r) z
  where z.r ->> 'mode' = 'open_source' and (z.r ->> 'force_open_source')::boolean

-- TEST match_ai_chunks: 다른 조직(oR) 컬렉션 지정은 42501 | expect=sqlstate:42501
select * from t_ai t cross join lateral @C@.match_ai_chunks(t.op, 'arch', t.emb, 8, t.cr) m

-- TEST match_ai_chunks: oP 검색 결과에 다른 조직 청크 0 | expect=rows:0
select m.* from t_ai t cross join lateral @C@.match_ai_chunks(t.op, 'arch', t.emb, 50) m
  where m.collection_id <> t.cp

-- TEST 대조군: oP 자기 컬렉션 검색은 1행 | expect=rows:1
select m.* from t_ai t cross join lateral @C@.match_ai_chunks(t.op, 'arch', t.emb, 8, t.cp) m

-- AS A
-- TEST authenticated 는 resolve_ai_route 실행 불가 | expect=sqlstate:42501
select @C@.resolve_ai_route(t.op, 'arch', 'arch.review', 'llm') from t_ai t

-- TEST authenticated 는 match_ai_chunks 실행 불가 | expect=sqlstate:42501
select * from t_ai t cross join lateral @C@.match_ai_chunks(t.op, 'arch', t.emb, 8) m
