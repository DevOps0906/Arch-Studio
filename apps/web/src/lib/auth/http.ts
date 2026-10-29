// 인증 Route Handler 공용: 응답 봉투(04_API.md 1장), 고정 문구 오류 표, 본문 상한 읽기, 출처 검사.
// 응답에는 코드별 고정 문구만 넣는다(DB·Auth 원문·이메일·토큰 미포함).

export type AuthErrorCode =
  | "unauthorized"
  | "login_failed"
  | "no_profile"
  | "provider"
  | "pending"
  | "suspended"
  | "inactive"
  | "forbidden_origin"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "unsupported_media_type"
  | "internal";

export const AUTH_ERRORS: Readonly<Record<AuthErrorCode, { status: number; message: string }>> = {
  unauthorized: { status: 401, message: "로그인이 필요합니다." },
  login_failed: { status: 401, message: "로그인하지 못했습니다. 다시 시도하세요." },
  // 04_API: 프로필 없음은 next '/login'(앱이 로그아웃). 03장 2.1 4단계 문구.
  no_profile: { status: 401, message: "계정 정보를 만들지 못했습니다. 다시 로그인하세요." },
  provider: { status: 403, message: "이 앱에서 쓰지 않는 로그인 방법입니다. Google 또는 이메일로 로그인하세요." },
  pending: { status: 403, message: "가입 승인을 기다리는 계정입니다." },
  suspended: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  forbidden_origin: { status: 403, message: "허용되지 않은 요청입니다." },
  invalid_json: { status: 400, message: "JSON 형식이 아닙니다." },
  invalid_input: { status: 422, message: "입력 값이 올바르지 않습니다." },
  payload_too_large: { status: 413, message: "요청 본문이 너무 큽니다." },
  unsupported_media_type: { status: 415, message: "지원하지 않는 요청 형식입니다." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

export class AuthHttpError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthHttpError";
    this.code = code;
  }
}

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } as const;

export function authError(code: AuthErrorCode, extra?: Record<string, unknown>): Response {
  const spec = AUTH_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message }, ...extra }), {
    status: spec.status,
    headers: HEADERS,
  });
}

export function authOk(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS });
}

/** 존재를 숨기는 404(Next 기본 404와 같은 의미, 본문 없음). */
export function hiddenNotFound(): Response {
  return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
}

export const MAX_AUTH_BODY_BYTES = 2048;

/** 본문을 상한까지만 읽는다. 넘으면 413. */
export async function readBodyText(req: Request, max = MAX_AUTH_BODY_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) throw new AuthHttpError("payload_too_large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new AuthHttpError("payload_too_large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

export type BodyKind = "json" | "form";

export function bodyKind(req: Request): BodyKind | null {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (type === "application/json") return "json";
  if (type === "application/x-www-form-urlencoded") return "form";
  return null;
}

/** JSON 또는 폼 본문 → 평범한 객체(문자열 값). 같은 키 반복은 거부. */
export async function readAuthBody(req: Request, allowForm: boolean): Promise<{ kind: BodyKind; value: Record<string, unknown> }> {
  const kind = bodyKind(req);
  if (!kind || (kind === "form" && !allowForm)) throw new AuthHttpError("unsupported_media_type");
  const text = await readBodyText(req);
  if (kind === "json") {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AuthHttpError("invalid_json");
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthHttpError("invalid_input");
    return { kind, value: value as Record<string, unknown> };
  }
  const params = new URLSearchParams(text);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) {
    if (k in out) throw new AuthHttpError("invalid_input");
    out[k] = v;
  }
  return { kind, value: out };
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * 같은 출처 요청만(CSRF). Origin 필수, 요청 URL의 origin과 같아야 한다. Sec-Fetch-Site가 있으면 same-origin만.
 * 로컬 전용 경로(`/api/dev/login`)에 쓴다.
 */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  try {
    const o = new URL(origin);
    if (o.protocol !== "http:" && o.protocol !== "https:") return false;
    // Next 서버의 req.url 호스트는 바인딩 주소로 바뀔 수 있어(예: localhost) 브라우저가 보낸 Host와 비교한다.
    // Host는 요청 대상 서버 자신이라 교차 사이트 공격자가 다른 값으로 바꿀 수 없다.
    // DNS 리바인딩(evil.com → 127.0.0.1) 차단: 로컬 전용 경로이므로 출처 호스트 이름은 loopback만.
    if (!LOOPBACK_HOSTNAMES.has(o.hostname)) return false;
    const host = req.headers.get("host");
    if (host) return o.host === host;
    return o.origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}
