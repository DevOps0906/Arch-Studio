#!/usr/bin/env node
// AR-06-049 AI 라우팅·RAG 격리 SQL 단언 러너. scripts/test-rls/run.mjs 의 파서·판정을 그대로 쓰고(형식 동일),
// 대상 파일만 scripts/ai-routing/security.sql 이다. 전체를 begin … rollback 으로 감싸 로컬 DB 에 데이터를 남기지 않는다.
// 사용: node scripts/ai-routing/run-sql.mjs [--container <이름>]   (mono 대상만: 로컬 DB 는 public 스키마)
// 선행: npx supabase@2.122.0 start (마이그레이션·seed 적용 상태). 원격 DB 접속 없음.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScript, judge, parseSmoke } from '../test-rls/run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = resolve(ROOT, 'scripts/ai-routing/security.sql');

function containerName() {
  const i = process.argv.indexOf('--container');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const m = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('supabase/config.toml 에 project_id 가 없다');
  return `supabase_db_${m[1]}`;
}

const container = containerName();
const parsed = parseSmoke(readFileSync(FILE, 'utf8'), 'mono');
const script = buildScript(parsed).replace('\\set ON_ERROR_STOP 1\n', '\\set ON_ERROR_STOP 1\nbegin;\n') + '\nrollback;\n';
const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-f', '-'],
  { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.error) {
  console.error(`docker 실행 실패: ${r.error.message}`);
  process.exit(2);
}
if (r.status !== 0) {
  const errs = r.stderr.split(/\r?\n/).filter((l) => /ERROR|FATAL|error:/.test(l) && !l.includes('SMOKE|'));
  console.error(`psql 종료 코드 ${r.status}(SETUP 실패, 컨테이너 ${container}).\n${errs.join('\n')}`);
  process.exit(2);
}
const results = new Map();
for (const m of r.stderr.matchAll(/SMOKE\|(\d+)\|(ok|err)\|([^|\r\n]*)(?:\|([^\r\n]*))?/g)) {
  results.set(Number(m[1]), m[2] === 'ok' ? { status: 'ok', n: Number(m[3]) } : { status: 'err', code: m[3], msg: m[4] ?? '' });
}
let fail = 0;
let actor = 'postgres';
parsed.steps.forEach((s, i) => {
  if (s.kind === 'as') { actor = s.actor; return; }
  const res = results.get(i);
  const v = judge(s, res);
  if (v.ok) { console.log(`OK   [${actor}] ${s.name ?? 'RUN'}`); return; }
  fail++;
  const detail = res?.status === 'err' ? ` (${res.msg})` : '';
  console.log(`FAIL [${actor}] ${s.name ?? 'RUN'} — 기대 ${s.expect}, 실제 ${v.got}${detail}`);
});
const tests = parsed.steps.filter((s) => s.kind === 'test').length;
console.log(fail ? `ai-routing sql: 실패 ${fail}건 / TEST ${tests}건` : `ai-routing sql: 통과 TEST ${tests}건`);
process.exit(fail ? 1 : 0);
