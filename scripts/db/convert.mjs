#!/usr/bin/env node
// 모듈러 조각(supabase/modular/*.sql) → 모놀리스 마이그레이션·seed.sql 변환기. Node 내장 모듈만, 결정적(같은 입력 → 같은 바이트).
//
// 적용 순서: 2400 → 2401 → 2402. 2402는 2400 객체를 바꾸므로 2402 단독 반복 실행만 안전하고, 2400을 다시 적용하면 2402도 다시 적용해야 한다.
//
// 사용: node scripts/db/convert.mjs         산출물과 디스크 파일 비교(--check, 기본). 다르면 exit 1
//       node scripts/db/convert.mjs --write   산출물을 디스크에 쓴다(LF)
//
// 규칙(실제 산출물 20261013000002_arch_domain.sql·seed.sql 을 바이트 단위로 재현하도록 옮긴 것):
//  1. 입력 CRLF → LF. 출력은 항상 LF.
//  2. `-- @modular-only-begin` ~ `-- @modular-only-end` 줄(양 끝 포함)을 지운다.
//  3. `-- @monolith-seed-begin` ~ `-- @monolith-seed-end` 줄(양 끝 포함)을 떼어 seed.sql 의 같은 표시 이후 부분으로 보낸다.
//     seed.sql 의 표시 앞부분(앱 레지스트리 행 등)은 사람이 소유하며 변환기는 건드리지 않는다.
//  4. 스키마 변수 `'arch' /*@schema*/` → `'public' /*@schema*/`.
//  5. 식별자 `core.<x>`·`arch.<x>` → `public.<x>`: 앞 글자가 단어 문자나 작은따옴표가 아니면 바꾼다.
//     주석 안(예: "public.jobs 1", "같은 잡 public.intake")과 문자열 리터럴 중간(정책 식의 `core.has_entitlement`)도 바뀐다.
//  6. 작은따옴표 바로 뒤 `'core.<x>(`·`'arch.<x>(`(문자열로 만든 SQL 식의 함수 호출)은 바꾼다.
//     그 밖의 작은따옴표 바로 뒤 이름(`'arch.review'`, `'arch.' || p_kind` 같은 잡·기능·감사 문자열)은 그대로 둔다.
//  7. 둘째 줄 `-- <조각 파일명>` 을 모놀리스 머리 3줄로 바꾼다(변환 뒤에 넣으므로 머리 문구는 치환되지 않는다).
//
// 문서와 다른 점(05_DATA_MODEL.md 8절, DB_CONVENTIONS.md 12장은 "문자열 리터럴 제외"라고 적었다):
//  - 5·6 처럼 실제 산출물은 문자열 안의 SQL 식(정책 문자열)과 주석 속 이름도 바꾼다. 문서가 말하는 "리터럴 제외"는
//    작은따옴표로 시작하는 잡·기능 이름 문자열에만 맞다. 변환기는 실제 산출물(적용된 마이그레이션)을 정본으로 따른다.
//  - 문서의 (d) "모든 테이블 revoke 뒤 GRANT" 는 변환이 아니라 조각 본문에 이미 있다(스키마 변수만 치환).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// 조각 → 모놀리스 대상. origin·title 은 머리 문구(0002 는 적용된 파일의 문구 그대로).
export const TARGETS = [
  {
    src: 'supabase/modular/2400_arch.sql',
    out: 'supabase/migrations/20261013000002_arch_domain.sql',
    title: '0002_arch_domain.sql (모놀리스 arch-studio)',
    origin: 'docs/products/_supabase-modular/migrations/2400_arch.sql',
    seed: 'supabase/seed.sql',
  },
  {
    src: 'supabase/modular/2401_arch_fixes.sql',
    out: 'supabase/migrations/20261029000001_arch_fixes.sql',
    title: '20261029000001_arch_fixes.sql (모놀리스 arch-studio)',
    origin: 'supabase/modular/2401_arch_fixes.sql',
    seed: null,
  },
  {
    src: 'supabase/modular/2402_arch_cloud_projects.sql',
    out: 'supabase/migrations/20261102000001_arch_cloud_projects.sql',
    title: '20261102000001_arch_cloud_projects.sql (모놀리스 arch-studio)',
    origin: 'supabase/modular/2402_arch_cloud_projects.sql',
    seed: null,
  },
];

const SEED_BEGIN = '-- @monolith-seed-begin';
const SEED_END = '-- @monolith-seed-end';
const MOD_BEGIN = '-- @modular-only-begin';
const MOD_END = '-- @modular-only-end';

const toLf = (s) => s.replace(/\r\n/g, '\n');

export function convertLine(line) {
  return line
    .replace(/'arch' \/\*@schema\*\//g, "'public' /*@schema*/")
    .replace(/'(core|arch)\.([a-z_][a-z0-9_]*)\(/g, "'public.$2(")
    .replace(/(?<![\w'])(core|arch)\.(?=[a-z_])/g, 'public.');
}

function cutBlock(lines, begin, end, file) {
  const b = lines.findIndex((l) => l.startsWith(begin));
  if (b < 0) return { rest: lines, block: null };
  const e = lines.findIndex((l, i) => i > b && l.startsWith(end));
  if (e < 0) throw new Error(`${file}: ${begin} 뒤에 ${end} 가 없다`);
  return { rest: [...lines.slice(0, b), ...lines.slice(e + 1)], block: lines.slice(b, e + 1) };
}

function headerLines(t) {
  return [
    `-- ${t.title}`,
    `-- 원본: ${t.origin} 의 변환본(DB_CONVENTIONS.md 12장: 스키마 블록 제거, core.·arch. → public.,`,
    '--   @monolith-seed 블록은 seed.sql 로 이동). 본문은 변환 외에 같다. 직접 고치지 말고 조각을 고친 뒤 다시 변환한다.',
  ];
}

// 조각 본문(문자열) → { migration, seedBlock|null }
export function convertModular(text, t) {
  const lines = toLf(text).split('\n');
  const expect = `-- ${basename(t.src)}`;
  if (lines[1] !== expect) throw new Error(`${t.src}: 둘째 줄이 '${expect}' 가 아니다`);
  const mod = cutBlock(lines, MOD_BEGIN, MOD_END, t.src);
  const seed = cutBlock(mod.rest, SEED_BEGIN, SEED_END, t.src);
  const body = seed.rest.map(convertLine);
  body.splice(1, 1, ...headerLines(t));
  return {
    migration: body.join('\n'),
    seedBlock: seed.block ? seed.block.map(convertLine).join('\n') + '\n' : null,
  };
}

// 기존 seed.sql 의 표시 앞부분(사람 소유) + 변환한 seed 블록
export function mergeSeed(seedText, seedBlock, file) {
  const s = toLf(seedText);
  const at = s.indexOf(SEED_BEGIN);
  if (at < 0) throw new Error(`${file}: ${SEED_BEGIN} 표시가 없다`);
  return s.slice(0, at) + seedBlock;
}

export function buildAll(root = ROOT) {
  const files = new Map();
  for (const t of TARGETS) {
    const { migration, seedBlock } = convertModular(readFileSync(resolve(root, t.src), 'utf8'), t);
    files.set(t.out, migration);
    if (t.seed) {
      if (!seedBlock) throw new Error(`${t.src}: seed 대상인데 @monolith-seed 블록이 없다`);
      files.set(t.seed, mergeSeed(readFileSync(resolve(root, t.seed), 'utf8'), seedBlock, t.seed));
    } else if (seedBlock) {
      throw new Error(`${t.src}: seed 대상이 아닌데 @monolith-seed 블록이 있다`);
    }
  }
  return files;
}

// 디스크와 비교. 작업 트리가 core.autocrlf 로 CRLF 일 수 있어 디스크 쪽만 CRLF → LF 로 읽는다.
export function diffAll(root = ROOT) {
  const bad = [];
  for (const [rel, text] of buildAll(root)) {
    const p = resolve(root, rel);
    const disk = existsSync(p) ? toLf(readFileSync(p, 'utf8')) : null;
    if (disk !== text) bad.push(rel);
  }
  return bad;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    for (const [rel, text] of buildAll()) writeFileSync(resolve(ROOT, rel), text, 'utf8');
    console.log('convert: 썼다', TARGETS.length, '개 조각');
  } else {
    const bad = diffAll();
    if (bad.length) {
      console.error('convert --check: 다름 →', bad.join(', '), '(node scripts/db/convert.mjs --write 로 다시 만든다)');
      process.exit(1);
    }
    console.log('convert --check: diff 0');
  }
}
