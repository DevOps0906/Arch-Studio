// 음성 UI(03장 3.12절): 마이크 버튼(VoiceButton)과 읽어 주기(ReadAloudButton). 로직은 model.ts(순수, 테스트 대상).
// - 마이크: 첫 사용 고지 → 토글 녹음(빨간 점 + 경과·남은 시간, 60초 자동 정지) → 변환 미리보기·수정 → 입력창에 채우기(자동 전송 안 함).
//   권한 거부·미지원·오류는 안내만 하고 텍스트 입력은 건드리지 않는다(음성은 대안, VOICE_ARCHITECTURE.md 8장).
// - 읽어 주기: OS 음성 합성(서버 미사용, 0 크레딧), 자동 재생 없음. 지원하지 않으면 렌더하지 않는다.
// 서버 호출은 호출자가 넘기는 transcribe(postDictation을 세션 토큰으로 감싼 함수)만 쓴다.
import { Banner, Button, Dialog, IconButton } from "@arch-studio/ui";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  canReadAloud,
  formatClock,
  INITIAL_VOICE_STATE,
  openMic,
  readAloud,
  remainingSeconds,
  voiceErrorMessage,
  voiceReducer,
  VoiceRequestError,
  VOICE_NOTICE_KEY,
  VOICE_NOTICE_TEXT,
  type DictationResult,
  type SpeechEnv,
  type MicPermissionHelp,
} from "./model.ts";

export * from "./model.ts";

interface RecorderLike {
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  readonly mimeType: string;
}

interface StreamLike {
  getTracks(): { stop(): void }[];
}

type G = {
  navigator?: { mediaDevices?: { getUserMedia(c: { audio: boolean }): Promise<unknown> } };
  MediaRecorder?: new (s: unknown) => RecorderLike;
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  crypto?: { randomUUID?: () => string };
} & SpeechEnv;

const g = globalThis as unknown as G;

function noticeAcked(): boolean {
  try {
    return g.localStorage?.getItem(VOICE_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function VoiceButton({
  transcribe,
  onText,
  permissionHelp,
  disabled,
}: {
  /** 받아쓰기 요청(requestId는 녹음 1건마다 새로). 실패는 VoiceRequestError. */
  transcribe: (audio: Blob, requestId: string) => Promise<DictationResult>;
  /** 확정한 텍스트를 입력창에 채운다(보내기는 사용자가 따로). */
  onText: (text: string) => void;
  /** 권한 거부 안내 위치(capabilities로 정한다). */
  permissionHelp: MicPermissionHelp;
  disabled?: boolean;
}) {
  const [s, dispatch] = useReducer(voiceReducer, INITIAL_VOICE_STATE);
  const rec = useRef<{ recorder: RecorderLike; stream: StreamLike; chunks: Blob[]; startedAt: number } | null>(null);
  // 부모가 다시 그려 함수가 바뀌어도 보내기 효과를 다시 돌리지 않는다.
  const transcribeRef = useRef(transcribe);
  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);

  // 녹음 시작(권한 요청).
  useEffect(() => {
    if (s.phase !== "requesting") return;
    let cancelled = false;
    void (async () => {
      const opened = await openMic<StreamLike>(g.navigator?.mediaDevices);
      if (cancelled) {
        if (opened.ok) opened.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!opened.ok || !g.MediaRecorder) {
        if (opened.ok) opened.stream.getTracks().forEach((t) => t.stop());
        dispatch({ type: "fail", kind: opened.ok ? "unsupported" : opened.kind });
        return;
      }
      const recorder = new g.MediaRecorder(opened.stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.current = { recorder, stream: opened.stream, chunks, startedAt: Date.now() };
      recorder.start(1000);
      dispatch({ type: "granted" });
    })();
    return () => {
      cancelled = true;
    };
  }, [s.phase]);

  // 경과 시간(60초에 리듀서가 sending으로 바꾼다).
  useEffect(() => {
    if (s.phase !== "recording") return;
    const id = setInterval(() => {
      const r = rec.current;
      if (r) dispatch({ type: "tick", elapsedMs: Date.now() - r.startedAt });
    }, 250);
    return () => clearInterval(id);
  }, [s.phase]);

  // 멈춤 → 보내기. 원본은 메모리에서만 쓰고 버린다.
  useEffect(() => {
    if (s.phase !== "sending") return;
    const r = rec.current;
    rec.current = null;
    if (!r) {
      dispatch({ type: "fail", kind: "unsupported" });
      return;
    }
    let cancelled = false;
    r.recorder.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      const audio = new Blob(r.chunks, { type: r.recorder.mimeType || "audio/webm" });
      const requestId = g.crypto?.randomUUID?.();
      if (!requestId) {
        dispatch({ type: "fail", kind: "unsupported" });
        return;
      }
      transcribeRef.current(audio, requestId).then(
        (out) => !cancelled && dispatch({ type: "transcribed", text: out.text }),
        (err: unknown) => !cancelled && dispatch({ type: "fail", kind: err instanceof VoiceRequestError ? err.kind : "unavailable" }),
      );
    };
    r.recorder.stop();
    return () => {
      cancelled = true;
    };
  }, [s.phase]);

  // 화면을 떠나면 마이크를 끈다.
  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        r.recorder.onstop = null;
        r.recorder.stop();
        r.stream.getTracks().forEach((t) => t.stop());
      }
    },
    [],
  );

  const recording = s.phase === "recording";
  const busy = s.phase === "requesting" || s.phase === "sending";

  return (
    <div className="flex min-w-0 flex-col gap-gap">
      <div className="flex flex-wrap items-center gap-gap">
        <IconButton
          icon={recording ? "mic-off" : "mic"}
          label={recording ? "녹음 멈추고 변환" : "음성으로 입력"}
          variant="secondary"
          pressed={recording}
          disabled={disabled || busy || s.phase === "preview"}
          onClick={() => dispatch({ type: "press", noticeAcked: noticeAcked() })}
        />
        {recording ? (
          <p className="inline-flex items-center gap-1.5 text-caption text-fg-2" aria-live="polite">
            <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
            <span className="tabular-nums">녹음 중 {formatClock(s.elapsedMs)} · 남은 {remainingSeconds(s)}초</span>
          </p>
        ) : null}
        {s.phase === "sending" ? <p className="text-caption text-fg-2" aria-live="polite">글로 바꾸는 중…</p> : null}
        {s.phase === "idle" ? <p className="text-caption text-fg-3">음성은 분당 1 크레딧(실제 길이로 정산)</p> : null}
      </div>

      {s.phase === "error" && s.error ? (
        <Banner tone={s.error === "denied" || s.error === "credits" ? "warn" : "info"} title="음성 입력을 쓸 수 없습니다" action={<Button size="sm" variant="ghost" onClick={() => dispatch({ type: "cancel" })}>닫기</Button>}>
          {voiceErrorMessage(s.error, permissionHelp)}
        </Banner>
      ) : null}

      {s.phase === "preview" ? (
        <div className="flex min-w-0 flex-col gap-gap rounded-control border border-line bg-surface p-pad">
          <label className="text-caption text-fg-2" htmlFor="voice-draft">
            변환 결과(고친 뒤 넣기)
          </label>
          <textarea
            id="voice-draft"
            className="focus-ring min-h-24 w-full rounded-control border border-input bg-surface p-2 text-body text-fg"
            value={s.draft}
            maxLength={4000}
            onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
          />
          <div className="flex flex-wrap justify-end gap-gap">
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "cancel" })}>
              버리기
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={s.draft.trim().length === 0}
              onClick={() => {
                onText(s.draft.trim());
                dispatch({ type: "done" });
              }}
            >
              입력창에 넣기
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={s.phase === "notice"}
        onClose={() => dispatch({ type: "cancel" })}
        title="음성 입력 안내"
        description={VOICE_NOTICE_TEXT}
        footer={
          <>
            <Button variant="ghost" onClick={() => dispatch({ type: "cancel" })}>
              텍스트로 입력
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                try {
                  g.localStorage?.setItem(VOICE_NOTICE_KEY, "1");
                } catch {
                  // 저장 실패면 다음에 다시 묻는다.
                }
                dispatch({ type: "ack_notice" });
              }}
            >
              확인하고 녹음
            </Button>
          </>
        }
      />
    </div>
  );
}

/** 답변 옆 읽어 주기. OS 음성 합성(0 크레딧). 지원하지 않으면 아무것도 그리지 않는다. */
export function ReadAloudButton({ text, rate }: { text: string; rate?: number }) {
  const [supported] = useState(() => canReadAloud(g));
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => g.speechSynthesis?.cancel(), []);
  if (!supported) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          g.speechSynthesis?.cancel();
          setSpeaking(false);
          return;
        }
        setSpeaking(readAloud(g, text, { rate: rate ?? 1, onEnd: () => setSpeaking(false) }));
      }}
    >
      {speaking ? "읽기 멈춤" : "읽어 주기"}
    </Button>
  );
}
