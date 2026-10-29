#!/usr/bin/env node
// 로컬 DB 에서 Supabase 타입을 생성해 두 경로에 같은 내용(UTF-8, LF)으로 쓴다. 셸 리다이렉트를 쓰지 않는다(Windows 인코딩 문제).
// 사용: node scripts/db/gen-types.mjs   (선행: npx supabase@2.122.0 start, db reset)
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = ['packages/domain/src/db/supabase.gen.ts', 'apps/web/src/types/supabase.ts'];

// 고정 문자열 명령(사용자 입력 없음). Windows 의 npx.cmd 실행을 위해 셸을 쓴다.
const r = spawnSync('npx -y supabase@2.122.0 gen types typescript --local', {
  cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024,
});
if (r.status !== 0 || !r.stdout.trim()) {
  console.error(`gen types 실패(${r.status}): ${r.stderr}`);
  process.exit(1);
}
const text = r.stdout.replace(/\r\n/g, '\n');
for (const rel of OUT) writeFileSync(resolve(ROOT, rel), text, 'utf8');
console.log('gen-types: 썼다', OUT.join(', '));
