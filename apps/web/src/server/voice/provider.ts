// STT 제공자 어댑터(VOICE_ARCHITECTURE.md 2장 계약을 이 작업에 필요한 만큼만). 하나의 인터페이스 뒤에 구현을 둔다.
// oss-voice: 공용 오픈소스 음성 서버 `POST <OSS_VOICE_BASE_URL>/stt`(4장). 인증은 Next.js가 발급한 EdDSA 사용자 토큰(scope=voice)만.
//   요청·응답 필드는 음성 서버 쪽 정본이 아직 없어 가정한 모양이다(multipart audio·language·feature → { text, duration_seconds, model }).
// mock: 외부 호출 없이 결정적 결과(development·test 전용, config.ts가 고른다).
// 오류 원문(URL·토큰·응답 본문)은 예외 메시지에 넣지 않는다.
// server-only를 import하지 않는다(node --test 대상).

export interface SttRequest {
  audio: Uint8Array;
  mime: string;
  language: "ko";
  /** 라우팅 feature(02_ARCHITECTURE.md 5장): 받아쓰기 voice_chat, 상담 consult_recording. */
  feature: "voice_chat" | "consult_recording";
  orgId: string;
  userId: string;
  signal: AbortSignal;
}

export interface SttResult {
  text: string;
  durationSeconds: number;
  provider: "oss-voice" | "mock";
  model: string;
}

export interface SttProvider {
  readonly name: "oss-voice" | "mock";
  transcribe(req: SttRequest): Promise<SttResult>;
}

export class SttProviderError extends Error {
  constructor(reason: string) {
    super(`stt provider failed: ${reason}`);
    this.name = "SttProviderError";
  }
}

export interface OssVoiceOptions {
  baseUrl: string;
  /** 사용자 voice 토큰 발급(요청마다 새로). 키가 없으면 throw → 실패 닫힘. */
  issueToken(orgId: string, userId: string): string;
  fetch: typeof fetch;
}

const MAX_TEXT = 20_000;

export function ossVoiceProvider(opts: OssVoiceOptions): SttProvider {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/stt`;
  return {
    name: "oss-voice",
    async transcribe(req) {
      let token: string;
      try {
        token = opts.issueToken(req.orgId, req.userId);
      } catch {
        throw new SttProviderError("token");
      }
      const form = new FormData();
      form.set("audio", new Blob([req.audio as BlobPart], { type: req.mime }), "audio");
      form.set("language", req.language);
      form.set("feature", req.feature);
      let res: Response;
      try {
        res = await opts.fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, signal: req.signal });
      } catch {
        throw new SttProviderError("network");
      }
      if (!res.ok) throw new SttProviderError(`status_${res.status}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new SttProviderError("body");
      }
      const b = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const text = b["text"];
      const duration = b["duration_seconds"] ?? b["durationSeconds"];
      const model = b["model"];
      if (typeof text !== "string" || text.length > MAX_TEXT) throw new SttProviderError("text");
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) throw new SttProviderError("duration");
      return { text, durationSeconds: duration, provider: "oss-voice", model: typeof model === "string" ? model.slice(0, 120) : "unknown" };
    },
  };
}

/** 개발 전용: 바이트 수로 길이를 정하는 결정적 가짜(16KB = 1초, 최소 1초). */
export function mockSttProvider(): SttProvider {
  return {
    name: "mock",
    async transcribe(req) {
      if (req.signal.aborted) throw new SttProviderError("aborted");
      const seconds = Math.max(1, Math.round(req.audio.byteLength / 16_384));
      return { text: "모의 받아쓰기 결과입니다.", durationSeconds: seconds, provider: "mock", model: "mock-stt-v1" };
    },
  };
}
