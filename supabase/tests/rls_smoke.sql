-- 실행: node scripts/test-rls/run.mjs --target mono | mod   (pnpm test:rls = mono, 선행: npx supabase@2.122.0 db reset --local)
--       러너가 @S@/@C@ 를 모듈러는 arch/core, 모놀리스는 public/public 으로 치환하고, "-- AS <행위자>" 마다
--       역할(service_role 또는 authenticated + request.jwt.claim.sub)을 바꿔 "-- TEST" 다음 한 문장씩 실행한다.
-- =====================================================================
-- rls_smoke.sql : Arch Studio RLS/권한/RPC 회귀 테스트 (DB_CONVENTIONS 13.3, SECURITY_BASELINE 15장, 05_DATA_MODEL.md 7절)
-- 행위자: A(조직 oA owner, trial), M(oA member), V(oA viewer), B(조직 oB owner, trial + 업데이트 만료 영구 라이선스 = 폴백),
--         C(엔타이틀먼트 없음), anon, service
-- 형식: "-- TEST <이름> | expect=<rows:N | ok | sqlstate:CODE>" 머리 + 한 문장. "-- RUN" 은 기대값 없는 준비 문장.
-- =====================================================================

-- SETUP (관리 세션)
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@test.local', '{"signup_app": "arch", "full_name": "A"}'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@test.local', '{"signup_app": "arch", "full_name": "B"}'),
  ('cccccccc-0000-4000-8000-000000000003', 'c@test.local', '{"full_name": "C"}'),
  ('dddddddd-0000-4000-8000-000000000004', 'm@test.local', '{"signup_app": "arch", "full_name": "M"}'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'v@test.local', '{"signup_app": "arch", "full_name": "V"}');
-- C 는 엔타이틀먼트가 없어야 한다(모놀리스는 apps 1개면 자동 부여하므로 지운다)
delete from @C@.app_entitlements where org_id = (select id from @C@.organizations where owner_id = 'cccccccc-0000-4000-8000-000000000003');
create temp table t_ids as
  select (select id from @C@.organizations where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001') as oa,
         (select id from @C@.organizations where owner_id = 'bbbbbbbb-0000-4000-8000-000000000002') as ob,
         (select id from @C@.organizations where owner_id = 'cccccccc-0000-4000-8000-000000000003') as oc,
         '99999999-0000-4000-8000-000000000001'::uuid as proj;
grant select on t_ids to anon, authenticated, service_role;
insert into @C@.org_members (org_id, user_id, role, status, joined_at)
  select oa, 'dddddddd-0000-4000-8000-000000000004', 'member', 'active', now() from t_ids;
insert into @C@.org_members (org_id, user_id, role, status, joined_at)
  select oa, 'eeeeeeee-0000-4000-8000-000000000005', 'viewer', 'active', now() from t_ids;
-- 라이선스: oA 유효(오늘 + 1년), oB 업데이트 만료(폴백). 시리얼 원문 AAAAABBBBBCCCCCDDDDD / ZZZZZYYYYYXXXXXWWWWW
insert into @S@.licenses (id, org_id, sku_code, serial_hash, serial_last5, updates_until)
  select '10000000-0000-4000-8000-000000000001', oa, 'perpetual_early', encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), 'DDDDD',
         (current_date + interval '1 year')::date from t_ids;
insert into @S@.licenses (id, org_id, sku_code, serial_hash, serial_last5, updates_until)
  select '10000000-0000-4000-8000-000000000002', ob, 'perpetual_early', encode(extensions.digest('ZZZZZYYYYYXXXXXWWWWW', 'sha256'), 'hex'), 'WWWWW',
         '2025-01-01'::date from t_ids;
-- 규칙 팩 2개(2024 게시, 2026 게시), 빌드 1개(오늘 빌드)
insert into @S@.rule_packs (version, status, basis_date, storage_path, sha256, signature, kid, bytes, published_at) values
  ('2024.06.1', 'published', '2024-06-01', 'rule-packs/2024.06.1/pack.json', repeat('a', 64), repeat('s', 20), 'k1', 1000, '2024-06-01'),
  ('2026.10.1', 'published', '2026-10-01', 'rule-packs/2026.10.1/pack.json', repeat('b', 64), repeat('s', 20), 'k1', 1000, '2026-10-01');
insert into @S@.rule_pack_changes (rule_pack_id, title, kind, effective_from)
  select id, '정북 일조사선 개정', 'decree', '2026-09-01' from @S@.rule_packs where version = '2026.10.1';
insert into @S@.builds (version, platform, channel, status, build_date, storage_path, signature, sha256, bytes, published_at) values
  ('1.1.0', 'windows-x86_64', 'stable', 'published', current_date, 'builds/stable/1.1.0/arch-setup.exe', repeat('s', 20), repeat('c', 64), 1000, now());
-- END SETUP

-- AS anon
-- TEST anon 판매 중 라이선스 상품만 보임(perpetual_early) | expect=rows:1
select code from @S@.license_skus;
-- TEST anon 라이선스 테이블 접근 42501 | expect=sqlstate:42501
select 1 from @S@.licenses;
-- TEST anon org_features 호출 42501 | expect=sqlstate:42501
select @S@.org_features((select oa from t_ids));

-- AS service
-- TEST service 클라우드 사본 새로 저장(version 1) | expect=rows:1
select 1 from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1) s where s.version = 1;
-- TEST service 오래된 expected_version 으로 저장 AR041(저장 안 됨) | expect=sqlstate:AR041
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service AR041 뒤에도 version 1 유지 | expect=rows:1
select 1 from @S@.cloud_projects where project_uuid = (select proj from t_ids) and version = 1;
-- TEST service 현재 버전으로 저장(version 2) | expect=rows:1
select 1 from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 1, 1000, 1) s where s.version = 2;
-- TEST service 없는 사본에 expected_version 1 AR041 | expect=sqlstate:AR041
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 1, 1000, 1);
-- TEST service 두 번째 사본 + local_id | expect=rows:1
select 1 from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000002'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000002'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1, '88888888-0000-4000-8000-000000000001'::uuid) s where s.version = 1;
-- TEST service 같은 local_id 다른 project_uuid 23505 | expect=sqlstate:23505
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000003'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1, '88888888-0000-4000-8000-000000000001'::uuid);
-- TEST service 세 번째 사본(상한 3 도달) | expect=rows:1
select 1 from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000003'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1) s where s.version = 1;
-- TEST service 상한 초과 AR040 | expect=sqlstate:AR040
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service local_id null → 값 설정 허용 | expect=rows:1
select 1 from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 2, 1000, 1, '88888888-0000-4000-8000-000000000002'::uuid) s where s.version = 3;
-- TEST service local_id 다른 값으로 변경 22023 | expect=sqlstate:22023
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 3, 1000, 1, '88888888-0000-4000-8000-000000000003'::uuid);
-- TEST service viewer 저장 42501 | expect=sqlstate:42501
select * from @S@.save_cloud_project((select oa from t_ids), 'eeeeeeee-0000-4000-8000-000000000005', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service 다른 조직 사용자가 oA 저장 42501 | expect=sqlstate:42501
select * from @S@.save_cloud_project((select oa from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service 엔타이틀먼트 없는 조직 저장 42501 | expect=sqlstate:42501
select * from @S@.save_cloud_project((select oc from t_ids), 'cccccccc-0000-4000-8000-000000000003', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oc from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service 다른 프로젝트 폴더 경로 23514 | expect=sqlstate:23514
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000002'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service 다른 조직 경로 23514 | expect=sqlstate:23514
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select ob from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service 경로 조작(..) 23514 | expect=sqlstate:23514
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/../../' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST service blob_bytes 0 → 22023 | expect=sqlstate:22023
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000004'::uuid, '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || '99999999-0000-4000-8000-000000000004'::uuid::text || '/' || gen_random_uuid()::text || '.arch', 0, 0, 1);
-- TEST service 삭제: 오래된 expected_version AR041 | expect=sqlstate:AR041
select * from @S@.delete_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003'::uuid, 9);
-- TEST service 삭제: 다른 조직 사용자는 P0002(존재 은닉) | expect=sqlstate:P0002
select * from @S@.delete_cloud_project((select ob from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', '99999999-0000-4000-8000-000000000003'::uuid);
-- TEST service 삭제: viewer 42501 | expect=sqlstate:42501
select * from @S@.delete_cloud_project((select oa from t_ids), 'eeeeeeee-0000-4000-8000-000000000005', '99999999-0000-4000-8000-000000000003'::uuid);
-- TEST service 삭제 성공(경로 반환) | expect=rows:1
select 1 from @S@.delete_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003'::uuid, 1) d where d.storage_path is not null;
-- TEST service 같은 사본 다시 삭제 P0002 | expect=sqlstate:P0002
select * from @S@.delete_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000003'::uuid);
-- TEST service 삭제 뒤 같은 조직 사본 2건 | expect=rows:2
select 1 from @S@.cloud_projects where org_id = (select oa from t_ids);
-- TEST service 삭제 감사 로그 남음 | expect=rows:1
select 1 from @C@.audit_log where action = 'cloud_project.delete' limit 1;

-- AS A
-- TEST A 자기 조직 라이선스 1행 | expect=rows:1
select id, serial_last5 from @S@.licenses where org_id = (select oa from t_ids);
-- TEST A 시리얼 해시 컬럼 조회 42501 | expect=sqlstate:42501
select serial_hash from @S@.licenses;
-- TEST A 라이선스 상태 직접 변경 42501 | expect=sqlstate:42501
update @S@.licenses set status = 'active', updates_until = '2099-01-01' where org_id = (select oa from t_ids);
-- TEST A 기기 활성화 직접 삽입 42501 | expect=sqlstate:42501
insert into @S@.license_activations (org_id, license_id, source, device_hash) select oa, '10000000-0000-4000-8000-000000000001', 'license', repeat('9', 64) from t_ids;
-- TEST A 자기 플랜 변경 42501 | expect=sqlstate:42501
update @C@.app_entitlements set plan_id = (select id from @C@.plans where app_id = 'arch' and code = 'sub_monthly') where org_id = (select oa from t_ids);
-- TEST A 자기 지갑 변경 42501 | expect=sqlstate:42501
update @C@.wallets set pack_balance = 99999 where org_id = (select oa from t_ids);
-- TEST A consume_credits 호출 42501 | expect=sqlstate:42501
select * from @C@.consume_credits((select oa from t_ids), 1, 'arch', 'x');
-- TEST A start_ai_run 호출 42501(service 전용) | expect=sqlstate:42501
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'intake', 'intake_text', gen_random_uuid(), (select proj from t_ids), '{"text":"x"}');
-- TEST A activate_license 호출 42501 | expect=sqlstate:42501
select @S@.activate_license(repeat('a', 64), repeat('1', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST A activate_plan_device 호출 42501 | expect=sqlstate:42501
select @S@.activate_plan_device((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', repeat('1', 64));
-- TEST A issue_license 호출 42501 | expect=sqlstate:42501
select * from @S@.issue_license(gen_random_uuid());
-- TEST A extend_updates 호출 42501 | expect=sqlstate:42501
select * from @S@.extend_updates(gen_random_uuid());
-- TEST A finish_ai_run 호출 42501 | expect=sqlstate:42501
select @S@.finish_ai_run(gen_random_uuid(), '{}');
-- TEST A fail_ai_run 호출 42501 | expect=sqlstate:42501
select @S@.fail_ai_run(gen_random_uuid(), 'x');
-- TEST A record_site_lookup 호출 42501 | expect=sqlstate:42501
select @S@.record_site_lookup((select oa from t_ids), repeat('a', 64));
-- TEST A eligible_build 호출 42501 | expect=sqlstate:42501
select @S@.eligible_build((select oa from t_ids), 'windows-x86_64', '1.0.0');
-- TEST A 운영 상수 읽기 42501 | expect=sqlstate:42501
select * from @S@.runtime_config;
-- TEST A 단가표 테이블 직접 읽기 42501(RPC 로만) | expect=sqlstate:42501
select * from @S@.cost_catalogs;
-- TEST A 자기 조직 기능 = 영구 유효(licensed) | expect=rows:1
select 1 where @S@.org_features((select oa from t_ids)) ->> 'state' = 'licensed';
-- TEST A 다른 조직 기능 조회 42501 | expect=sqlstate:42501
select @S@.org_features((select ob from t_ids));
-- TEST A 규칙 팩 자격(업데이트 유효: 2개) | expect=rows:2
select * from @S@.eligible_rule_packs();
-- TEST A 규칙 팩 저장 경로 컬럼 42501 | expect=sqlstate:42501
select storage_path from @S@.rule_packs;
-- TEST A 개정 제목 보임 | expect=rows:1
select title from @S@.rule_pack_changes;
-- TEST A 표제란 저장 | expect=ok
select @S@.upsert_drafting_profile('{"office_name": "노마드 건축", "architect_name": "김건축", "layer_map": {"A-WALL": "WALL", "A-DOOR": "DOOR"}, "default_paper": "A2"}');
-- TEST A 표제란에 건축주 이름 키 22023 | expect=sqlstate:22023
select @S@.upsert_drafting_profile('{"client_name": "홍길동"}');
-- TEST A 표준 밖 레이어 키 22023 | expect=sqlstate:22023
select @S@.upsert_drafting_profile('{"layer_map": {"MY-LAYER": "X"}}');
-- TEST A 다른 조직 로고 경로 23514 | expect=sqlstate:23514
select @S@.upsert_drafting_profile(jsonb_build_object('logo_storage_path', (select ob from t_ids)::text || '/arch/drafting-logo/' || gen_random_uuid()::text || '.png'));
-- TEST A 부분 수정은 다른 값 유지(용지 A2) | expect=rows:1
select 1 from @S@.upsert_drafting_profile('{"font_family": "Noto Sans KR"}') d where d.default_paper = 'A2' and d.office_name = '노마드 건축';
-- TEST A 표제란 직접 UPDATE 42501 | expect=sqlstate:42501
update @S@.drafting_profiles set office_name = 'x';
-- TEST A 클라우드 사본 저장 RPC 직접 호출 42501(service_role 전용) | expect=sqlstate:42501
select * from @S@.save_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids), '1호', (select oa from t_ids)::text || '/arch/project_snapshot/' || (select proj from t_ids)::text || '/' || gen_random_uuid()::text || '.arch', 2, 1000, 1);
-- TEST A 클라우드 사본 삭제 RPC 직접 호출 42501(service_role 전용) | expect=sqlstate:42501
select * from @S@.delete_cloud_project((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', (select proj from t_ids));
-- TEST A 클라우드 사본 직접 DELETE 42501 | expect=sqlstate:42501
delete from @S@.cloud_projects;
-- TEST A 클라우드 사본 version 직접 변경 42501 | expect=sqlstate:42501
update @S@.cloud_projects set version = 1;

-- AS M
-- TEST M(member) oA 표제란 저장 AR042 | expect=sqlstate:AR042
select @S@.upsert_drafting_profile('{"office_name": "x"}', (select oa from t_ids));
-- TEST M oA 표제란 읽기 | expect=rows:1
select office_name from @S@.drafting_profiles where org_id = (select oa from t_ids);
-- TEST M 비멤버 조직 지정 42501(caller_org) | expect=sqlstate:42501
select @S@.upsert_drafting_profile('{"office_name": "x"}', (select ob from t_ids));

-- AS V
-- TEST V(viewer) 클라우드 사본 저장 RPC 직접 호출 42501 | expect=sqlstate:42501
select * from @S@.save_cloud_project((select oa from t_ids), 'eeeeeeee-0000-4000-8000-000000000005', gen_random_uuid(), 'v', (select oa from t_ids)::text || '/arch/project_snapshot/' || gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.arch', 0, 1000, 1);
-- TEST V 사본 목록은 읽기(서비스 블록이 만든 2건) | expect=rows:2
select id from @S@.cloud_projects;

-- AS B
-- TEST B 다른 조직 라이선스 안 보임 | expect=rows:0
select 1 from @S@.licenses where org_id = (select oa from t_ids);
-- TEST B 다른 조직 표제란 안 보임 | expect=rows:0
select 1 from @S@.drafting_profiles where org_id = (select oa from t_ids);
-- TEST B 다른 조직 사본 안 보임 | expect=rows:0
select 1 from @S@.cloud_projects where org_id = (select oa from t_ids);
-- TEST B 상태 = 폴백(licensed_fallback) | expect=rows:1
select 1 where @S@.org_features((select ob from t_ids)) ->> 'state' = 'licensed_fallback';
-- TEST B 폴백 기능: cloud_review false, drafting_watermark false | expect=rows:1
select 1 where (@S@.org_features((select ob from t_ids)) ->> 'cloud_review')::boolean = false and (@S@.org_features((select ob from t_ids)) ->> 'drafting_watermark')::boolean = false;
-- TEST B 폴백 규칙 팩은 updates_until 이전 게시분만(1개) | expect=rows:1
select * from @S@.eligible_rule_packs();
-- TEST B 다른 조직을 지정한 규칙 팩 조회 42501 | expect=sqlstate:42501
select * from @S@.eligible_rule_packs((select oa from t_ids));

-- AS C
-- TEST C 엔타이틀먼트 없는 조직 상태 = trial_expired | expect=rows:1
select 1 where @S@.org_features((select oc from t_ids)) ->> 'state' = 'trial_expired';
-- TEST C 규칙 팩 0개 | expect=rows:0
select * from @S@.eligible_rule_packs();
-- TEST C 비멤버 조직 사본 안 보임 | expect=rows:0
select 1 from @S@.cloud_projects;

-- AS service
-- TEST service FOR ALL 정책 0(명령별 정책만) | expect=rows:0
select 1 from pg_catalog.pg_policies where schemaname in ('@S@', '@C@') and cmd = 'ALL';
-- TEST service RLS 꺼진 테이블 0 | expect=rows:0
select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('@S@', '@C@') and c.relkind = 'r' and not c.relrowsecurity;
-- TEST service 영구 라이선스 활성화 기기 1 | expect=ok
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('1', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 같은 기기 재활성화는 같은 행(활성 1) | expect=rows:1
select 1 from @S@.license_activations where device_hash = repeat('1', 64) and deactivated_at is null
  and @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('1', 64), 'dddddddd-0000-4000-8000-000000000004') is not null;
-- TEST service 기기 2 활성화 | expect=ok
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('2', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 기기 3 활성화 AR001(PC 2대) | expect=sqlstate:AR001
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('3', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 다른 조직 사용자가 oA 시리얼 활성화 AR006 | expect=sqlstate:AR006
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('4', 64), 'bbbbbbbb-0000-4000-8000-000000000002');
-- TEST service viewer 의 활성화 AR006(member+ 만) | expect=sqlstate:AR006
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('4', 64), 'eeeeeeee-0000-4000-8000-000000000005');
-- TEST service 없는 시리얼 AR002 | expect=sqlstate:AR002
select @S@.activate_license(repeat('0', 64), repeat('1', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 해시 형식 아님 22023 | expect=sqlstate:22023
select @S@.activate_license('ARCH-AAAAA', repeat('1', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- RUN
update @S@.license_activations set device_label = 'd' || left(device_hash, 1) where deactivated_at is null;
-- TEST service 체험·구독 기기 활성화(oB 는 폴백이라 AR003) | expect=sqlstate:AR003
select @S@.activate_plan_device((select ob from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', repeat('5', 64));
-- TEST service 결제 종류 C-1 전 issue_license 거부 22023 | expect=sqlstate:22023
with o as (insert into @C@.payment_orders (order_id, org_id, app_id, kind, credit_pack_id, credits, amount_krw, status, metadata)
           select 'arch-test-order-1', oa, 'arch', 'credit_pack', (select id from @C@.credit_packs where app_id = 'arch' and code = 'pack_100'), 100, 10000, 'confirmed',
                  '{"license_sku": "perpetual_early"}' from t_ids returning id)
select * from @S@.issue_license((select id from o));
-- TEST service 대지 조회 10회(체험 상한 아님: oA 는 영구 유효 30회) | expect=ok
select @S@.record_site_lookup((select oa from t_ids), encode(extensions.digest('pnu' || g::text, 'sha256'), 'hex')) from generate_series(1, 30) g;
-- TEST service 31번째 지번 AR020 | expect=sqlstate:AR020
select @S@.record_site_lookup((select oa from t_ids), encode(extensions.digest('pnu31', 'sha256'), 'hex'));
-- TEST service 같은 날 같은 지번 재조회는 세지 않음 | expect=ok
select @S@.record_site_lookup((select oa from t_ids), encode(extensions.digest('pnu1', 'sha256'), 'hex'));
-- TEST service 빌드 자격(oA 업데이트 유효) | expect=rows:1
select 1 where (@S@.eligible_build((select oa from t_ids), 'windows-x86_64', '1.0.0')).id is not null;
-- TEST service 빌드 자격(oB 폴백: 오늘 빌드는 updates_until 밖) | expect=rows:0
select 1 where (@S@.eligible_build((select ob from t_ids), 'windows-x86_64', '1.0.0')).id is not null;
-- TEST service 빌드 플랫폼 형식 22023 | expect=sqlstate:22023
select @S@.eligible_build((select oa from t_ids), 'linux', '1.0.0');
-- TEST service 렌더 시작 r1(3크레딧) | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'render_std', '20000000-0000-4000-8000-000000000001', (select proj from t_ids),
  jsonb_build_object('inputs', jsonb_build_object('depth_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png',
                                                  'edge_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png'))) r where r.credits = 3;
-- TEST service 같은 request_id 재호출은 차감 없이 같은 실행 | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'render_std', '20000000-0000-4000-8000-000000000001', (select proj from t_ids), '{}') r
 where r.run_id = (select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000001');
-- TEST service 차감 원장 멱등 키 consume:arch:<request_id> 1행 | expect=rows:1
select 1 from @C@.credit_ledger where idempotency_key = 'consume:arch:20000000-0000-4000-8000-000000000001';
-- TEST service 지갑 30 - 3 = 27 | expect=rows:1
select 1 from @C@.wallets where org_id = (select oa from t_ids) and plan_balance + pack_balance = 27;
-- TEST service 다른 조직 입력 경로 23514 | expect=sqlstate:23514
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'render_std', gen_random_uuid(), (select proj from t_ids),
  jsonb_build_object('inputs', jsonb_build_object('depth_path', (select ob from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png',
                                                  'edge_path', (select ob from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png')));
-- TEST service 같은 request_id 를 다른 조직으로 42501 | expect=sqlstate:42501
select * from @S@.start_ai_run((select ob from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', 'render', 'render_std', '20000000-0000-4000-8000-000000000001', (select proj from t_ids), '{}');
-- TEST service 비멤버 행위자 42501 | expect=sqlstate:42501
select * from @S@.start_ai_run((select oa from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', 'intake', 'intake_text', gen_random_uuid(), (select proj from t_ids), '{"text": "x"}');
-- TEST service 잘못된 kind/variant 조합 22023 | expect=sqlstate:22023
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'review', gen_random_uuid(), (select proj from t_ids), '{}');
-- RUN
select @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'render_std', ('20000000-0000-4000-8000-00000000000' || g::text)::uuid, (select proj from t_ids),
  jsonb_build_object('inputs', jsonb_build_object('depth_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png',
                                                  'edge_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png')))
from generate_series(2, 3) g;
-- TEST service 렌더 동시 4건째 AR030 | expect=sqlstate:AR030
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'render_std', gen_random_uuid(), (select proj from t_ids),
  jsonb_build_object('inputs', jsonb_build_object('depth_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png',
                                                  'edge_path', (select oa from t_ids)::text || '/arch/render_input/' || gen_random_uuid()::text || '.png')));
-- TEST service r2 실패 → 환불 → refunded | expect=rows:1
select 1 from @S@.fail_ai_run((select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000002'), 'provider error') f where f ->> 'status' = 'refunded';
-- TEST service 환불 후 지갑 30 - 9 + 3 = 24 | expect=rows:1
select 1 from @C@.wallets where org_id = (select oa from t_ids) and plan_balance + pack_balance = 24;
-- TEST service 같은 실행 다시 실패 처리해도 이중 환불 없음 22023 | expect=sqlstate:22023
select @S@.fail_ai_run((select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000002'), 'again');
-- TEST service 렌더 결과를 다른 조직 폴더로 23514 | expect=sqlstate:23514
select @S@.finish_ai_run((select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object('output_path', (select ob from t_ids)::text || '/arch/render/' || gen_random_uuid()::text || '.png', 'ai_label', true));
-- TEST service 렌더 결과 저장 succeeded | expect=ok
select @S@.finish_ai_run((select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000001'),
  jsonb_build_object('output_path', (select oa from t_ids)::text || '/arch/render/' || gen_random_uuid()::text || '.png', 'ai_label', true, 'width', 1024, 'height', 768, 'bytes', 1000, 'provider', 'fal', 'model', 'flux', 'seed', 7));
-- TEST service 결과 저장 뒤 잡 환불 표시 해제 | expect=rows:1
select 1 from @C@.jobs j join @S@.renders r on r.job_id = j.id where r.request_id = '20000000-0000-4000-8000-000000000001' and j.refund_on_failure = false;
-- TEST service 성공 렌더 상태 되돌리기 22023(전이 트리거) | expect=sqlstate:22023
update @S@.renders set status = 'queued' where request_id = '20000000-0000-4000-8000-000000000001';
-- TEST service 차감액 변경 22023(불변) | expect=sqlstate:22023
update @S@.renders set credits = 0 where request_id = '20000000-0000-4000-8000-000000000003';
-- TEST service 업스케일(영구 유효 render_max_px 4096) | expect=ok
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'render', 'upscale', gen_random_uuid(), (select proj from t_ids),
  jsonb_build_object('inputs', jsonb_build_object('source_render_id', (select id from @S@.renders where request_id = '20000000-0000-4000-8000-000000000001'))));
-- TEST service 폴백 조직 클라우드 검토 AR012 | expect=sqlstate:AR012
select * from @S@.start_ai_run((select ob from t_ids), 'bbbbbbbb-0000-4000-8000-000000000002', 'review', 'review', gen_random_uuid(), (select proj from t_ids),
  '{"judgment": {}, "rule_pack_version": "2026.10.1", "application_date": "2026-11-01", "municipality_code": "41463"}');
-- RUN
select @C@.consume_credits((select oa from t_ids), (select plan_balance + pack_balance - 5 from @C@.wallets where org_id = (select oa from t_ids)), 'arch', 'test:drain');
-- TEST service 크레딧 부족 CR001(검토 15 > 잔액 5) | expect=sqlstate:CR001
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'review', 'review', gen_random_uuid(), (select proj from t_ids),
  '{"judgment": {}, "rule_pack_version": "2026.10.1", "application_date": "2026-11-01", "municipality_code": "41463"}');
-- RUN
select @C@.grant_credits((select oa from t_ids), 100, 'arch', 'test', 'pack', null, null, 'test:grant:oa');
-- TEST service 검토 시작(15) | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'review', 'review', '30000000-0000-4000-8000-000000000001', (select proj from t_ids),
  '{"judgment": {"items": []}, "rule_pack_version": "2026.10.1", "application_date": "2026-11-01", "municipality_code": "41463"}') r where r.credits = 15;
-- TEST service 출처 없는 문장 결과 AR033 | expect=sqlstate:AR033
select @S@.finish_ai_run((select id from @S@.reviews where request_id = '30000000-0000-4000-8000-000000000001'),
  '{"schema_version": "review.v1", "items": [{"key": "far", "verdict": "PASS", "sentences": [{"text": "용적률은 여유가 있습니다", "source_ids": []}]}], "needs_check": [], "sources": []}');
-- TEST service 출처 있는 결과 저장 | expect=ok
select @S@.finish_ai_run((select id from @S@.reviews where request_id = '30000000-0000-4000-8000-000000000001'),
  '{"schema_version": "review.v1", "items": [{"key": "far", "verdict": "PASS", "sentences": [{"text": "용적률 기준 조항", "source_ids": ["s1"]}]}], "needs_check": [], "sources": [{"id": "s1"}], "disclaimer_version": "d1"}');
-- TEST service intake 시작(텍스트 2) | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'intake', 'intake_text', '40000000-0000-4000-8000-000000000001', (select proj from t_ids),
  '{"text": "방 3개, 거실은 넓게, 예산 5억"}') r where r.credits = 2;
-- TEST service 상담 녹음 intake 는 STT 잡·고지 버전 필요(23514 CHECK) | expect=sqlstate:23514
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'intake', 'intake_consult', gen_random_uuid(), (select proj from t_ids), '{"text": "x"}');
-- TEST service intake 결과에 좌표 키 AR032 | expect=sqlstate:AR032
select @S@.finish_ai_run((select id from @S@.intake_runs where request_id = '40000000-0000-4000-8000-000000000001'),
  '{"schema_version": "intake.v1", "checklist_answers": [], "rooms": [{"name": "거실", "use": "living", "count": 1, "target_area_m2": null, "area_evidence": null, "polygon": [[0,0]]}], "memo": []}');
-- TEST service intake 결과 저장 | expect=ok
select @S@.finish_ai_run((select id from @S@.intake_runs where request_id = '40000000-0000-4000-8000-000000000001'),
  '{"schema_version": "intake.v1", "checklist_answers": [], "rooms": [{"name": "거실", "use": "living", "count": 1, "target_area_m2": null, "area_evidence": null}], "memo": []}');
-- TEST service 템플릿 문서 PDF 시작(1) | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'proposal', 'doc_template', '50000000-0000-4000-8000-000000000001', (select proj from t_ids),
  jsonb_build_object('doc_kind', 'area_table', 'template_version', 'tpl-1', 'content_sha256', repeat('d', 64),
                     'content_path', (select oa from t_ids)::text || '/arch/proposal_content/' || gen_random_uuid()::text || '.json')) r where r.credits = 1;
-- TEST service PDF 결과 저장 | expect=ok
select @S@.finish_ai_run((select id from @S@.proposals where request_id = '50000000-0000-4000-8000-000000000001'),
  jsonb_build_object('pdf_path', (select oa from t_ids)::text || '/arch/pdf/' || gen_random_uuid()::text || '.pdf', 'pages', 2, 'bytes', 1000));
-- TEST service 같은 내용·버전 재요청 0크레딧 | expect=rows:1
select 1 from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'proposal', 'doc_template', gen_random_uuid(), (select proj from t_ids),
  jsonb_build_object('doc_kind', 'area_table', 'template_version', 'tpl-1', 'content_sha256', repeat('d', 64),
                     'content_path', (select oa from t_ids)::text || '/arch/proposal_content/' || gen_random_uuid()::text || '.json')) r where r.credits = 0;
-- TEST service 제안서 시트 경로가 다른 목적 폴더 23514 | expect=sqlstate:23514
select * from @S@.start_ai_run((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', 'proposal', 'proposal', gen_random_uuid(), (select proj from t_ids),
  jsonb_build_object('doc_kind', 'proposal', 'template_version', 'tpl-1', 'content_sha256', repeat('e', 64),
                     'content_path', (select oa from t_ids)::text || '/arch/proposal_content/' || gen_random_uuid()::text || '.json',
                     'drawing_sheets', jsonb_build_array((select oa from t_ids)::text || '/arch/project_snapshot/' || gen_random_uuid()::text || '.svg')));
-- TEST service 연간 업데이트 결제 → updates_until +1년 | expect=rows:1
with o as (insert into @C@.payment_orders (order_id, org_id, app_id, kind, plan_id, amount_krw, status)
           select 'arch-test-order-2', ob, 'arch', 'subscription', (select id from @C@.plans where app_id = 'arch' and code = 'updates_yearly'), 290000, 'confirmed' from t_ids returning id)
select 1 from @S@.extend_updates((select id from o)) l where l.updates_until > current_date;
-- TEST service 같은 주문 재처리는 다시 늘리지 않음 | expect=rows:1
select 1 from @S@.extend_updates((select id from @C@.payment_orders where order_id = 'arch-test-order-2')) l
 where l.updates_until < (current_date + interval '1 year 1 day')::date;
-- TEST service 연장 뒤 oB 상태 licensed | expect=rows:1
select 1 where @S@.org_features((select ob from t_ids)) ->> 'state' = 'licensed';

-- AS M
-- TEST M(member) 기기 해제 42501 | expect=sqlstate:42501
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd1'));

-- AS B
-- TEST B(outsider) 다른 조직 렌더 안 보임 | expect=rows:0
select 1 from @S@.renders where org_id = (select oa from t_ids);
-- TEST B(outsider) 다른 조직 기기 활성화 안 보임 | expect=rows:0
select 1 from @S@.license_activations where org_id = (select oa from t_ids);
-- TEST B 다른 조직 기기 해제 P0002 | expect=sqlstate:P0002
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd1'));

-- AS A
-- TEST A 셀프 해제 1 | expect=ok
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd1'));
-- AS service
-- RUN
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('3', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- RUN
update @S@.license_activations set device_label = 'd3' where device_hash = repeat('3', 64) and deactivated_at is null;
-- AS A
-- TEST A 셀프 해제 2 | expect=ok
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd2'));
-- AS service
-- RUN
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('4', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- RUN
update @S@.license_activations set device_label = 'd4' where device_hash = repeat('4', 64) and deactivated_at is null;
-- AS A
-- TEST A 셀프 해제 3 | expect=ok
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd3'));
-- TEST A 셀프 해제 4번째 AR004(30일 3회) | expect=sqlstate:AR004
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd4'));
-- TEST A 해제된 기기 다시 해제는 그대로 반환 | expect=ok
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd1'));

-- AS service
-- TEST service 고객지원 해제는 한도와 무관 | expect=ok
select @S@.deactivate_activation((select id from @S@.license_activations where device_label = 'd4'));
-- TEST service 해제된 기기 되살리기 22023 | expect=sqlstate:22023
update @S@.license_activations set deactivated_at = null, deactivation_kind = null where device_label = 'd1';
-- RUN
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('6', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 라이선스 환불 | expect=ok
update @S@.licenses set status = 'refunded' where id = '10000000-0000-4000-8000-000000000001';
-- TEST service 환불 뒤 활성 기기 0 | expect=rows:0
select 1 from @S@.license_activations where license_id = '10000000-0000-4000-8000-000000000001' and deactivated_at is null;
-- TEST service 환불 라이선스 활성화 AR003 | expect=sqlstate:AR003
select @S@.activate_license(encode(extensions.digest('AAAAABBBBBCCCCCDDDDD', 'sha256'), 'hex'), repeat('7', 64), 'aaaaaaaa-0000-4000-8000-000000000001');
-- TEST service 환불 → active 되돌리기 22023 | expect=sqlstate:22023
update @S@.licenses set status = 'active' where id = '10000000-0000-4000-8000-000000000001';
-- TEST service 시리얼 해시 변경 22023(불변) | expect=sqlstate:22023
update @S@.licenses set serial_hash = repeat('f', 64) where id = '10000000-0000-4000-8000-000000000002';
-- TEST service 환불 뒤 oA 는 체험 상태로 내려감 | expect=rows:1
select 1 where @S@.org_features((select oa from t_ids)) ->> 'state' = 'trial';
-- TEST service 체험 기기 활성화 1대 | expect=ok
select @S@.activate_plan_device((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', repeat('8', 64));
-- TEST service 체험 기기 2대째 AR001 | expect=sqlstate:AR001
select @S@.activate_plan_device((select oa from t_ids), 'aaaaaaaa-0000-4000-8000-000000000001', repeat('9', 64));
-- TEST service 플랜 기기 행은 license_id null + source plan | expect=rows:1
select 1 from @S@.license_activations where source = 'plan' and license_id is null and deactivated_at is null;
-- TEST service 게시된 규칙 팩 내용 해시 변경 22023 | expect=sqlstate:22023
update @S@.rule_packs set sha256 = repeat('f', 64) where version = '2026.10.1';
-- TEST service 규칙 팩 회수 | expect=ok
update @S@.rule_packs set status = 'withdrawn', withdrawn_at = now() where version = '2026.10.1';
-- TEST service 회수 팩 → published 되돌리기 22023 | expect=sqlstate:22023
update @S@.rule_packs set status = 'published' where version = '2026.10.1';
-- TEST service 보존 정리 실행 | expect=ok
select * from @S@.purge_expired();
