// 오디오 형식 판별(매직바이트). 클라이언트가 보낸 MIME·확장자는 믿지 않는다.
// 허용 형식 = 업로드 정책 consult_audio 확장자(m4a·webm·ogg·wav)와 같은 범위. voice-audio 버킷 allowed_mime_types와도 맞는다.
// server-only를 import하지 않는다(node --test 대상).

export type AudioKind = "webm" | "ogg" | "wav" | "m4a";

export const AUDIO_MIME: Readonly<Record<AudioKind, string>> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
};

/** 판별에 필요한 앞 바이트 수. */
export const AUDIO_HEAD_BYTES = 12;

function ascii(b: Uint8Array, at: number, text: string): boolean {
  if (b.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function sniffAudio(head: Uint8Array): AudioKind | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm"; // EBML
  if (ascii(head, 0, "OggS")) return "ogg";
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WAVE")) return "wav";
  if (ascii(head, 4, "ftyp")) return "m4a";
  return null;
}
