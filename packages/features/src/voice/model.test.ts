// 음성 UI 로직: 권한 거부 시 텍스트로 계속, 첫 사용 고지, 60초 자동 정지, 받아쓰기 요청, 읽어 주기(AR-06-053).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canReadAloud,
  DICTATION_MAX_MS,
  INITIAL_VOICE_STATE,
  isTextInputAvailable,
  openMic,
  postDictation,
  readAloud,
  remainingSeconds,
  voiceErrorMessage,
  voiceReducer,
  VoiceRequestError,
  type FetchLike,
  type VoiceAction,
  type VoiceState,
} from "./model.ts";

function run(actions: VoiceAction[], from: VoiceState = INITIAL_VOICE_STATE): VoiceState {
  return actions.reduce(voiceReducer, from);
}

test("권한 거부: 오류 상태 + 텍스트 대체 안내, 텍스트 입력은 계속 쓸 수 있음", async () => {
  const denied = await openMic({ getUserMedia: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })) });
  assert.deepEqual(denied, { ok: false, kind: "denied" });
  if (denied.ok) return;
  const s = run([{ type: "press", noticeAcked: true }, { type: "fail", kind: denied.kind }]);
  assert.equal(s.phase, "error");
  assert.equal(s.error, "denied");
  assert.equal(isTextInputAvailable(s), true);
  assert.match(voiceErrorMessage("denied", "site"), /브라우저.*텍스트로 입력하세요/);
  assert.match(voiceErrorMessage("denied", "system"), /Windows 설정 > 개인정보 > 마이크.*텍스트로 입력하세요/);
  // 오류 뒤에도 다시 누르면 처음부터(마이크를 다시 요청할 수 있음)
  assert.equal(voiceReducer(s, { type: "press", noticeAcked: true }).phase, "requesting");
});

test("마이크 없음·미지원도 예외 없이 종류로 돌려주고 문구는 텍스트 입력을 안내", async () => {
  assert.deepEqual(await openMic(undefined), { ok: false, kind: "unsupported" });
  assert.deepEqual(await openMic({ getUserMedia: () => Promise.reject(Object.assign(new Error(), { name: "NotFoundError" })) }), { ok: false, kind: "no_device" });
  for (const kind of ["denied", "unsupported", "no_device", "network", "credits", "unavailable"] as const) {
    assert.match(voiceErrorMessage(kind, "site"), /텍스트/);
  }
});

test("첫 사용 고지 → 녹음 → 60초 자동 정지 → 미리보기 수정 → 채우기 후 처음으로", () => {
  let s = run([{ type: "press", noticeAcked: false }]);
  assert.equal(s.phase, "notice");
  s = run([{ type: "ack_notice" }, { type: "granted" }, { type: "tick", elapsedMs: 15_400 }], s);
  assert.equal(s.phase, "recording");
  assert.equal(remainingSeconds(s), 45);
  s = voiceReducer(s, { type: "tick", elapsedMs: DICTATION_MAX_MS + 10 });
  assert.equal(s.phase, "sending");
  s = run([{ type: "transcribed", text: "2층 거실" }, { type: "edit", text: "2층 거실 남향" }], s);
  assert.deepEqual([s.phase, s.draft], ["preview", "2층 거실 남향"]);
  assert.deepEqual(voiceReducer(s, { type: "done" }), INITIAL_VOICE_STATE);
});

test("postDictation: multipart(request_id·mode·audio) + Bearer, 오류 코드 → 종류", async () => {
  const seen: { url: string; auth: string; keys: string[] }[] = [];
  const ok: FetchLike = async (url, init) => {
    seen.push({ url, auth: init.headers["authorization"] ?? "", keys: [...init.body.keys()].sort() });
    return { status: 200, json: async () => ({ ok: true, data: { text: "안녕", duration_s: 3.2, credits: 1 } }) };
  };
  const audio = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  const r = await postDictation({ fetch: ok, url: "/api/voice/stt", accessToken: "tok", audio, requestId: "r1" });
  assert.deepEqual(r, { text: "안녕", duration_s: 3.2, credits: 1 });
  assert.deepEqual(seen[0], { url: "/api/voice/stt", auth: "Bearer tok", keys: ["audio", "mode", "request_id"] });

  const fail = (status: number, code: string): FetchLike => async () => ({ status, json: async () => ({ ok: false, error: { code } }) });
  const kinds: [FetchLike, string][] = [
    [fail(402, "CR001"), "credits"],
    [fail(413, "VOICE_TOO_LONG"), "too_long"],
    [fail(503, "voice_unavailable"), "unavailable"],
    [async () => Promise.reject(new TypeError("fetch failed")), "network"],
  ];
  for (const [f, kind] of kinds) {
    await assert.rejects(postDictation({ fetch: f, url: "/x", accessToken: "t", audio, requestId: "r" }), (e: unknown) => e instanceof VoiceRequestError && e.kind === kind);
  }
});

test("읽어 주기: OS 음성 합성(ko-KR, 서버 호출 없음), 지원 안 하면 false(버튼 숨김)", () => {
  assert.equal(canReadAloud(undefined), false);
  assert.equal(canReadAloud({}), false);
  assert.equal(readAloud({}, "안녕"), false);
  const spoken: { text: string; lang: string; rate: number }[] = [];
  let cancels = 0;
  class Utter {
    lang = "";
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  const env = {
    speechSynthesis: {
      speak: (u: unknown) => spoken.push({ text: (u as Utter).text, lang: (u as Utter).lang, rate: (u as Utter).rate }),
      cancel: () => void cancels++,
    },
    SpeechSynthesisUtterance: Utter,
  };
  assert.equal(canReadAloud(env), true);
  assert.equal(readAloud(env, "건폐율 60%", { rate: 5 }), true);
  assert.deepEqual(spoken, [{ text: "건폐율 60%", lang: "ko-KR", rate: 2 }]);
  assert.equal(cancels, 1);
});
