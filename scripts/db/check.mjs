#!/usr/bin/env node
// 로컬 Supabase DB 자체 검사(모놀리스). 새 npm 의존성 없이 로컬 DB 컨테이너의 psql 로 접속한다(원격 DB 접속 없음).
//
// 사용: node scripts/db/check.mjs              (선행: npx supabase@2.122.0 start, db reset)
//       node scripts/db/check.mjs --container <이름>   기본: supabase_db_<config.toml project_id>
//
// 검사:
//  1. arch 테이블 15개(0002 9절 DO 블록 목록) 모두 relrowsecurity = true.
//  2. arch 함수(0002 10절 v_names 목록) 이름마다 public 에 1개 이상 있고, 그중 SECURITY DEFINER 는 proconfig 에 search_path="".
//  3. 동시 렌더(연결 2개): 같은 조직, 서로 다른 request_id. 활성 렌더 2건을 먼저 만든 뒤
//     연결 A 가 3번째를 시작하고 커밋 전에 잠금을 쥔 채 기다리는 동안 연결 B 가 4번째를 시작한다.
//     A 의 조직 잠금 보유와 B 의 대기는 pg_locks(application_name·2401 잠금 키)로 확인한다(폴링, 타임아웃 10초).
//     B 는 A 커밋 뒤 AR030 으로 거부돼야 한다. 결과 활성 렌더 = 한도(3).
//     테스트 데이터(사용자·조직·렌더)는 실행마다 새 사용자로 만들고 지우지 않는다(로컬 db reset 으로 초기화).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = resolve(ROOT, 'supabase/migrations/20261013000002_arch_domain.sql');

function containerName() {
  const i = process.argv.indexOf('--container');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const m = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('supabase/config.toml 에 project_id 가 없다');
  return `supabase_db_${m[1]}`;
}

const CONTAINER = containerName();
const PSQL = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t',
  '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-f', '-'];

function psql(sql) {
  const r = spawnSync('docker', PSQL, { input: sql, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

function psqlOk(sql) {
  const r = psql(sql);
  if (r.code !== 0) throw new Error(`psql 실패(${r.code}): ${r.err}`);
  return r.out;
}

function psqlAsync(sql) {
  return new Promise((done, fail) => {
    const p = spawn('docker', PSQL);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', fail);
    p.on('close', (code) => done({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 조건이 참이 될 때까지 100ms 간격으로 확인, timeoutMs 를 넘으면 false
async function poll(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(100);
  }
  return false;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// 0002 본문에서 목록을 읽는다(정본 한 곳)
function listFromMigration(re, what) {
  const m = readFileSync(MIGRATION, 'utf8').match(re);
  if (!m) throw new Error(`0002 에서 ${what} 목록을 못 찾았다`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

const results = [];
function report(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function checkRls() {
  const tables = listFromMigration(/foreach t in array array\[([^\]]+)\]\s*loop\s*execute format\('alter table %I\.%I enable row level security'/, 'RLS 테이블');
  const rows = psqlOk(`select c.relname || '|' || c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any (array[${tables.map(lit).join(', ')}]::text[]) order by 1;`)
    .split('\n').filter(Boolean).map((l) => l.split('|'));
  const off = rows.filter(([, rls]) => rls !== 'true').map(([n]) => n);
  const missing = tables.filter((t) => !rows.some(([n]) => n === t));
  report(`arch 테이블 RLS (${tables.length}개)`, tables.length === 15 && !off.length && !missing.length,
    `켜짐 ${rows.length - off.length}/${tables.length}${off.length ? `, 꺼짐: ${off.join(',')}` : ''}${missing.length ? `, 없음: ${missing.join(',')}` : ''}`);
}

function checkDefiner() {
  const names = listFromMigration(/v_names\s+constant text\[\] := array\[([^\]]+)\]/, '함수');
  const rows = psqlOk(`select p.proname || '|' || p.prosecdef || '|' || coalesce('search_path=""' = any (p.proconfig), false)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[${names.map(lit).join(', ')}]::text[]) order by 1;`)
    .split('\n').filter(Boolean).map((l) => l.split('|'));
  const missing = names.filter((f) => !rows.some(([n]) => n === f));
  const definer = rows.filter(([, d]) => d === 'true');
  const bad = definer.filter(([, , sp]) => sp !== 'true').map(([n]) => n);
  report('arch DEFINER 함수 search_path=""', !missing.length && !bad.length && definer.length > 0,
    `DEFINER ${definer.length}개 중 위반 ${bad.length}${bad.length ? `: ${bad.join(',')}` : ''}${missing.length ? `, 없음: ${missing.join(',')}` : ''}`);
}

async function checkConcurrentRender() {
  const uid = randomUUID();
  const org = psqlOk(`insert into auth.users (id, email, raw_user_meta_data)
      values (${lit(uid)}, ${lit(`check-${uid}@test.local`)}, '{"signup_app": "arch", "full_name": "check"}');
    select id from public.organizations where owner_id = ${lit(uid)};`);
  if (!/^[0-9a-f-]{36}$/.test(org)) throw new Error(`테스트 조직 생성 실패: ${org}`);
  const limit = Number(psqlOk(`select public.config_int('render_max_active_per_org', 3);`));
  const proj = randomUUID();
  const start = (req) => {
    const p = (ext) => `${org}/arch/render_input/${randomUUID()}.${ext}`;
    const opt = JSON.stringify({ inputs: { depth_path: p('png'), edge_path: p('png') } });
    return `select run_id from public.start_ai_run(${lit(org)}, ${lit(uid)}, 'render', 'render_std', ${lit(req)}, ${lit(proj)}, ${lit(opt)}::jsonb);`;
  };
  for (let i = 0; i < limit - 1; i++) psqlOk(start(randomUUID()));

  // 세션 구분은 application_name(실행마다 고유). A 는 커밋 전에 go 신호 세션이 보일 때까지(최대 HOLD_S 초) 잠금을 쥔다.
  const tag = `archcheck-${uid.slice(0, 8)}`;
  const HOLD_S = 20;
  const a = psqlAsync(`set application_name = ${lit(`${tag}-a`)};\nbegin;\n${start(randomUUID())}
do $$ declare t0 timestamptz := clock_timestamp(); begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (select 1 from pg_stat_activity where application_name = ${lit(`${tag}-go`)})
           or clock_timestamp() > t0 + interval '${HOLD_S} seconds';
    perform pg_sleep(0.05);
  end loop;
end $$;\ncommit;\n`);
  // 2401 의 조직 잠금 키(2-key: classid = hashtext('arch:render_active'), objid = hashtext(org), objsubid = 2)를 쥔 세션 수
  const lockCount = (app, granted) => Number(psqlOk(`select count(*) from pg_locks l join pg_stat_activity s on s.pid = l.pid
    where s.application_name = ${lit(app)} and l.locktype = 'advisory' and l.objsubid = 2
      and l.classid = hashtext('arch:render_active')::oid and l.objid = hashtext(${lit(org)})::oid and l.granted = ${granted};`));
  const aHolds = await poll(() => lockCount(`${tag}-a`, true) === 1, 10000);
  let bWaits = false;
  let b = Promise.resolve({ code: -1, out: '', err: 'B 시작 안 함(A 가 잠금을 잡지 못함)' });
  if (aHolds) {
    b = psqlAsync(`set application_name = ${lit(`${tag}-b`)};\n${start(randomUUID())}\n`);
    bWaits = await poll(() => lockCount(`${tag}-b`, false) === 1, 10000);
  }
  // go 신호: A 가 볼 때까지 세션을 잠시 유지한다(A 는 0.05초 간격으로 확인)
  const go = psqlAsync(`set application_name = ${lit(`${tag}-go`)};\nselect pg_sleep(2);\n`);
  const [ra, rb] = await Promise.all([a, b, go]);
  const active = Number(psqlOk(`select count(*) from public.renders where org_id = ${lit(org)} and status in ('queued', 'running');`));
  report('동시 렌더: A(3번째) 성공·조직 잠금 보유', ra.code === 0 && aHolds, ra.code === 0 ? `보유 ${aHolds}` : ra.err);
  report('동시 렌더: B 가 A 커밋 전 조직 잠금 키에서 대기', bWaits);
  report('동시 렌더: B(4번째, 다른 request_id) AR030 거부', rb.code !== 0 && /AR030/.test(rb.err), rb.code === 0 ? 'B 가 성공함(한도 우회)' : rb.err.split('\n')[0]);
  report(`동시 렌더: 활성 렌더 = 한도 ${limit}`, active === limit, `활성 ${active}`);
}

try {
  psqlOk('select 1;');
} catch (e) {
  console.error(`로컬 DB 컨테이너(${CONTAINER})에 접속하지 못했다. npx supabase@2.122.0 start 후 다시 실행한다.\n${e.message}`);
  process.exit(2);
}
checkRls();
checkDefiner();
await checkConcurrentRender();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `check: 실패 ${failed}건` : `check: 통과 ${results.length}건`);
process.exit(failed ? 1 : 0);
