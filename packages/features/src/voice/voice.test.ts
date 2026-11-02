// 음성(AR-06-053): 권한 거부→텍스트, 60초 정지, 한국어 음성 없음→숨김, 409·503, 재시도 시 같은 request_id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createApiClient, type FetchInit, type FetchResponseLike } from "../api-client/index.ts";
import { createDictation, MAX_RECORD_MS, type DictationDeps, type RecordingHandle } from "./dictation.ts";
import { createSpeaker, pickKoreanVoice, type SynthLike, type UtteranceLike } from "./speech.ts";
import { transcribeAudio } from "./transcribe.ts";

const tick = () => new Promise<void>((r) => setImmediate(r));

function fakeRecording(size = 10) {
  let finish!: (v: { audio: Blob; contentType: string }) => void;
  const done = new Promise<{ audio: Blob; contentType: string }>((r) => (finish = r));
  let stopped = 0;
  let released = 0;
  const handle: RecordingHandle = {
    stop: () => {
      stopped += 1;
      finish({ audio: new Blob([new Uint8Array(size)], { type: "audio/webm" }), contentType: "audio/webm" });
    },
    done,
    release: () => void (released += 1),
  };
  return { handle, stats: () => ({ stopped, released }) };
}

function harness(over: Partial<DictationDeps> = {}) {
  const timers: { fn: () => void; ms: number; id: number; cleared: boolean }[] = [];
  const sent: { requestId: string; size: number }[] = [];
  let n = 0;
  const rec = fakeRecording();
  const deps: DictationDeps = {
    supported: () => true,
    startRecording: async () => rec.handle,
    transcribe: async (audio, _ct, requestId) => {
      sent.push({ requestId, size: audio.size });
      return { text: "대지 300제곱미터", durationS: 5 };
    },
    newRequestId: () => `id-${++n}`,
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, cleared: false };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => void (timers[h as number]!.cleared = true),
    now: () => 0,
    ...over,
  };
  return { deps, timers, sent, rec };
}

test("권한 거부 → 안내만 보이고 텍스트 입력으로 계속(fallback)", async () => {
  const { deps } = harness({ startRecording: async () => Promise.reject(new Error("NotAllowedError")) });
  const d = createDictation(deps, { noticeAccepted: true });
  d.start();
  await tick();
  const s = d.state();
  assert.equal(s.kind, "fallback");
  assert.equal(s.kind === "fallback" && s.reason, "denied");
  assert.match(s.kind === "fallback" ? s.message : "", /텍스트로 입력/);
});

test("미지원 환경 → fallback(unsupported)", () => {
  const { deps } = harness({ supported: () => false });
  const d = createDictation(deps, { noticeAccepted: true });
  d.start();
  assert.equal(d.state().kind, "fallback");
});

test("첫 사용은 고지부터, 거절하면 녹음 시작 안 함", () => {
  const { deps, timers } = harness();
  const d = createDictation(deps);
  d.start();
  assert.equal(d.state().kind, "notice");
  d.declineNotice();
  assert.equal(d.state().kind, "idle");
  assert.equal(timers.length, 0);
});

test("60초 자동 정지 → 전송 → 결과(자동 전송 없이 result 상태)", async () => {
  const { deps, timers, sent, rec } = harness();
  const d = createDictation(deps);
  d.start();
  d.acceptNotice();
  await tick();
  assert.equal(d.state().kind, "recording");
  assert.equal(timers[0]?.ms, MAX_RECORD_MS);
  assert.equal(MAX_RECORD_MS, 60_000);
  timers[0]!.fn();
  await tick();
  await tick();
  assert.equal(rec.stats().stopped, 1);
  assert.equal(rec.stats().released, 1);
  assert.equal(sent.length, 1);
  const s = d.state();
  assert.equal(s.kind, "result");
  assert.equal(s.kind === "result" && s.text, "대지 300제곱미터");
});

test("한국어 음성 없음 → 읽어 주기 불가(버튼 숨김)", () => {
  const en = [{ lang: "en-US", name: "e" }];
  const ko = [{ lang: "en-US", name: "e" }, { lang: "ko_KR", name: "k" }];
  assert.equal(pickKoreanVoice(en), null);
  assert.equal(pickKoreanVoice(ko)?.name, "k");
  const mk = (voices: typeof en): SynthLike => ({ getVoices: () => voices, speak: () => {}, cancel: () => {} });
  const utt = (): UtteranceLike => ({ lang: "", voice: null, onend: null, onerror: null });
  assert.equal(createSpeaker(mk(en), utt).available(), false);
  assert.equal(createSpeaker(null, utt).available(), false);
  const spoken: UtteranceLike[] = [];
  const sp = createSpeaker({ ...mk(ko), speak: (u) => void spoken.push(u) }, utt);
  assert.equal(sp.available(), true);
  sp.speak("안녕하세요", () => {});
  assert.equal(spoken[0]?.lang, "ko-KR");
  assert.equal(spoken[0]?.voice?.name, "k");
});

// ── API: 같은 녹음 재시도 = 같은 request_id, 409·503 ──
function apiWith(statuses: { status: number; body: unknown }[]) {
  const calls: FetchInit[] = [];
  let i = 0;
  const api = createApiClient({
    baseUrl: "https://x.test",
    getAccessToken: async () => "tok",
    genId: () => "gen",
    fetch: async (_u, init): Promise<FetchResponseLike> => {
      calls.push(init);
      const r = statuses[Math.min(i++, statuses.length - 1)]!;
      return { status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) };
    },
  });
  return { api, calls };
}
const AUDIO = new Uint8Array([1, 2, 3]);

test("전송: 바이너리 본문·audio/* · x-request-id · 503도 자동 재시도 없음", async () => {
  const { api, calls } = apiWith([{ status: 503, body: { ok: false, error: { code: "STT_OFF" } } }]);
  await assert.rejects(() => transcribeAudio(api, AUDIO, "audio/webm", "rid-1"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers["x-request-id"], "rid-1");
  assert.equal(calls[0]!.headers["Idempotency-Key"], "rid-1");
  assert.equal(calls[0]!.headers["Content-Type"], "audio/webm");
  assert.equal(calls[0]!.binaryBody, AUDIO);
});

test("503 → fallback(disabled), 409 → 재전송 불가 오류", async () => {
  for (const [status, expect] of [[503, "fallback"], [409, "error"]] as const) {
    const { api } = apiWith([{ status, body: { ok: false, error: { code: status === 409 ? "IDEMPOTENT_REPLAY" : "X" } } }]);
    const { deps } = harness({ transcribe: (a, ct, id) => transcribeAudio(api, a, ct, id) });
    const d = createDictation(deps, { noticeAccepted: true });
    d.start();
    await tick();
    d.stop();
    for (let k = 0; k < 6; k++) await tick();
    const s = d.state();
    assert.equal(s.kind, expect, String(status));
    if (s.kind === "error") assert.equal(s.canResend, false);
    if (s.kind === "fallback") assert.equal(s.reason, "disabled");
  }
});

test("전송 실패 후 다시 보내기 = 같은 녹음·같은 request_id, 새 녹음은 새 id", async () => {
  const { api, calls } = apiWith([
    { status: 500, body: { ok: false, error: { code: "boom" } } },
    { status: 200, body: { ok: true, data: { text: "ok", duration_s: 3, credits: 1 } } },
  ]);
  const { deps } = harness({ transcribe: (a, ct, id) => transcribeAudio(api, a, ct, id) });
  const d = createDictation(deps, { noticeAccepted: true });
  d.start();
  await tick();
  d.stop();
  for (let k = 0; k < 6; k++) await tick();
  const e = d.state();
  assert.equal(e.kind, "error");
  assert.equal(e.kind === "error" && e.canResend, true);
  d.resend();
  for (let k = 0; k < 6; k++) await tick();
  assert.equal(d.state().kind, "result");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers["x-request-id"], "id-1");
  assert.equal(calls[1]!.headers["x-request-id"], "id-1");
});

test("본문 JSON과 rawBody 동시 사용 금지, 소스 규칙(hex·px 없음)", async () => {
  const { api } = apiWith([{ status: 200, body: {} }]);
  await assert.rejects(() => api.request({ method: "POST", path: "/p", idempotencyKey: "k", body: {}, rawBody: AUDIO, contentType: "audio/webm" }));
  for (const f of ["VoiceDictation.tsx", "ReadAloudButton.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /#[0-9a-fA-F]{3,8}\b/);
    for (const m of src.matchAll(/className="([^"]*)"/g)) assert.doesNotMatch(m[1] as string, /\d+px|\[/, m[1]);
  }
});
