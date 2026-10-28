-- =====================================================================
-- seed.sql (모놀리스 arch-studio)
-- 앱 레지스트리 1행(가입 트리거는 apps 가 1개면 자동 부트스트랩), 플랜 trial/updates_yearly/sub_monthly, 크레딧팩 3,
-- 라이선스 상품 2, 기능별 AI 라우팅 기본값 14행. 금액·크레딧·features 는 전부 제안값이며 정본은 01_PRD.md 4장·9.4절이다.
-- 아래 블록은 모듈러 2400_arch.sql 의 @monolith-seed 블록을 public 으로 변환한 것이다. 운영 상수(runtime_config)는 0002 12절.
-- 반복 실행 가능.
-- =====================================================================

insert into public.apps (id, name, schema_name, signup_policy, status) values
  ('arch', 'Arch Studio', 'public', 'open', 'beta')
on conflict (id) do update
  set name = excluded.name, schema_name = excluded.schema_name, signup_policy = excluded.signup_policy, status = excluded.status;

-- @monolith-seed-begin (모놀리스 변환 시 이 표시부터 @monolith-seed-end 까지는 seed.sql 이 소유한다)
-- =====================================================================
-- 13. 플랜·크레딧팩·라이선스 상품(01_PRD 4장, 전부 제안). 모듈러 seed.sql 반영은 코어 요청 C-4.
--     seed 순서와 무관하게 가입이 되도록 do nothing 으로 넣는다. 가격은 VAT 포함.
--     features 키: PRD 4.8(cloud_review ~ max_activations) + 9.4(drafting_watermark, ai_intake, ai_layout).
-- =====================================================================
insert into public.plans (app_id, code, name, description, price_krw, billing_interval, monthly_credits, signup_credits, carry_over, features, is_default, is_active, sort_order) values
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

insert into public.credit_packs (app_id, code, name, credits, price_krw, is_active, sort_order) values
  ('arch', 'pack_100',  '100 크레딧',   100,  10000,  true, 1),
  ('arch', 'pack_550',  '550 크레딧',   550,  50000,  true, 2),
  ('arch', 'pack_1200', '1,200 크레딧', 1200, 100000, true, 3)
on conflict (app_id, code) do nothing;

insert into public.license_skus (code, name, price_krw, includes_updates_months, bonus_credits, max_activations, max_quantity, fallback_features, is_active, sort_order) values
  ('perpetual_early', '영구 라이선스(사전예약)', 490000, 12, 300, 2, 100,
   '{"cloud_review": false, "rule_pack_updates": false, "ai_render": true, "local_gpu_render": false, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 0, "cloud_projects_max": 100, "max_activations": 2, "drafting_watermark": false, "ai_intake": true, "ai_layout": false}',
   true, 0),
  ('perpetual_standard', '영구 라이선스', 890000, 12, 300, 2, null,
   '{"cloud_review": false, "rule_pack_updates": false, "ai_render": true, "local_gpu_render": false, "render_max_px": 4096, "site_lookups_per_day": 30, "ai_chat_turns_per_day": 0, "cloud_projects_max": 100, "max_activations": 2, "drafting_watermark": false, "ai_intake": true, "ai_layout": false}',
   false, 1)
on conflict (code) do nothing;

-- =====================================================================
-- 14. AI·음성 기능별 라우팅 기본값(org_id null, app_id 'arch'). 정본 02_ARCHITECTURE.md 5절 표, 계약 14 #11. 모든 값은 제안.
--     이미지 public.render(fal)는 ai_routing_settings 종류(llm, embedding, stt, tts)가 아니라 워커 서버 상수다(02장 5절 제공자 표).
-- =====================================================================
insert into public.ai_routing_settings (org_id, app_id, feature, kind, mode, chain, force_open_source) values
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
  if exists (select 1 from public.ai_providers) then
    select string_agg(s.feature || '/' || s.kind || ':' || coalesce(e.item ->> 'provider', '?'), ', ') into v_bad
    from public.ai_routing_settings s
    cross join lateral jsonb_array_elements(s.chain) as e(item)
    left join public.ai_providers p on p.id = e.item ->> 'provider'
    where s.org_id is null and s.app_id = 'arch'
      and (p.id is null or not (s.kind = any (p.kinds))
           or ((s.mode = 'open_source' or s.force_open_source) and p.source <> 'open_source'));
    if v_bad is not null then
      raise exception 'arch routing defaults: invalid chain providers %', v_bad;
    end if;
  end if;
  if (select count(*) from public.ai_routing_settings s where s.org_id is null and s.app_id = 'arch') <> 14 then
    raise exception 'arch routing defaults: expected 14 rows';
  end if;
end $$;
-- @monolith-seed-end
