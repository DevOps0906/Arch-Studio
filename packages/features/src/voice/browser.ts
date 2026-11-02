// 브라우저 API 연결(MediaRecorder·getUserMedia·speechSynthesis). 로직 없음: 테스트는 dictation.ts·speech.ts에서 한다.
import type { RecordingHandle } from "./dictation.ts";
import type { SynthLike, UtteranceLike } from "./speech.ts";

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export async function startMicRecording(): Promise<RecordingHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = (): void => stream.getTracks().forEach((t) => t.stop());
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream);
  } catch (e) {
    release();
    throw e;
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  const done = new Promise<{ audio: Blob; contentType: string }>((resolve, reject) => {
    rec.onstop = () => {
      const contentType = (rec.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
      resolve({ audio: new Blob(chunks, { type: rec.mimeType || contentType }), contentType });
    };
    rec.onerror = () => reject(new Error("recorder"));
  });
  rec.start();
  return {
    stop: () => {
      if (rec.state !== "inactive") rec.stop();
    },
    done,
    release,
  };
}

export function browserSynth(): SynthLike | null {
  return typeof speechSynthesis === "undefined" ? null : (speechSynthesis as unknown as SynthLike);
}

export function browserUtterance(text: string): UtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
}
