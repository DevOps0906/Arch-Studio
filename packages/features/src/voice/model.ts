// 음성 UI 순수 로직(03장 3.12절 마이크 버튼·읽어 주기, VOICE_ARCHITECTURE.md 8장). React 없이 node --test로 검사한다.
// 원칙: 음성은 텍스트 입력의 대안이다. 어떤 실패(권한 거부·미지원·네트워크·크레딧)도 텍스트 입력을 막거나 지우지 않는다.
// 받아쓰기는 60초까지(04_API.md `/api/voice/stt`), 분당 1 크레딧·실제 길이 정산. 결과는 미리보기·수정 후 입력창에 채우기만(자동 전송 안 함).

export const DICTATION_MAX_MS = 60_000;
/** 첫 사용 고지 확인 기록 키(고지문 버전이 바뀌면 키도 바꾼다). */
export const VOICE_NOTICE_KEY = "arch.voice.notice.v1";

export const VOICE_NOTICE_TEXT =
  "말한 내용을 글로 바꾸려고 음성을 음성 인식 서버로 보냅니다. 녹음 원본은 저장하지 않습니다. 분당 1 크레딧이 들고 실제 길이로 정산합니다. 음성 없이 텍스트로도 모든 기능을 쓸 수 있습니다.";

/** 마이크 권한을 고치는 곳(호출자가 shell-bridge capabilities로 정한다): site = 브라우저 사이트 권한, system = OS(Windows) 설정. */
export type MicPermissionHelp = "site" | "system";

export type VoiceErrorKind = "denied" | "unsupported" | "no_device" | "network" | "credits" | "too_long" | "unavailable";

export type VoicePhase = "idle" | "notice" | "requesting" | "recording" | "sending" | "preview" | "error";

export interface VoiceState {
  phase: VoicePhase;
  elapsedMs: number;
  /** 변환 결과(미리보기에서 고칠 수 있음). */
  draft: string;
  error: VoiceErrorKind | null;
}

export type VoiceAction =
  | { type: "press"; noticeAcked: boolean }
  | { type: "ack_notice" }
  | { type: "granted" }
  | { type: "fail"; kind: VoiceErrorKind }
  | { type: "tick"; elapsedMs: number }
  | { type: "stop" }
  | { type: "transcribed"; text: string }
  | { type: "edit"; text: string }
  | { type: "done" }
  | { type: "cancel" };

export const INITIAL_VOICE_STATE: VoiceState = { phase: "idle", elapsedMs: 0, draft: "", error: null };

export function voiceReducer(s: VoiceState, a: VoiceAction): VoiceState {
  switch (a.type) {
    case "press":
      if (s.phase === "recording") return { ...s, phase: "sending" };
      if (s.phase !== "idle" && s.phase !== "error") return s;
      return { ...INITIAL_VOICE_STATE, phase: a.noticeAcked ? "requesting" : "notice" };
    case "ack_notice":
      return s.phase === "notice" ? { ...s, phase: "requesting" } : s;
    case "granted":
      return s.phase === "requesting" ? { ...s, phase: "recording", elapsedMs: 0 } : s;
    case "tick":
      if (s.phase !== "recording") return s;
      // 60초에 닿으면 자동으로 멈추고 보낸다.
      return a.elapsedMs >= DICTATION_MAX_MS ? { ...s, elapsedMs: DICTATION_MAX_MS, phase: "sending" } : { ...s, elapsedMs: a.elapsedMs };
    case "stop":
      return s.phase === "recording" ? { ...s, phase: "sending" } : s;
    case "transcribed":
      return s.phase === "sending" ? { ...s, phase: "preview", draft: a.text } : s;
    case "edit":
      return s.phase === "preview" ? { ...s, draft: a.text } : s;
    case "fail":
      return { ...INITIAL_VOICE_STATE, phase: "error", error: a.kind };
    case "done":
    case "cancel":
      return INITIAL_VOICE_STATE;
  }
}

/** 텍스트 입력은 음성 상태와 무관하게 늘 쓸 수 있다(권한 거부·오류·녹음 중 포함). */
export function isTextInputAvailable(state: VoiceState): true {
  void state;
  return true;
}

export function remainingSeconds(s: VoiceState): number {
  return Math.max(0, Math.ceil((DICTATION_MAX_MS - s.elapsedMs) / 1000));
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** getUserMedia 예외 → 종류. 이름만 본다(메시지 원문은 버린다). */
export function micErrorKind(error: unknown): VoiceErrorKind {
  const name = error !== null && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") return "no_device";
  return "unsupported";
}

/** 오류 안내 문구(03장 7절: 권한 거부는 텍스트 대체를 함께 안내. 웹은 브라우저 권한, 설치형은 Windows 설정, 03장 1장 6행). */
export function voiceErrorMessage(kind: VoiceErrorKind, help: MicPermissionHelp): string {
  switch (kind) {
    case "denied":
      return help === "system"
        ? "마이크를 쓸 수 없습니다. Windows 설정 > 개인정보 > 마이크에서 허용하거나 텍스트로 입력하세요."
        : "마이크를 쓸 수 없습니다. 브라우저 주소창의 사이트 권한에서 마이크를 허용하거나 텍스트로 입력하세요.";
    case "no_device":
      return "연결된 마이크를 찾지 못했습니다. 텍스트로 입력하세요.";
    case "unsupported":
      return "이 환경에서는 음성 입력을 지원하지 않습니다. 텍스트로 입력하세요.";
    case "network":
      return "연결이 끊겨 음성을 보내지 못했습니다. 텍스트로 입력하거나 다시 시도하세요.";
    case "credits":
      return "크레딧이 부족해 음성 입력을 쓸 수 없습니다. 텍스트 입력은 계속 쓸 수 있습니다.";
    case "too_long":
      return "녹음이 너무 깁니다. 받아쓰기는 60초까지입니다.";
    case "unavailable":
      return "음성을 글로 바꾸지 못했습니다. 크레딧은 돌려드렸습니다. 텍스트로 입력하세요.";
  }
}

export interface MediaDevicesLike {
  getUserMedia(c: { audio: boolean }): Promise<unknown>;
}

/** 마이크 열기. 권한 거부·미지원은 예외 대신 종류로 돌려준다(호출자가 텍스트 입력을 그대로 둔다). */
export async function openMic<S>(devices: MediaDevicesLike | undefined): Promise<{ ok: true; stream: S } | { ok: false; kind: VoiceErrorKind }> {
  if (!devices || typeof devices.getUserMedia !== "function") return { ok: false, kind: "unsupported" };
  try {
    return { ok: true, stream: (await devices.getUserMedia({ audio: true })) as S };
  } catch (error) {
    return { ok: false, kind: micErrorKind(error) };
  }
}

export interface DictationResult {
  text: string;
  duration_s: number;
  credits: number;
}

export class VoiceRequestError extends Error {
  readonly kind: VoiceErrorKind;
  constructor(kind: VoiceErrorKind) {
    super(kind);
    this.name = "VoiceRequestError";
    this.kind = kind;
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: FormData }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** 서버 오류 코드 → 종류. */
export function kindFromCode(code: unknown): VoiceErrorKind {
  if (code === "CR001") return "credits";
  if (code === "VOICE_TOO_LONG" || code === "AR031" || code === "payload_too_large") return "too_long";
  return "unavailable";
}

/** POST /api/voice/stt(받아쓰기). request_id는 녹음 1건마다 새로(재전송은 같은 값 → 추가 차감 없음). */
export async function postDictation(input: {
  fetch: FetchLike;
  url: string;
  accessToken: string;
  audio: Blob;
  requestId: string;
}): Promise<DictationResult> {
  const form = new FormData();
  form.set("request_id", input.requestId);
  form.set("mode", "dictation");
  form.set("audio", input.audio, "dictation");
  let res: { status: number; json(): Promise<unknown> };
  try {
    res = await input.fetch(input.url, { method: "POST", headers: { authorization: `Bearer ${input.accessToken}` }, body: form });
  } catch {
    throw new VoiceRequestError("network");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const env = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (res.status === 200 && env["ok"] === true) {
    const d = env["data"] as Record<string, unknown> | undefined;
    if (d && typeof d["text"] === "string" && typeof d["duration_s"] === "number" && typeof d["credits"] === "number") {
      return { text: d["text"], duration_s: d["duration_s"], credits: d["credits"] };
    }
  }
  const err = env["error"] as Record<string, unknown> | undefined;
  throw new VoiceRequestError(kindFromCode(err?.["code"]));
}

export interface SpeechLike {
  speak(u: unknown): void;
  cancel(): void;
}

export interface SpeechEnv {
  speechSynthesis?: SpeechLike;
  SpeechSynthesisUtterance?: new (text: string) => { lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };
}

/** 읽어 주기 지원 여부(OS 음성 합성, 서버 미사용·0 크레딧). 없으면 버튼을 숨긴다. */
export function canReadAloud(env: SpeechEnv | undefined): boolean {
  return !!env?.speechSynthesis && typeof env.SpeechSynthesisUtterance === "function";
}

/** 읽기 시작. 지원하지 않으면 false. 이전 낭독은 끊는다. */
export function readAloud(env: SpeechEnv | undefined, text: string, opts: { rate?: number; onEnd?: () => void } = {}): boolean {
  if (!canReadAloud(env) || !env?.speechSynthesis || !env.SpeechSynthesisUtterance) return false;
  const u = new env.SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  env.speechSynthesis.cancel();
  env.speechSynthesis.speak(u);
  return true;
}
