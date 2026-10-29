#!/usr/bin/env node
// RLS·권한 회귀 스모크 러너(AR-06-002). 새 npm 의존성 없이 로컬 DB 컨테이너의 psql 로 실행한다(원격 DB 접속 없음).
//
// 사용: node scripts/test-rls/run.mjs [--target mono|mod] [--container <이름>]
//       선행: npx supabase@2.122.0 start && npx supabase@2.122.0 db reset --local (스모크는 고정 UUID 로 데이터를 만든다)
//
// 동작: supabase/tests/rls_smoke.sql 을 읽어
//  1. @S@/@C@ 를 치환한다(mono: public/public, mod: arch/core). 단순 문자열 치환이라 결정적이다.
//  2. "-- END SETUP" 앞은 관리 세션(postgres)으로 그대로 실행한다.
//  3. "-- AS <행위자>" 마다 역할과 JWT 클레임(request.jwt.claim.sub/role, request.jwt.claims)을 바꾸고,
//     "-- TEST <이름> | expect=<rows:N|ok|sqlstate:CODE>" / "-- RUN" 다음 한 문장을 plpgsql EXECUTE 로 실행한다.
//     문장마다 예외 블록(서브트랜잭션)이라 실패한 문장은 되돌려지고 다음 문장으로 넘어간다(psql 자동 커밋과 같은 효과).
//  4. 결과는 NOTICE 로 받아 기대값과 비교한다. RUN 실패도 실패로 센다.
//  mod 대상은 platform 코어(0000~0009)가 필요해 이 저장소의 로컬 DB 로는 재현되지 않는다.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMOKE = resolve(ROOT, 'supabase/tests/rls_smoke.sql');

const SCHEMAS = { mono: { S: 'public', C: 'public' }, mod: { S: 'arch', C: 'core' } };
const ACTORS = {
  anon: { role: 'anon', sub: null },
  service: { role: 'service_role', sub: null },
  A: { role: 'authenticated', sub: 'aaaaaaaa-0000-4000-8000-000000000001' },
  B: { role: 'authenticated', sub: 'bbbbbbbb-0000-4000-8000-000000000002' },
  C: { role: 'authenticated', sub: 'cccccccc-0000-4000-8000-000000000003' },
  M: { role: 'authenticated', sub: 'dddddddd-0000-4000-8000-000000000004' },
  V: { role: 'authenticated', sub: 'eeeeeeee-0000-4000-8000-000000000005' },
};
const Q = '$smoke_q$';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function containerName() {
  const m = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('supabase/config.toml 에 project_id 가 없다');
  return arg('--container', `supabase_db_${m[1]}`);
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// rls_smoke.sql → { setup, steps: [{ kind: 'as'|'test'|'run', ... }] }
export function parseSmoke(text, target) {
  const map = SCHEMAS[target];
  if (!map) throw new Error(`알 수 없는 대상: ${target}`);
  const src = text.replaceAll('@S@', map.S).replaceAll('@C@', map.C);
  const lines = src.split(/\r?\n/);
  const end = lines.findIndex((l) => l.trim() === '-- END SETUP');
  if (end < 0) throw new Error('"-- END SETUP" 표시가 없다');
  const steps = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const sql = cur.body.join('\n').trim().replace(/;\s*$/, '');
    if (!sql) throw new Error(`문장 없음: ${cur.name ?? 'RUN'}`);
    if (sql.includes(Q)) throw new Error(`문장에 ${Q} 가 있다: ${cur.name ?? 'RUN'}`);
    steps.push({ ...cur, body: undefined, sql });
    cur = null;
  };
  for (const raw of lines.slice(end + 1)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^-- AS (\S+)$/))) {
      flush();
      if (!ACTORS[m[1]]) throw new Error(`알 수 없는 행위자: ${m[1]}`);
      steps.push({ kind: 'as', actor: m[1] });
    } else if ((m = line.match(/^-- TEST (.+) \| expect=(rows:\d+|ok|sqlstate:[0-9A-Z]{5})$/))) {
      flush();
      cur = { kind: 'test', name: m[1], expect: m[2], body: [] };
    } else if (line === '-- RUN') {
      flush();
      cur = { kind: 'run', name: null, expect: 'ok', body: [] };
    } else if (line.startsWith('-- TEST')) {
      throw new Error(`TEST 머리 형식 오류: ${line}`);
    } else if (line === '' || line.startsWith('--')) {
      flush();
    } else if (cur) {
      cur.body.push(raw);
    } else {
      throw new Error(`머리 없는 문장: ${line}`);
    }
  }
  flush();
  return { setup: lines.slice(0, end).join('\n'), steps };
}

function actorSql(name) {
  const a = ACTORS[name];
  const claims = JSON.stringify(a.sub ? { sub: a.sub, role: a.role } : { role: a.role });
  return [
    'reset role;',
    `select set_config('request.jwt.claim.sub', ${lit(a.sub ?? '')}, false),`,
    `       set_config('request.jwt.claim.role', ${lit(a.role)}, false),`,
    `       set_config('request.jwt.claims', ${lit(claims)}, false);`,
    `set role ${a.role};`,
  ].join('\n');
}

function stepSql(i, sql) {
  return `do $smoke_do$ declare n bigint; begin
  execute ${Q}${sql}${Q};
  get diagnostics n = row_count;
  raise notice 'SMOKE|%|ok|%', ${i}, n;
exception when others then
  raise notice 'SMOKE|%|err|%|%', ${i}, sqlstate, replace(sqlerrm, E'\\n', ' ');
end $smoke_do$;`;
}

export function buildScript(parsed) {
  const out = ['\\set ON_ERROR_STOP 1', "set client_min_messages = notice;", parsed.setup, ''];
  parsed.steps.forEach((s, i) => out.push(s.kind === 'as' ? actorSql(s.actor) : stepSql(i, s.sql)));
  out.push('reset role;');
  return out.join('\n');
}

export function judge(step, res) {
  if (!res) return { ok: false, got: '실행 안 됨' };
  const got = res.status === 'ok' ? `rows:${res.n}` : `sqlstate:${res.code}`;
  const [kind, val] = step.expect.split(':');
  if (kind === 'ok') return { ok: res.status === 'ok', got };
  if (kind === 'rows') return { ok: res.status === 'ok' && res.n === Number(val), got };
  return { ok: res.status === 'err' && res.code === val, got };
}

function main() {
  const target = arg('--target', 'mono');
  const container = containerName();
  const parsed = parseSmoke(readFileSync(SMOKE, 'utf8'), target);
  if (target === 'mod') console.warn('주의: mod 대상은 platform 코어(0000~0009)가 있는 DB 에서만 의미가 있다.');
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-f', '-'],
    { input: buildScript(parsed), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    console.error(`docker 실행 실패: ${r.error.message}`);
    process.exit(2);
  }
  const results = new Map();
  for (const m of r.stderr.matchAll(/SMOKE\|(\d+)\|(ok|err)\|([^|\r\n]*)(?:\|([^\r\n]*))?/g)) {
    results.set(Number(m[1]), m[2] === 'ok' ? { status: 'ok', n: Number(m[3]) } : { status: 'err', code: m[3], msg: m[4] ?? '' });
  }
  if (r.status !== 0) {
    const errs = r.stderr.split(/\r?\n/).filter((l) => /ERROR|FATAL|error:/.test(l) && !l.includes('SMOKE|'));
    console.error(`psql 종료 코드 ${r.status}(SETUP 또는 역할 전환 실패, 컨테이너 ${container}). 고정 UUID 를 쓰므로 npx supabase@2.122.0 db reset --local 후 다시 실행한다.\n${errs.join('\n')}`);
    process.exit(2);
  }
  let pass = 0;
  let fail = 0;
  let actor = 'postgres';
  parsed.steps.forEach((s, i) => {
    if (s.kind === 'as') { actor = s.actor; return; }
    const res = results.get(i);
    const v = judge(s, res);
    if (v.ok) { pass++; if (s.kind === 'test') console.log(`OK   [${actor}] ${s.name}`); return; }
    fail++;
    const detail = res?.status === 'err' ? ` (${res.msg})` : '';
    console.log(`FAIL [${actor}] ${s.name ?? `RUN: ${s.sql.split('\n')[0].slice(0, 80)}`} — 기대 ${s.expect}, 실제 ${v.got}${detail}`);
  });
  const tests = parsed.steps.filter((s) => s.kind === 'test').length;
  console.log(fail ? `rls smoke(${target}): 실패 ${fail}건 / TEST ${tests}건` : `rls smoke(${target}): 통과 TEST ${tests}건 + RUN ${pass - tests}건`);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
