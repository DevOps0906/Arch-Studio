// AR-06-049 라우팅 seed 검증(DB 없이). 실행: pnpm test:ai-routing (= node --test "scripts/ai-routing/*.test.mjs")
// 근거: tasks/logs/AR-06-049.md [DECISION] 2·5·6. 라우팅 14행 정본 = 마이그레이션 조각 2403(문서 표와 대조).
// 2400 seed 블록 = 2403 은 scripts/db/convert.mjs assertRoutingParity, 모놀리스 변환본(마이그레이션·seed.sql)은 test:db 골든이 본다(여기서 중복하지 않는다).
// DB 동작(org override·force·match_ai_chunks)은 security.sql(node scripts/ai-routing/run-sql.mjs), 기본 행 불변식·공개 지식은 rls_smoke.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDocTable, parseSeedRows, rowKey } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const DOC = parseDocTable(read('docs/file/03-설계/02_ARCHITECTURE.md'));
const MODULAR = parseSeedRows(read('supabase/modular/2403_arch_ai_routing.sql'), 'core');
const byFeature = new Map(MODULAR.map((r) => [r.feature, r]));

const { JOB_TYPE_SPECS } = await import('../../apps/web/src/server/ai/gateway/ai-token.ts');
const { FEATURES } = await import('../../apps/web/src/server/ai/token/signer.ts');

test('문서 표: 펼친 결과 정확히 14행, feature 중복 없음', () => {
  assert.equal(DOC.length, 14);
  assert.equal(new Set(DOC.map((r) => r.feature)).size, 14);
});

test('문서 표 = 2403_arch_ai_routing.sql 라우팅 insert(feature·kind·mode·체인 순서·force 집합 일치)', () => {
  assert.equal(MODULAR.length, 14);
  assert.deepEqual(MODULAR.map(rowKey).sort(), DOC.map(rowKey).sort());
});

test('강제 행은 open_source 모드이고 체인이 오픈소스(oss-*)만', () => {
  const forced = MODULAR.filter((r) => r.force).map((r) => r.feature).sort();
  assert.deepEqual(forced, ['arch.intake_consult', 'consult_recording', 'dify.aux']);
  for (const r of MODULAR.filter((x) => x.force)) {
    assert.equal(r.mode, 'open_source', r.feature);
    assert.ok(r.chain.length > 0 && r.chain.every((p) => p.startsWith('oss-')), r.feature);
  }
});

test('arch.knowledge: 문서 "아니오(컬렉션 모델 고정)" = seed force=false, 체인 oss-embed — 현재 동작 고정(DECISION 6)', () => {
  // force=false 라서 국외 동의 조직의 org override 는 상용 임베딩을 고를 수 있다. 컬렉션 모델 고정은 ai_collections.embedding_provider 가 맡는다.
  const r = byFeature.get('arch.knowledge');
  assert.deepEqual({ kind: r.kind, mode: r.mode, chain: r.chain, force: r.force }, { kind: 'embedding', mode: 'open_source', chain: ['oss-embed'], force: false });
});

test('ai-token feat 매핑: 상담(consult) → arch.intake_consult(강제 행), 대화(chat) → arch.intake, 그 밖 → null', () => {
  const intake = JOB_TYPE_SPECS['arch.intake'];
  assert.equal(intake.feat({ source: 'consult' }), 'arch.intake_consult');
  assert.equal(byFeature.get(intake.feat({ source: 'consult' })).force, true);
  assert.equal(intake.feat({ source: 'chat' }), 'arch.intake');
  assert.equal(intake.feat({ source: 'other' }), null);
  assert.equal(intake.feat({}), null);
  assert.equal(JOB_TYPE_SPECS['arch.review'].feat({}), 'arch.review');
  assert.equal(JOB_TYPE_SPECS['arch.proposal_pdf'].feat({ variant: 'proposal' }), 'arch.proposal_narrative');
  assert.equal(JOB_TYPE_SPECS['arch.proposal_pdf'].feat({ variant: 'doc_template' }), null);
});

test('토큰 feature 키(signer FEATURES)는 전부 seed 의 llm 행', () => {
  for (const f of FEATURES) assert.equal(byFeature.get(f)?.kind, 'llm', f);
});

test('음성: seed consult_recording = [oss-voice] 강제(제공자 선택 코드는 후속 — [DECISION] 7)', () => {
  const consult = byFeature.get('consult_recording');
  assert.deepEqual({ kind: consult.kind, chain: consult.chain, force: consult.force }, { kind: 'stt', chain: ['oss-voice'], force: true });
});
