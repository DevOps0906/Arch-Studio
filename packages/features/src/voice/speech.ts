// 읽어 주기: OS 음성 합성(speechSynthesis). 서버 미사용, 0 크레딧. 한국어 음성이 없으면 버튼을 숨긴다.
export interface VoiceLike {
  readonly lang: string;
  readonly name: string;
}

export interface UtteranceLike {
  lang: string;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  getVoices(): readonly VoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

/** ko, ko-KR, ko_KR 모두 한국어로 본다. 없으면 null → 버튼 숨김. */
export function pickKoreanVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  return voices.find((v) => /^ko([-_]|$)/i.test(v.lang)) ?? null;
}

export interface Speaker {
  /** 한국어 음성이 있을 때만 true(읽어 주기 버튼 표시 조건). */
  available(): boolean;
  speak(text: string, onEnd: () => void): void;
  cancel(): void;
}

export function createSpeaker(synth: SynthLike | null, makeUtterance: (text: string) => UtteranceLike): Speaker {
  return {
    available: () => synth !== null && pickKoreanVoice(synth.getVoices()) !== null,
    speak(text, onEnd) {
      if (!synth) return onEnd();
      const voice = pickKoreanVoice(synth.getVoices());
      if (!voice || text.trim() === "") return onEnd();
      synth.cancel();
      const u = makeUtterance(text);
      u.lang = "ko-KR";
      u.voice = voice;
      u.onend = onEnd;
      u.onerror = onEnd;
      synth.speak(u);
    },
    cancel: () => synth?.cancel(),
  };
}
