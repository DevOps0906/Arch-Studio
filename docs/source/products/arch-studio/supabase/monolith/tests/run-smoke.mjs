// run-smoke.mjs — arch-studio RLS/권한 스모크 러너 (PGlite, Supabase 없이 실행)
//
// 사용: (저장소 루트에서)
//   cd products/_tools-sqlcheck && npm ci && cd ../..
//   node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mod    # 통합 DB: core 0000~0009 + seed + 2400_arch
//   node products/arch-studio/supabase/monolith/tests/run-smoke.mjs --target mono   # 모놀리스: 0001_core_lite + 0002_arch_domain + seed
//
// 테스트 파일(rls_smoke.sql) 형식은 다른 제품과 같다:
//   -- SETUP ... -- END SETUP           관리 세션으로 한 번에 실행
//   -- AS <service|anon|A|B|C|M|V>      이후 문장의 역할 전환
//   -- RUN                              다음 문장을 기대값 없이 실행
//   -- TEST <이름> | expect=<rows:N | ok | sqlstate:CODE>
// @S@ 는 도메인 스키마(mod: arch, mono: public), @C@ 는 코어 스키마(mod: core, mono: public)로 치환한다.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..', '..');
const tools = join(root, 'products', '_tools-sqlcheck');
const target = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'mod';
if (!['mod', 'mono'].includes(target)) { console.error('--target mod | mono'); process.exit(2); }

const req = createRequire(join(tools, 'package.json'));
const load = (spec) => import(pathToFileURL(req.resolve(spec)).href);
const { PGlite } = await load('pglite-vec');
const ext = {};
for (const name of ['pgcrypto', 'citext', 'pg_trgm', 'uuid_ossp']) ext[name] = (await load(`pglite-vec/contrib/${name}`))[name];
ext.vector = (await load('pglite-vec/vector')).vector;
const db = new PGlite({ extensions: ext });

const stubRe = /create\s+extension\s+if\s+not\s+exists\s+"?(pg_cron|pg_net|supabase_vault|pg_graphql|pg_stat_statements|pgjwt|moddatetime|http|pgsodium)"?[^;]*;/gi;
const S = target === 'mod' ? 'arch' : 'public';
const C = target === 'mod' ? 'core' : 'public';
const mono = join(here, '..');
const modDir = join(root, 'products/_supabase-modular/migrations');
const files = target === 'mod'
  ? [
      ...readdirSync(modDir).filter((f) => /^000\d_/.test(f)).sort().map((f) => [f, readFileSync(join(modDir, f), 'utf8')]),
      ['seed.sql', readFileSync(join(root, 'products/_supabase-modular/seed.sql'), 'utf8')],
      ['2400_arch.sql', readFileSync(join(modDir, '2400_arch.sql'), 'utf8')],
    ]
  : [
      ['0001_core_lite.sql', readFileSync(join(mono, 'migrations/0001_core_lite.sql'), 'utf8')],
      ['0002_arch_domain.sql', readFileSync(join(mono, 'migrations/0002_arch_domain.sql'), 'utf8')],
      ['seed.sql', readFileSync(join(mono, 'seed.sql'), 'utf8')],
    ];

await db.exec(readFileSync(join(tools, 'prelude.sql'), 'utf8'));
for (const [name, sql] of files) {
  try { await db.exec(sql.replace(stubRe, '-- stubbed $1;')); }
  catch (e) { console.log(`APPLY FAIL ${name}: ${e.message}`); process.exit(1); }
}

const actors = {
  service: ['service_role', ''],
  anon: ['anon', ''],
  A: ['authenticated', 'aaaaaaaa-0000-4000-8000-000000000001'],
  B: ['authenticated', 'bbbbbbbb-0000-4000-8000-000000000002'],
  C: ['authenticated', 'cccccccc-0000-4000-8000-000000000003'],
  M: ['authenticated', 'dddddddd-0000-4000-8000-000000000004'],
  V: ['authenticated', 'eeeeeeee-0000-4000-8000-000000000005'],
};
async function become(actor) {
  const [role, sub] = actors[actor] ?? (() => { throw new Error(`unknown actor ${actor}`); })();
  await db.exec(`reset role;
    select set_config('request.jwt.claim.role', '${role}', false);
    select set_config('request.jwt.claims', '${JSON.stringify({ role, sub })}', false);
    select set_config('request.jwt.claim.sub', '${sub}', false);
    set role ${role};`);
}

const text = readFileSync(join(here, 'rls_smoke.sql'), 'utf8').replaceAll('@S@', S).replaceAll('@C@', C);
const setup = text.slice(text.indexOf('-- SETUP'), text.indexOf('-- END SETUP'));
await db.exec('reset role;' + setup);

const lines = text.slice(text.indexOf('-- END SETUP')).split('\n');
let pass = 0, fail = 0;
const takeStatement = (i) => {
  const buf = [];
  while (i < lines.length) {
    const l = lines[i++];
    if (!l.trim() || (l.startsWith('--') && buf.length === 0)) continue;
    buf.push(l);
    if (l.trimEnd().endsWith(';')) break;
  }
  return [buf.join('\n'), i];
};
for (let i = 0; i < lines.length; ) {
  const line = lines[i++];
  let m;
  if ((m = line.match(/^-- AS (\S+)/))) { await become(m[1]); continue; }
  if (line.startsWith('-- RUN')) {
    const [sql, next] = takeStatement(i); i = next;
    try { await db.query(sql); } catch (e) { console.log(`RUN FAIL: ${sql}\n   ${e.message}`); fail++; }
    continue;
  }
  if ((m = line.match(/^-- TEST (.+?) \| expect=(\S+)/))) {
    const [name, expect] = [m[1], m[2]];
    const [sql, next] = takeStatement(i); i = next;
    let got;
    try { const r = await db.query(sql); got = { rows: r.rows.length }; }
    catch (e) { got = { code: e.code, msg: e.message }; }
    let ok;
    if (expect === 'ok') ok = !got.code;
    else if (expect.startsWith('rows:')) ok = !got.code && got.rows === Number(expect.slice(5));
    else if (expect.startsWith('sqlstate:')) ok = got.code === expect.slice(9);
    if (ok) pass++;
    else { fail++; console.log(`FAIL ${name}\n   expect=${expect} got=${got.code ? `sqlstate:${got.code} ${got.msg}` : `rows:${got.rows}`}`); }
  }
}
console.log(`[${target}] 결과: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
