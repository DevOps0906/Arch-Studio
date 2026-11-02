// POST /api/voice/stt 호출(04장). 본문=오디오 바이트(Content-Type audio/*), 헤더 x-request-id(UUID v4).
// 같은 녹음을 다시 보낼 때는 같은 requestId를 쓴다(서버 멱등 키 voice:<org>:<request_id>).
import { isApiError, type AbortSignalLike, type ApiClient, type BinaryBody } from "../api-client/index.ts";
import { STT_DISABLED, STT_FAILED, STT_REPLAY, STT_TOO_LARGE } from "./messages.ts";

export interface SttResult {
  readonly text: string;
  readonly durationS: number;
}

/** 서버 응답에서 화면이 쓰는 값만 꺼낸다. credits 등 나머지는 읽지 않는다. */
export function parseSttResponse(data: unknown): SttResult {
  if (typeof data !== "object" || data === null) throw new Error("invalid");
  const r = data as Record<string, unknown>;
  if (typeof r["text"] !== "string") throw new Error("invalid");
  const d = r["duration_s"];
  return { text: r["text"], durationS: typeof d === "number" && Number.isFinite(d) ? d : 0 };
}

export function transcribeAudio(
  api: ApiClient,
  audio: BinaryBody,
  contentType: string,
  requestId: string,
  signal?: AbortSignalLike,
): Promise<SttResult> {
  return api.request<SttResult>({
    method: "POST",
    path: "/api/voice/stt",
    rawBody: audio,
    contentType: contentType.startsWith("audio/") ? contentType : "audio/webm",
    headers: { "x-request-id": requestId },
    idempotencyKey: requestId,
    autoRetry: false, // 과금 경로: 자동 재시도 없이 사용자가 같은 녹음으로 다시 보낸다
    parse: parseSttResponse,
    ...(signal ? { signal } : {}),
  });
}

export type SttFailure =
  | { readonly kind: "disabled"; readonly message: string } // 503: 텍스트 입력으로 계속
  | { readonly kind: "replay"; readonly message: string } // 409: 이미 처리됨, 같은 녹음 재전송 무의미
  | { readonly kind: "error"; readonly message: string; readonly retryable: boolean };

/** 오류 → 화면 처리. 상태 코드가 우선이고 문구는 우리 표(서버 원문 미사용). */
export function classifySttError(e: unknown): SttFailure {
  if (!isApiError(e)) return { kind: "error", message: STT_FAILED, retryable: true };
  if (e.httpStatus === 503) return { kind: "disabled", message: STT_DISABLED };
  if (e.httpStatus === 409 || e.code === "IDEMPOTENT_REPLAY") return { kind: "replay", message: STT_REPLAY };
  if (e.httpStatus === 413 || e.code === "AR031" || e.code === "VOICE_TOO_LONG") return { kind: "error", message: STT_TOO_LARGE, retryable: false };
  if (e.httpStatus === 402) return { kind: "error", message: e.userMessage, retryable: false };
  return { kind: "error", message: e.userMessage || STT_FAILED, retryable: e.retryable };
}
