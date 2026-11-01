// 대지 조회 응답 봉투·오류 코드(04_API.md 1장 봉투, 2.1절 site lookup, 7.1절 AR020·AR021).
// 응답에는 코드별 고정 문구만 넣는다. 주소·PNU·제공자 원문·URL·키는 어떤 오류에도 보간하지 않는다(로그 A2·A6).
// server-only를 import하지 않는다(node --test 대상).

export type SiteErrorCode =
  | "unauthorized"
  | "account_inactive"
  | "no_org"
  | "entitlement_expired"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "rate_limited"
  | "site_lookup_unavailable"
  | "site_map_disabled"
  | "method_not_allowed"
  | "invalid_tile"
  | "AR020"
  | "AR021"
  | "42501"
  | "internal";

/** AR021 세부 사유(화면은 모두 "직접 그리기"로 잇는다). */
export type ProviderFailReason =
  | "not_configured" // VWORLD_API_KEY 없음(D-14 확인 전 기본)
  | "not_found" // 제공자가 결과 없음
  | "timeout" // 호출 타임아웃·전체 마감 초과
  | "network" // 연결 실패
  | "http_status" // 제공자 HTTP 오류
  | "too_large" // 응답 크기 상한 초과
  | "invalid_response"; // 형식·좌표 이상

interface ErrorSpec {
  status: number;
  message: string;
}

export const SITE_ERRORS: Readonly<Record<SiteErrorCode, ErrorSpec>> = {
  unauthorized: { status: 401, message: "인증이 필요합니다." },
  account_inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  no_org: { status: 403, message: "조직 정보를 확인할 수 없습니다." },
  entitlement_expired: { status: 402, message: "체험 또는 구독 기간이 끝났습니다. 열람·내보내기는 계속 할 수 있습니다." },
  invalid_json: { status: 400, message: "JSON 형식이 아닙니다." },
  invalid_input: { status: 422, message: "주소·지번 형식이 올바르지 않습니다." },
  payload_too_large: { status: 413, message: "요청 본문이 너무 큽니다." },
  rate_limited: { status: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  site_lookup_unavailable: { status: 503, message: "지금은 대지 조회를 쓸 수 없습니다. 직접 그리기로 이어 가세요." },
  site_map_disabled: { status: 503, message: "지금은 지도·주소 검색을 쓸 수 없습니다. 직접 그리기로 이어 가세요." },
  method_not_allowed: { status: 405, message: "허용하지 않는 요청 방식입니다." },
  invalid_tile: { status: 404, message: "지도 타일 범위를 벗어났습니다." },
  AR020: { status: 429, message: "오늘 대지 조회 한도를 모두 썼습니다. 직접 그리기로 이어 가세요." },
  AR021: { status: 502, message: "공공 데이터 서비스가 응답하지 않습니다. 잠시 뒤 다시 조회하거나 직접 그리세요." },
  "42501": { status: 403, message: "이 작업을 할 권한이 없습니다." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

export class SiteError extends Error {
  readonly code: SiteErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(code: SiteErrorCode, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(code); // 메시지 = 코드만
    this.name = "SiteError";
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

/** 공공 API 실패(AR021). `next: "draw"`는 화면이 직접 그리기로 이어 가라는 안내(04_API 2.1 "앱은 직접 그리기로 이동"). */
export function providerError(reason: ProviderFailReason): SiteError {
  return new SiteError("AR021", { reason, next: "draw" });
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function siteErrorResponse(error: unknown): Response {
  const e = error instanceof SiteError ? error : new SiteError("internal");
  const spec = SITE_ERRORS[e.code];
  const body = e.details ? { code: e.code, message: spec.message, details: e.details } : { code: e.code, message: spec.message };
  return new Response(JSON.stringify({ ok: false, error: body }), { status: spec.status, headers: { ...HEADERS, ...e.headers } });
}

export function siteOkResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}
