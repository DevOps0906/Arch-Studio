// 구조화된 API 오류. 원 응답 본문·요청 본문·토큰·서버 message 원문을 담지 않는다.
import { errorInfoFor, isKnownCode } from "./error-messages.ts";

/** 화면이 써도 되는 details 필드만 통과(04장 7.1·1장: reason, can_download, required, balance, available_at). */
export interface SafeDetails {
  readonly reason?: string;
  readonly can_download?: boolean;
  readonly required?: number;
  readonly balance?: number;
  readonly available_at?: string;
}

export function pickSafeDetails(raw: unknown): SafeDetails | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof SafeDetails]: SafeDetails[K] } = {};
  if (typeof r["reason"] === "string" && r["reason"].length <= 40) out.reason = r["reason"];
  if (typeof r["can_download"] === "boolean") out.can_download = r["can_download"];
  if (Number.isSafeInteger(r["required"])) out.required = r["required"] as number;
  if (Number.isSafeInteger(r["balance"])) out.balance = r["balance"] as number;
  if (typeof r["available_at"] === "string" && r["available_at"].length <= 40) out.available_at = r["available_at"];
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface ApiErrorInit {
  readonly code: string;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly details?: SafeDetails;
}

export class ApiError extends Error {
  readonly code: string;
  /** 네트워크 오류·취소 등 응답이 없으면 null. */
  readonly httpStatus: number | null;
  /** 시간이 지나거나 다시 눌러 성공할 수 있는가(자동 재시도 여부와는 별개: 소진 뒤에도 true일 수 있다). */
  readonly retryable: boolean;
  readonly userMessage: string;
  readonly actions: readonly string[];
  readonly details: SafeDetails | undefined;

  constructor(init: ApiErrorInit) {
    super(`ApiError ${init.code}`); // message에는 코드만. 본문·서버 문구 금지.
    this.name = "ApiError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.retryable = init.retryable;
    this.details = init.details;
    const i = errorInfoFor(init.code, init.details);
    this.userMessage = i.message;
    this.actions = i.actions;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, httpStatus: this.httpStatus, retryable: this.retryable, userMessage: this.userMessage };
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** 이 코드는 서버가 확정적으로 거절한 것이라 같은 요청을 자동으로 다시 보내지 않는다. */
const AUTO_RETRY_CODES = new Set(["rate_limited", "AI_UNAVAILABLE"]);

/** 자동 재시도 여부: 네트워크 오류(status null)·408·5xx·429는 재시도, 알려진 AR/CR/AI 코드가 붙은 응답은 재시도 안 함. */
export function isAutoRetryable(status: number | null, code: string | null): boolean {
  if (code !== null && isKnownCode(code) && !AUTO_RETRY_CODES.has(code)) return false;
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** HTTP 상태만으로 만든 코드(본문에 코드가 없을 때). */
export function codeFromStatus(status: number): string {
  if (status === 401) return "unauthenticated";
  if (status === 402) return "entitled_false";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return `http_${status}`;
}
