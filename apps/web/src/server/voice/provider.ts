// STT 제공자 프로토콜(AR-06-053 [DECISION] 6). 실제 제공자(oss-voice)·토큰 발급 연결은 후속, 여기는 가짜만.
// 제공자는 max_seconds를 넘는 오디오를 잘라야 한다. 서비스는 돌려받은 durationS가 상한을 넘으면 결과를 버리고 전액 환불한다.
import { createHash } from "node:crypto";

/** 서비스가 제공자에게 허용하는 최대 길이(초). 04_API.md:87. */
export const STT_MAX_SECONDS = 60;

export interface SttRequest {
  audio: Uint8Array;
  mime: string;
  maxSeconds: number;
  /** scope=voice 단기 토큰(공급 함수가 만든 값). 로그·응답에 넣지 않는다. */
  token: string;
}

export interface SttResult {
  text: string;
  durationS: number;
}

export interface SttProvider {
  transcribe(req: SttRequest): Promise<SttResult>;
}

/** 토큰 공급 함수(주입). 조직·행위자는 세션에서만 온다. */
export type SttTokenSupplier = (ctx: { orgId: string; userId: string }) => Promise<string>;

/** 결정적 가짜: 길이는 바이트/16000(올림, 상한 max_seconds), 텍스트는 해시 앞 8자. 빈 오디오는 빈 전사. */
export function fakeSttProvider(): SttProvider {
  return {
    async transcribe(req) {
      if (req.audio.byteLength === 0) return { text: "", durationS: 0 };
      const durationS = Math.min(req.maxSeconds, Math.ceil(req.audio.byteLength / 16000));
      const hex = createHash("sha256").update(req.audio).digest("hex").slice(0, 8);
      return { text: `가짜 전사 ${hex}`, durationS };
    },
  };
}
