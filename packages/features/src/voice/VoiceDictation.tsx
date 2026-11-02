// 음성 받아쓰기 입력(03장 3.12절): 고지 → 녹음(경과·남은 시간) → 변환 텍스트 미리보기·수정 → 입력창에 넣기.
// 결과는 입력창에 채우기만 하고 자동 전송하지 않는다. 권한 거부·미지원·서비스 꺼짐이어도 텍스트 입력은 그대로 쓴다.
import { Banner, Button, Spinner } from "@arch-studio/ui";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { useApi } from "../shell/index.ts";
import { micSupported, startMicRecording } from "./browser.ts";
import { createDictation, type Dictation } from "./dictation.ts";
import * as M from "./messages.ts";
import { transcribeAudio } from "./transcribe.ts";

let noticeAcceptedInSession = false; // 고지는 앱을 연 동안 처음 한 번

export function VoiceDictation({ onInsert, disabled = false }: { onInsert: (text: string) => void; disabled?: boolean }) {
  const api = useApi();
  const dictation: Dictation = useMemo(
    () =>
      createDictation(
        {
          supported: micSupported,
          startRecording: startMicRecording,
          transcribe: (audio, contentType, requestId, signal) => transcribeAudio(api, audio, contentType, requestId, signal),
          newRequestId: () => api.newIdempotencyKey(),
          setTimer: (fn, ms) => setTimeout(fn, ms),
          clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
          now: () => Date.now(),
        },
        { noticeAccepted: noticeAcceptedInSession },
      ),
    [api],
  );
  useEffect(() => () => dictation.dispose(), [dictation]);
  const state = useSyncExternalStore(dictation.subscribe, dictation.state);
  const [draft, setDraft] = useState("");
  const draftId = useId();
  useEffect(() => {
    if (state.kind === "result") setDraft(state.text);
  }, [state]);

  return (
    <div className="flex flex-col gap-gap">
      {state.kind === "idle" || state.kind === "fallback" || state.kind === "error" || state.kind === "result" ? (
        <div>
          <Button size="sm" disabled={disabled || state.kind === "result"} onClick={() => dictation.start()} icon="mic">
            {M.RECORD_START}
          </Button>
        </div>
      ) : null}

      {state.kind === "notice" ? (
        <Banner
          tone="info"
          title={M.VOICE_NOTICE_TITLE}
          action={
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  noticeAcceptedInSession = true;
                  dictation.acceptNotice();
                }}
              >
                {M.VOICE_NOTICE_ACCEPT}
              </Button>
              <Button size="sm" onClick={() => dictation.declineNotice()}>
                {M.VOICE_NOTICE_CANCEL}
              </Button>
            </div>
          }
        >
          {M.VOICE_NOTICE_BODY}
        </Banner>
      ) : null}

      {state.kind === "requesting" ? (
        <div role="status" className="flex items-center gap-2 text-caption text-fg-2">
          <Spinner />
          마이크 권한을 확인하는 중
        </div>
      ) : null}

      {state.kind === "recording" ? (
        <Recording startedAt={state.startedAt} maxMs={state.maxMs} onStop={() => dictation.stop()} onCancel={() => dictation.cancel()} />
      ) : null}

      {state.kind === "transcribing" ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-caption text-fg-2">
          <Spinner />
          {M.TRANSCRIBING}
          <Button size="sm" onClick={() => dictation.cancel()}>
            {M.TRANSCRIBE_CANCEL}
          </Button>
        </div>
      ) : null}

      {state.kind === "fallback" ? (
        <Banner tone={state.reason === "disabled" ? "info" : "warn"} title="텍스트로 입력해 주세요">
          {state.message}
        </Banner>
      ) : null}

      {state.kind === "error" ? (
        <Banner
          tone="danger"
          title="받아쓰기를 마치지 못했습니다"
          action={
            state.canResend ? (
              <Button size="sm" onClick={() => dictation.resend()}>
                {M.RETRY_SEND}
              </Button>
            ) : undefined
          }
        >
          {state.message}
        </Banner>
      ) : null}

      {state.kind === "result" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={draftId} className="text-caption text-fg-2">
            {M.RESULT_LABEL}
          </label>
          <textarea
            id={draftId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="focus-ring w-full rounded-control border border-input bg-surface p-3 text-body text-fg"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={draft.trim() === ""}
              onClick={() => {
                onInsert(draft.trim());
                dictation.reset();
              }}
            >
              {M.RESULT_APPLY}
            </Button>
            <Button size="sm" onClick={() => dictation.reset()}>
              {M.RESULT_DISCARD}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Recording({ startedAt, maxMs, onStop, onCancel }: { startedAt: number; maxMs: number; onStop: () => void; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, []);
  const elapsed = Math.min(maxMs, Math.max(0, now - startedAt));
  const sec = Math.floor(elapsed / 1000);
  const left = Math.max(0, Math.ceil((maxMs - elapsed) / 1000));
  return (
    <div className="flex flex-wrap items-center gap-2" role="status">
      <span aria-hidden="true" className="size-2 rounded-full bg-danger" />
      <span className="text-body font-semibold text-danger">{M.RECORDING}</span>
      <span className="text-num tabular-nums text-fg-2">
        {sec}초 · 남은 {left}초
      </span>
      <Button size="sm" variant="primary" onClick={onStop}>
        {M.RECORD_STOP}
      </Button>
      <Button size="sm" onClick={onCancel}>
        {M.RECORD_CANCEL}
      </Button>
    </div>
  );
}
