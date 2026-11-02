// 클라우드 사본 API 오류 코드 → HTTP·고정 문구(04_API.md 1장 응답 봉투, 2.1절 cloud-projects 행, 7.1절 AR040·AR041).
// 응답에는 코드별 고정 문구만 넣는다. DB·Storage 예외 원문·SQL·경로·이름·토큰은 내보내지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { GatewayError } from "../ai/gateway/http.ts";

export type CloudErrorCode =
  | "unauthorized"
  | "account_inactive"
  | "no_org"
  | "entitlement_expired"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "rate_limited"
  | "not_found"
  | "not_implemented"
  | "storage_unavailable"
  | "AR031"
  | "AR040"
  | "AR041"
  | "AR044"
  | "42501"
  | "22023"
  | "23505"
  | "23514"
  | "internal";

interface ErrorSpec {
  status: number;
  message: string;
}

export const CLOUD_ERRORS: Readonly<Record<CloudErrorCode, ErrorSpec>> = {
  unauthorized: { status: 401, message: "인증이 필요합니다." },
  account_inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  no_org: { status: 403, message: "조직 정보를 확인할 수 없습니다." },
  entitlement_expired: { status: 402, message: "편집 권한이 없어 저장하지 못했습니다. 열람·내보내기·프로젝트 내려받기는 계속 할 수 있습니다." },
  invalid_json: { status: 400, message: "JSON 형식이 아닙니다." },
  invalid_input: { status: 422, message: "입력 값이 올바르지 않습니다." },
  payload_too_large: { status: 413, message: "요청 본문이 너무 큽니다." },
  rate_limited: { status: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  not_found: { status: 404, message: "대상을 찾을 수 없습니다." },
  not_implemented: { status: 501, message: "아직 제공하지 않는 경로입니다." },
  storage_unavailable: { status: 503, message: "지금은 업로드를 확인할 수 없습니다. 잠시 후 다시 시도하세요." },
  AR031: { status: 413, message: "보내는 파일이 너무 큽니다." },
  AR040: { status: 403, message: "클라우드 사본 개수 한도에 도달했습니다. 오래된 사본을 지우세요." },
  AR041: { status: 409, message: "다른 곳에서 이 프로젝트가 먼저 저장되었습니다. 병합하지 않습니다. 저장하지 않았습니다." },
  // DB 권리 없음(04_API 7.1절). 저장 경로는 service.ts가 entitlement_expired 402로 바꾼다. 여기 값은 같은 402 문구.
  AR044: { status: 402, message: "편집 권한이 없어 저장하지 못했습니다. 열람·내보내기·프로젝트 내려받기는 계속 할 수 있습니다." },
  "42501": { status: 403, message: "이 작업을 할 권한이 없습니다." },
  "22023": { status: 422, message: "입력 형식이 올바르지 않습니다." },
  "23505": { status: 409, message: "이 로컬 프로젝트의 클라우드 사본이 이미 있습니다. 목록에서 기존 사본을 여세요." },
  "23514": { status: 422, message: "업로드 경로가 올바르지 않습니다." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

export class CloudApiError extends Error {
  readonly code: CloudErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(code: CloudErrorCode, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(code); // 메시지 = 코드만
    this.name = "CloudApiError";
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

/**
 * DB 호출 실패(저장소 구현이 던진다). 원문은 보관하지 않고 코드와 안전한 숫자만:
 * AR041이면 currentVersion, AR040이면 max(조직 상한). 073 구현은 PostgREST 오류를 이 모양으로 바꿔 던진다.
 */
export class CloudDbError extends Error {
  readonly code: CloudErrorCode;
  readonly currentVersion: number | undefined;
  readonly max: number | undefined;
  constructor(code: CloudErrorCode, extra: { currentVersion?: number; max?: number } = {}) {
    super(`db error ${code}`);
    this.name = "CloudDbError";
    this.code = code;
    this.currentVersion = Number.isSafeInteger(extra.currentVersion) ? extra.currentVersion : undefined;
    this.max = Number.isSafeInteger(extra.max) ? extra.max : undefined;
  }
}

const DB_CODES = new Set<CloudErrorCode>(["AR031", "AR040", "AR041", "AR044", "42501", "22023", "23505", "23514"]);

/** PostgREST 오류 객체({ code: SQLSTATE }) → 코드. P0002는 not_found, 모르는 코드는 internal. */
export function mapCloudDbError(error: unknown): CloudErrorCode {
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "P0002") return "not_found";
  return typeof code === "string" && DB_CODES.has(code as CloudErrorCode) ? (code as CloudErrorCode) : "internal";
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function cloudErrorResponse(code: CloudErrorCode, details?: Record<string, unknown>, extra?: Record<string, string>): Response {
  const spec = CLOUD_ERRORS[code];
  const error = details ? { code, message: spec.message, details } : { code, message: spec.message };
  return new Response(JSON.stringify({ ok: false, error }), { status: spec.status, headers: { ...HEADERS, ...extra } });
}

export function cloudOk(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}

/** 공용 게이트(세션·본문 읽기)가 던진 GatewayError 코드 중 이 표에 있는 것만 그대로, 나머지는 internal. */
export function codeOf(error: unknown): CloudErrorCode {
  if (error instanceof CloudApiError || error instanceof CloudDbError) return error.code;
  if (error instanceof GatewayError && error.code in CLOUD_ERRORS) return error.code as CloudErrorCode;
  return "internal";
}

/** 예외 → 응답. 알 수 없는 예외는 internal(원문은 버린다). */
export function toCloudResponse(error: unknown): Response {
  if (error instanceof CloudApiError) return cloudErrorResponse(error.code, error.details, error.headers);
  if (error instanceof GatewayError) return cloudErrorResponse(codeOf(error), undefined, error.headers);
  return cloudErrorResponse(codeOf(error));
}
