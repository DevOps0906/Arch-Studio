// 라이선스 API 오류 코드 → HTTP·문구(04_API.md 1장 응답 봉투, 2.1절, 7.1·7.2절).
// 응답에는 코드별 고정 문구만 넣는다. DB 예외 원문·SQL·스택은 내보내지 않는다.
// 존재 여부 정책: AR002(404, 시리얼 무효)와 AR006(403, 다른 조직)을 04_API대로 구분한다(근거 tasks/logs/AR-06-040.md A11).

export type LicenseErrorCode =
  | "AR001"
  | "AR002"
  | "AR003"
  | "AR004"
  | "AR006"
  | "42501"
  | "P0002"
  | "22023"
  | "unauthorized"
  | "account_inactive"
  | "no_org"
  | "entitlement_expired"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "rate_limited"
  | "license_signing_unavailable"
  | "internal";

interface ErrorSpec {
  status: number;
  message: string;
}

export const ERROR_TABLE: Readonly<Record<LicenseErrorCode, ErrorSpec>> = {
  AR001: { status: 409, message: "활성화할 수 있는 기기 수를 넘었습니다. 계정 화면에서 기존 기기를 해제한 뒤 다시 시도하세요." },
  AR002: { status: 404, message: "시리얼 번호를 확인할 수 없습니다. 입력한 값을 다시 확인하세요." },
  AR003: { status: 403, message: "사용할 수 없는 라이선스입니다(정지·환불·회수). 고객지원에 문의하세요." },
  AR004: { status: 429, message: "셀프 해제 한도(30일 3회)를 넘었습니다. 고객지원에 문의하세요." },
  AR006: { status: 403, message: "현재 조직의 시리얼이 아닙니다. 시리얼을 구매한 조직으로 로그인하세요." },
  "42501": { status: 403, message: "이 작업을 할 권한이 없습니다." },
  P0002: { status: 404, message: "대상을 찾을 수 없습니다." },
  "22023": { status: 422, message: "입력 형식이 올바르지 않습니다." },
  unauthorized: { status: 401, message: "로그인이 필요합니다." },
  account_inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  no_org: { status: 403, message: "조직 정보를 확인할 수 없습니다." },
  entitlement_expired: { status: 402, message: "체험 또는 구독 기간이 끝났습니다. 열람·내보내기는 계속 할 수 있습니다." },
  invalid_json: { status: 400, message: "JSON 형식이 아닙니다." },
  invalid_input: { status: 422, message: "입력 값이 올바르지 않습니다." },
  payload_too_large: { status: 413, message: "요청 본문이 너무 큽니다." },
  rate_limited: { status: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  license_signing_unavailable: { status: 503, message: "지금은 라이선스를 발급할 수 없습니다. 잠시 후 다시 시도하세요." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

export class LicenseApiError extends Error {
  readonly code: LicenseErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: LicenseErrorCode, details?: Record<string, unknown>) {
    super(code);
    this.name = "LicenseApiError";
    this.code = code;
    this.details = details;
  }
}

const DB_CODES = new Set<LicenseErrorCode>(["AR001", "AR002", "AR003", "AR004", "AR006", "42501", "P0002", "22023"]);

/** PostgREST 오류 객체({ code: SQLSTATE }) → 코드. 모르는 코드는 internal. */
export function mapDbError(error: unknown): LicenseErrorCode {
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && DB_CODES.has(code as LicenseErrorCode) ? (code as LicenseErrorCode) : "internal";
}

/** DB 호출 실패를 감싸는 오류(원문은 보관하지 않고 코드만). */
export class DbCallError extends Error {
  readonly code: LicenseErrorCode;
  constructor(error: unknown) {
    const code = mapDbError(error);
    super(`db error ${code}`);
    this.name = "DbCallError";
    this.code = code;
  }
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function errorResponse(code: LicenseErrorCode, details?: Record<string, unknown>, extraHeaders?: Record<string, string>): Response {
  const spec = ERROR_TABLE[code];
  const error = details ? { code, message: spec.message, details } : { code, message: spec.message };
  return new Response(JSON.stringify({ ok: false, error }), { status: spec.status, headers: { ...HEADERS, ...extraHeaders } });
}

export function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}
