// 상담 녹음 STT 제공자 인터페이스. 정본 제공자는 oss-voice만(오픈소스 강제, 대체 없음, 04_API.md 4.5절·12장).
// oss-voice 구현은 voice scope 잡 토큰 발급 경로가 생긴 뒤 이 뒤에 붙인다(config.ts). 지금은 개발용 mock만.
export interface ConsultSttRequest {
  audio: Uint8Array;
  mime: string;
  language: "ko";
  signal: AbortSignal;
}

export interface ConsultSttResult {
  text: string;
  durationSeconds: number;
}

export interface ConsultSttProvider {
  readonly name: string;
  readonly model: string;
  transcribe(req: ConsultSttRequest): Promise<ConsultSttResult>;
}

/** 개발 전용: 바이트 수로 길이를 정하는 결정적 가짜(16KB = 1초, 최소 1초). 외부 호출 없음. */
export function mockConsultSttProvider(): ConsultSttProvider {
  return {
    name: "mock",
    model: "mock-stt-v1",
    async transcribe(req) {
      if (req.signal.aborted) throw req.signal.reason;
      return { text: "모의 상담 전사본입니다.", durationSeconds: Math.max(1, Math.round(req.audio.byteLength / 16_384)) };
    },
  };
}
