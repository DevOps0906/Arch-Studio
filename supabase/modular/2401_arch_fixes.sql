-- =====================================================================
-- 2401_arch_fixes.sql
-- arch-studio 도메인 수정 1. 선행: 2400_arch.sql(정본, 수정하지 않는다). 2400 이후 수정은 이 조각에 쌓는다.
-- 1) start_ai_run 렌더 동시 한도(AR030): 2400 은 request_id 단위 자문 잠금(2400:1123)만 잡고 활성 렌더 수를 세서(2400:1170)
--    같은 조직의 서로 다른 request_id 가 동시에 들어오면 둘 다 검사를 통과했다. 렌더 분기에서 조직 단위
--    pg_advisory_xact_lock 을 잡은 뒤 센다. 시그니처·SECURITY DEFINER·set search_path = ''·ACL 은 2400 과 같다.
-- 반복 실행 가능.
-- =====================================================================

-- 7-7. AI 실행 시작(2401 재정의: 렌더 동시 한도 조직 단위 잠금). 그 밖의 본문은 2400 7-7 과 같다.
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
    -- 2401: 조직 단위 직렬화. 같은 조직의 다른 request_id 동시 요청이 활성 렌더 수 검사를 함께 통과하지 못하게 잠근 뒤 센다.
    --       잠금 순서는 request_id → 조직 → 일일 상한으로 고정한다(교착 없음). 트랜잭션 끝에 풀린다.
    perform pg_advisory_xact_lock(hashtext('arch:render_active'), hashtext(p_org::text));
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

-- ACL 은 2400 10절과 같다: PUBLIC·anon·authenticated 회수 → service_role 만.
revoke all on function arch.start_ai_run(uuid, uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function arch.start_ai_run(uuid, uuid, text, text, uuid, uuid, jsonb) to service_role;
