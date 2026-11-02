// 웹 어댑터 공용 HTTP(AR-06-072). 인증은 Bearer(AR-06-071a 결정): 토큰은 호출마다 `getAccessToken()`으로 받아 헤더에만 싣고
// 어디에도 저장하지 않는다. 쿠키는 보내지 않는다(credentials: omit). 오류에는 상태·코드만 남기고 본문·URL은 버린다.

export interface WebApiOptions {
  /** API 원점(예: https://app.example.com). 끝 슬래시 없이. 개발용 localhost만 http 허용. */
  readonly baseUrl: string;
  /** 현재 세션의 access token. 없으면 null(로그인 전). */
  readonly getAccessToken: () => Promise<string | null>;
  /** 테스트 주입. 기본 globalThis.fetch. */
  readonly fetch?: typeof fetch;
}

export interface ApiResult {
  /** 0 = 네트워크 실패·시간 초과. */
  readonly status: number;
  /** 응답 봉투 `{ok, data|error}`를 풀어낸 값. 파싱 실패면 null. */
  readonly data: unknown;
  /** 오류 봉투의 error.code(AR041 등). 없으면 null. */
  readonly code: string | null;
}

const API_TIMEOUT_MS = 30_000;
const BLOB_TIMEOUT_MS = 10 * 60_000;

export function assertBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TypeError("baseUrl");
  return url;
}

/** 서명 URL 검사: https(또는 localhost http)만. 액세스 토큰은 이 URL로 보내지 않는다. */
export function isSafeSignedUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    assertBaseUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export class WebApi {
  readonly #base: string;
  readonly #token: () => Promise<string | null>;
  readonly #fetch: typeof fetch;

  constructor(options: WebApiOptions) {
    this.#base = assertBaseUrl(options.baseUrl).origin;
    this.#token = options.getAccessToken;
    this.#fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  /** 인증된 JSON 요청. 실패는 던지지 않고 status로 알린다(호출자가 도메인 코드로 바꾼다). */
  async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<ApiResult> {
    let token: string | null = null;
    try {
      token = await this.#token();
    } catch {
      token = null;
    }
    if (!token) return { status: 401, data: null, code: null };
    try {
      const res = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      const env = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
      const err = (typeof env.error === "object" && env.error !== null ? env.error : {}) as Record<string, unknown>;
      return {
        status: res.status,
        data: res.ok && env.ok === true ? (env.data ?? null) : null,
        code: typeof err.code === "string" ? err.code : null,
      };
    } catch {
      return { status: 0, data: null, code: null };
    }
  }

  /** 서명 URL 전송(Authorization 없음). 실패는 null. */
  async transfer(url: string, init: { method: "GET" } | { method: "PUT"; body: Uint8Array }): Promise<Uint8Array | true | null> {
    try {
      const res = await this.#fetch(url, {
        method: init.method,
        ...(init.method === "PUT"
          ? { body: init.body as BodyInit, headers: { "content-type": "application/octet-stream" } }
          : {}),
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return init.method === "GET" ? new Uint8Array(await res.arrayBuffer()) : true;
    } catch {
      return null;
    }
  }
}
