// 받아쓰기 상태기계: 고지 → 권한 → 녹음(60초 자동 정지) → 전송 → 결과 확인. 순수 로직(브라우저 API는 deps로 주입).
// 어떤 실패에서도 텍스트 입력은 막지 않는다(fallback 상태는 안내일 뿐 화면 입력은 그대로).
import { MIC_DENIED, MIC_UNSUPPORTED, STT_EMPTY } from "./messages.ts";
import { classifySttError, type SttResult } from "./transcribe.ts";

export const MAX_RECORD_MS = 60_000;

export interface RecordingHandle {
  /** 녹음을 끝낸다. done이 소리 덩어리와 함께 끝난다. */
  stop(): void;
  readonly done: Promise<{ readonly audio: Blob; readonly contentType: string }>;
  /** 마이크 트랙을 닫는다. */
  release(): void;
}

export interface DictationDeps {
  supported(): boolean;
  /** 권한 요청 + 녹음 시작. 권한 거부는 reject. */
  startRecording(): Promise<RecordingHandle>;
  transcribe(audio: Blob, contentType: string, requestId: string): Promise<SttResult>;
  newRequestId(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export type DictationState =
  | { readonly kind: "idle" }
  | { readonly kind: "notice" }
  | { readonly kind: "requesting" }
  | { readonly kind: "recording"; readonly startedAt: number; readonly maxMs: number }
  | { readonly kind: "transcribing" }
  | { readonly kind: "result"; readonly text: string }
  /** 마이크 거부·미지원·서비스 꺼짐: 안내 문구만, 텍스트 입력으로 계속. */
  | { readonly kind: "fallback"; readonly reason: "denied" | "unsupported" | "disabled"; readonly message: string }
  | { readonly kind: "error"; readonly message: string; readonly canResend: boolean };

export interface Dictation {
  state(): DictationState;
  subscribe(fn: () => void): () => void;
  /** 첫 사용이면 고지부터, 이미 동의했으면 바로 녹음. */
  start(): void;
  acceptNotice(): void;
  declineNotice(): void;
  stop(): void;
  cancel(): void;
  /** 실패한 같은 녹음을 같은 request_id로 다시 보낸다. */
  resend(): void;
  /** 결과·안내를 닫고 처음으로. */
  reset(): void;
  dispose(): void;
}

export function createDictation(deps: DictationDeps, opts: { noticeAccepted?: boolean } = {}): Dictation {
  let state: DictationState = { kind: "idle" };
  let accepted = opts.noticeAccepted ?? false;
  let handle: RecordingHandle | null = null;
  let timer: unknown = null;
  let generation = 0; // 취소·재시작 시 늦게 도착한 응답을 버린다
  let pending: { audio: Blob; contentType: string; requestId: string } | null = null;
  const subs = new Set<() => void>();

  const set = (s: DictationState): void => {
    state = s;
    subs.forEach((f) => f());
  };
  const clearTimer = (): void => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  };
  const closeHandle = (): void => {
    handle?.release();
    handle = null;
  };

  async function send(gen: number): Promise<void> {
    const p = pending;
    if (!p) return;
    set({ kind: "transcribing" });
    try {
      const r = await deps.transcribe(p.audio, p.contentType, p.requestId);
      if (gen !== generation) return;
      pending = null;
      set({ kind: "result", text: r.text });
    } catch (e) {
      if (gen !== generation) return;
      const f = classifySttError(e);
      if (f.kind === "disabled") {
        pending = null;
        set({ kind: "fallback", reason: "disabled", message: f.message });
      } else if (f.kind === "replay") {
        pending = null; // 서버가 이미 처리했다: 같은 녹음 재전송은 무의미
        set({ kind: "error", message: f.message, canResend: false });
      } else {
        set({ kind: "error", message: f.message, canResend: f.retryable });
      }
    }
  }

  function stop(): void {
    if (state.kind === "recording") handle?.stop();
  }

  async function begin(): Promise<void> {
    if (!deps.supported()) return set({ kind: "fallback", reason: "unsupported", message: MIC_UNSUPPORTED });
    const gen = ++generation;
    set({ kind: "requesting" });
    let h: RecordingHandle;
    try {
      h = await deps.startRecording();
    } catch {
      if (gen === generation) set({ kind: "fallback", reason: "denied", message: MIC_DENIED });
      return;
    }
    if (gen !== generation) {
      h.release();
      return;
    }
    handle = h;
    set({ kind: "recording", startedAt: deps.now(), maxMs: MAX_RECORD_MS });
    timer = deps.setTimer(() => {
      timer = null;
      stop();
    }, MAX_RECORD_MS);
    h.done.then(
      (rec) => {
        if (gen !== generation) return;
        clearTimer();
        closeHandle();
        if (rec.audio.size === 0) return set({ kind: "error", message: STT_EMPTY, canResend: false });
        pending = { audio: rec.audio, contentType: rec.contentType, requestId: deps.newRequestId() };
        void send(gen);
      },
      () => {
        if (gen !== generation) return;
        clearTimer();
        closeHandle();
        set({ kind: "fallback", reason: "denied", message: MIC_DENIED });
      },
    );
  }

  return {
    state: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    start() {
      if (state.kind !== "idle" && state.kind !== "fallback" && state.kind !== "error" && state.kind !== "result") return;
      pending = null;
      if (!accepted) return set({ kind: "notice" });
      void begin();
    },
    acceptNotice() {
      if (state.kind !== "notice") return;
      accepted = true;
      void begin();
    },
    declineNotice() {
      if (state.kind === "notice") set({ kind: "idle" });
    },
    stop,
    cancel() {
      generation += 1;
      clearTimer();
      closeHandle();
      pending = null;
      set({ kind: "idle" });
    },
    resend() {
      if (state.kind === "error" && state.canResend && pending) void send(++generation);
    },
    reset() {
      generation += 1;
      pending = null;
      set({ kind: "idle" });
    },
    dispose() {
      generation += 1;
      clearTimer();
      closeHandle();
      subs.clear();
    },
  };
}
