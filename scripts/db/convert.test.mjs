// 골든 비교: 변환기 산출물 == 디스크 파일(원시 바이트, 정규화 없음 — 골든도 산출물도 LF 여야 통과). 실행: node --test scripts/db/convert.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, convertLine } from './convert.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = (p) => readFileSync(resolve(ROOT, p));

test('0002·seed.sql·2401 변환본이 디스크 파일과 원시 바이트로 같다(CRLF 불허)', () => {
  for (const [rel, text] of buildAll()) {
    assert.equal(Buffer.compare(Buffer.from(text, 'utf8'), raw(rel)), 0, `${rel} 바이트 불일치`);
  }
});

test('2회 실행 결과가 같다(결정적), 출력에 CR 없음', () => {
  const a = buildAll();
  const b = buildAll();
  assert.deepEqual([...a.entries()], [...b.entries()]);
  for (const text of a.values()) assert.ok(!text.includes('\r'));
});

test('식별자는 바꾸고 잡·기능 이름 리터럴은 유지한다', () => {
  assert.equal(convertLine('from core.jobs j join arch.renders r'), 'from public.jobs j join public.renders r');
  assert.equal(convertLine("'arch.review', 'arch.' || p_kind"), "'arch.review', 'arch.' || p_kind");
  assert.equal(convertLine("'core.is_org_member(org_id) and core.has_entitlement(org_id, ''arch'')'"),
    "'public.is_org_member(org_id) and public.has_entitlement(org_id, ''arch'')'");
  assert.equal(convertLine("v_schema constant text := 'arch' /*@schema*/;"), "v_schema constant text := 'public' /*@schema*/;");
  assert.equal(convertLine("hashtext('arch:render_active'), hashtext(p_org::text)"), "hashtext('arch:render_active'), hashtext(p_org::text)");
});
