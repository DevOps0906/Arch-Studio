// AR-06-049 라우팅 seed 검증(DB 없이). 실행: pnpm test:ai-routing (= node --test "scripts/ai-routing/*.test.mjs")
// 근거: tasks/logs/AR-06-049.md [DECISION] 2·5·6. 강제는 SQL·TS 에 있으므로 그 값을 직접 대조한다.
// DB 동작(resolve_ai_route·ai_filter_chain·match_ai_chunks)은 security.sql(node scripts/ai-routing/run-sql.mjs)이 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDocTable, parseSeedRows, rowKey } from './lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const DOC = parseDocTable(read('docs/file/03-설계/02_ARCHITECTURE.md'));
const MODULAR = parseSeedRows(read('supabase/modular/2400_arch.sql'), 'core');
const MONO = parseSeedRows(read('supabase/seed.sql'), 'public');
const byFeature = new Map(MODULAR.map((r) => [r.feature, r]));

const { JOB_TYPE_SPECS } = await import('../../apps/web/src/server/ai/gateway/ai-token.ts');
const { FEATURES } = await import('../../apps/web/src/server/ai/token/signer.ts');
const { sttProviderOf, isConsultEnabled } = await import('../../apps/web/src/server/voice/config.ts');
const { STT_CREDITS_PER_MINUTE } = await import('../../apps/web/src/server/ai/pricing.ts');
const workerStt = await import('../../workers/arch-jobs/src/handlers/stt/config.ts');
const webBilling = await import('../../apps/web/src/server/voice/billing.ts');
const workerBilling = await import('../../workers/arch-jobs/src/handlers/stt/billing.ts');

test('문서 표: 펼친 결과 정확히 14행, feature 중복 없음', () => {
  assert.equal(DOC.length, 14);
  assert.equal(new Set(DOC.map((r) => r.feature)).size, 14);
});

test('문서 표 = 2400_arch.sql 라우팅 insert(feature·kind·mode·체인 순서·force 집합 일치)', () => {
  assert.equal(MODULAR.length, 14);
  assert.deepEqual(MODULAR.map(rowKey).sort(), DOC.map(rowKey).sort());
});

test('모놀리스 seed.sql 라우팅 행 = 2400_arch.sql(로컬 DB 가 쓰는 쪽도 같다)', () => {
  assert.deepEqual(MONO.map(rowKey).sort(), MODULAR.map(rowKey).sort());
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

test('음성: 제공자는 oss-voice(또는 개발용 mock)만, 상용 이름은 null(실패 닫힘). seed consult_recording = [oss-voice] 강제', () => {
  const url = 'https://voice.example.test';
  for (const v of ['elevenlabs', 'ElevenLabs', 'openai', 'oss-voice ', '', undefined]) {
    assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: v, OSS_VOICE_BASE_URL: url, NODE_ENV: 'development' }), null, String(v));
    assert.equal(workerStt.loadSttConfig({ ARCH_VOICE_STT_PROVIDER: v, NODE_ENV: 'development' }).provider, null, String(v));
  }
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: 'oss-voice', OSS_VOICE_BASE_URL: url }), 'oss-voice');
  assert.equal(sttProviderOf({ ARCH_VOICE_STT_PROVIDER: 'mock', NODE_ENV: 'production' }), null);
  assert.equal(isConsultEnabled({ ARCH_VOICE_CONSULT_ENABLED: 'true', ARCH_VOICE_STT_PROVIDER: 'elevenlabs', NODE_ENV: 'development' }), false);
  const consult = byFeature.get('consult_recording');
  assert.deepEqual({ chain: consult.chain, force: consult.force }, { chain: ['oss-voice'], force: true });
  // 상담 녹음 잡 행의 provider_id 는 상수 oss-voice(요청 값 아님).
  assert.match(read('apps/web/src/server/voice/supabase-repo.ts'), /feature: "consult_recording",\s*kind: "stt",\s*provider_id: "oss-voice",/);
});

test('STT 분당 크레딧: 워커 상수 = pricing.ts(웹 정본), 같은 길이 → 같은 크레딧', () => {
  assert.equal(workerBilling.STT_CREDITS_PER_MINUTE, STT_CREDITS_PER_MINUTE.credits);
  for (const s of [0, 0.004, 1, 59.99, 60, 60.01, 3600]) {
    assert.equal(workerBilling.sttCreditsFor(s), webBilling.sttCreditsFor(s), String(s));
  }
});
