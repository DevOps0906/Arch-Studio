// 오디오 매직바이트 확인(Content-Type 위조 방지). 형식 4종: webm·ogg·mp4·wav.
export const VOICE_MIMES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"] as const;
export type VoiceMime = (typeof VOICE_MIMES)[number];

const ascii = (b: Uint8Array, at: number, s: string): boolean => b.byteLength >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

export function matchesMagic(mime: VoiceMime, b: Uint8Array): boolean {
  switch (mime) {
    case "audio/webm":
      return b.byteLength >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case "audio/ogg":
      return ascii(b, 0, "OggS");
    case "audio/mp4":
      return ascii(b, 4, "ftyp");
    case "audio/wav":
      return ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE");
  }
}

/** Content-Type 헤더에서 파라미터(codecs 등)를 떼고 허용 목록과 대조. */
export function parseVoiceMime(header: string | null): VoiceMime | null {
  const base = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return (VOICE_MIMES as readonly string[]).includes(base) ? (base as VoiceMime) : null;
}
