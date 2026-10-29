// AI 게이트·업로드·잡 조회 공용 HTTP 도우미(04_API.md 1장 응답 봉투, 7장 오류 코드).
// 응답에는 코드별 고정 문구만 넣는다. DB·Storage 예외 원문·SQL·스택·경로·토큰은 내보내지 않는다.
// server-only를 import하지 않는다(node --test 대상).

export type GatewayErrorCode =
  | "unauthorized"
  | "account_inactive"
  | "no_org"
  | "entitlement_expired"
  | "feature_unavailable"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "not_found"
  | "job_not_running"
  | "scope_mismatch"
  | "worker_key_unconfigured"
  | "token_signing_unavailable"
  | "storage_unavailable"
  | "not_implemented"
  | "AR012"
  | "AR030"
  | "AR031"
  | "AI_DAILY_LIMIT"
  | "CR001"
  | "42501"
  | "22023"
  | "23514"
  | "internal";

interface ErrorSpec {
  status: number;
  message: string;
}

export const GATEWAY_ERRORS: Readonly<Record<GatewayErrorCode, ErrorSpec>> = {
  unauthorized: { status: 401, message: "인증이 필요합니다." },
  account_inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  no_org: { status: 403, message: "조직 정보를 확인할 수 없습니다." },
  entitlement_expired: { status: 402, message: "체험 또는 구독 기간이 끝났습니다. 열람·내보내기는 계속 할 수 있습니다." },
  feature_unavailable: { status: 402, message: "현재 플랜에서 쓸 수 없는 기능입니다." },
  invalid_json: { status: 400, message: "JSON 형식이 아닙니다." },
  invalid_input: { status: 422, message: "입력 값이 올바르지 않습니다." },
  payload_too_large: { status: 413, message: "요청 본문이 너무 큽니다." },
  unsupported_media_type: { status: 415, message: "허용하지 않는 파일 형식입니다." },
  rate_limited: { status: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  not_found: { status: 404, message: "대상을 찾을 수 없습니다." },
  job_not_running: { status: 409, message: "실행 중인 작업이 아닙니다." },
  scope_mismatch: { status: 403, message: "이 작업에 허용되지 않는 범위입니다." },
  worker_key_unconfigured: { status: 503, message: "내부 경로를 사용할 수 없습니다." },
  token_signing_unavailable: { status: 503, message: "지금은 토큰을 발급할 수 없습니다." },
  storage_unavailable: { status: 503, message: "지금은 업로드를 준비할 수 없습니다. 잠시 후 다시 시도하세요." },
  not_implemented: { status: 501, message: "아직 제공하지 않는 경로입니다." },
  AR012: { status: 403, message: "현재 상태에서는 클라우드 검토를 쓸 수 없습니다." },
  AR030: { status: 429, message: "동시에 진행할 수 있는 렌더 수를 넘었습니다." },
  AR031: { status: 413, message: "입력 크기가 상한을 넘었습니다." },
  AI_DAILY_LIMIT: { status: 429, message: "오늘의 AI 사용 한도에 도달했습니다. 크레딧은 차감되지 않았습니다." },
  CR001: { status: 402, message: "크레딧이 부족합니다." },
  "42501": { status: 403, message: "이 작업을 할 권한이 없습니다." },
  "22023": { status: 422, message: "입력 형식이 올바르지 않습니다." },
  "23514": { status: 422, message: "입력 경로가 올바르지 않습니다." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(code: GatewayErrorCode, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(code); // 메시지 = 코드만(원문·값 없음)
    this.name = "GatewayError";
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function errorResponse(code: GatewayErrorCode, details?: Record<string, unknown>, extra?: Record<string, string>): Response {
  const spec = GATEWAY_ERRORS[code];
  const error = details ? { code, message: spec.message, details } : { code, message: spec.message };
  return new Response(JSON.stringify({ ok: false, error }), { status: spec.status, headers: { ...HEADERS, ...extra } });
}

export function okResponse(data: unknown, status = 200, extraTop?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, data, ...extraTop }), { status, headers: HEADERS });
}

/** 예외 → 응답. GatewayError가 아니면 internal(원문은 버린다). */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof GatewayError) return errorResponse(error.code, error.details, error.headers);
  return errorResponse("internal");
}

/** 본문을 maxBytes까지만 읽어 JSON으로. 넘으면 413(payload_too_large), 깨지면 400. */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new GatewayError("payload_too_large");
  const chunks: Uint8Array[] = [];
  if (req.body) {
    const reader = req.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GatewayError("payload_too_large");
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    throw new GatewayError("invalid_json");
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** UUID v4(소문자 정규 표기). */
export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
