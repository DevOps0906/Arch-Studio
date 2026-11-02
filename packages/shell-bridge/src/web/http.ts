// 웹 어댑터 공용 HTTP: 같은 출처 `/api/*`(응답 봉투 `{ ok, data }` / `{ ok:false, error:{ code } }`, 04_API.md 1장)와 sha256.
// 인증은 Bearer(서버 `bearerGatewaySession`). 토큰은 메모리 SecureStore의 supabase 세션에서 매 요청 꺼내고 어디에도 남기지 않는다.
// 오류·로그에 응답 본문·message·토큰을 싣지 않는다: 호출부는 status와 `error.code`만 본다.
import { AUTH_STORAGE_KEY, type SecureStore } from "../adapters/secure-store.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type AccessTokenFn = () => Promise<string | null>;

export interface ApiResult {
  readonly status: number;
  readonly ok: boolean;
  /** 성공이면 `data`, 실패면 undefined. */
  readonly data: unknown;
  /** 실패 봉투의 `error.code`(문자열일 때만). */
  readonly code: string | null;
}

export interface WebHttpOptions {
  readonly fetch?: FetchFn;
  /** API 출처. 기본 "" = 같은 출처. */
  readonly baseUrl?: string;
  readonly accessToken: AccessTokenFn;
}

export class WebHttp {
  readonly #fetch: FetchFn;
  readonly #base: string;
  readonly #token: AccessTokenFn;

  constructor(options: WebHttpOptions) {
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#base = options.baseUrl ?? "";
    this.#token = options.accessToken;
  }

  /** `/api/*` 호출. 네트워크 실패는 그대로 throw(호출부가 코드로 바꾼다). */
  async api(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<ApiResult> {
    const headers: Record<string, string> = { accept: "application/json" };
    const token = await this.#token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const env = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const ok = res.ok && env.ok === true;
    const err = typeof env.error === "object" && env.error !== null ? (env.error as Record<string, unknown>) : {};
    return { status: res.status, ok, data: ok ? env.data : undefined, code: typeof err.code === "string" ? err.code : null };
  }

  /** Storage 서명 URL 호출(외부 출처). 인증 헤더·쿠키를 보내지 않는다(서명이 곧 권한). */
  async signed(method: "GET" | "PUT", url: string, body?: Uint8Array): Promise<Response> {
    return this.#fetch(url, {
      method,
      headers: body ? { "content-type": "application/octet-stream" } : {},
      body: body as BodyInit | undefined,
      cache: "no-store",
      credentials: "omit",
    });
  }
}

/** 기본 토큰 공급: 메모리 SecureStore의 supabase 세션 JSON에서 access_token만. 형식이 다르면 null(무인증 → 서버 401). */
export function sessionAccessToken(secrets: SecureStore): AccessTokenFn {
  return async () => {
    try {
      const raw = await secrets.get(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const v: unknown = JSON.parse(raw);
      const t = typeof v === "object" && v !== null ? (v as Record<string, unknown>).access_token : undefined;
      return typeof t === "string" && t !== "" ? t : null;
    } catch {
      return null;
    }
  };
}

/** SHA-256 소문자 16진수(Web Crypto, 브라우저·Node 공통). */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
