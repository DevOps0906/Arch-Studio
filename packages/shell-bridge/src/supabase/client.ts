// Supabase 클라이언트 팩토리(T-003). 세션 저장소는 SecureStore 어댑터(설치형 = OS 키체인)만 쓴다.
// 인증 옵션은 여기서 고정하고 호출자가 덮어쓰지 못한다: storage 누락 시 supabase-js가 영속 웹 스토리지로 떨어지기 때문.
// 로그인 흐름(signInWithOAuth·딥링크 교환·Mock)은 008 `src/auth/**` 소유.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BridgeError } from "../adapters/errors.ts";
import { AUTH_PKCE_KEY, AUTH_STORAGE_KEY, type SecureStore } from "../adapters/secure-store.ts";

/** supabase-js `auth.storage` 계약(비동기 허용). */
export interface AuthStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const SK = AUTH_STORAGE_KEY.replace(/\./g, "\\.");
/** supabase-js 2.118의 PKCE 키: 단일(구), 시도 목록, 시도별 verifier. */
const PKCE_KEY = new RegExp(`^${SK}-(code-verifier|flows-code-verifier|flow-[0-9a-f]{32}-code-verifier)$`);
/** userStorage 미사용이라 supabase-js가 지우기만 하는 키. */
const USER_KEY = `${AUTH_STORAGE_KEY}-user`;
/** 묶음에 남길 시도별 verifier 최대 개수(오래된 것부터 버림 → 그 로그인 시도만 무효). */
export const MAX_PKCE_FLOWS = 8;

type PkceBundle = Record<string, string>;

function parseBundle(raw: string | null): PkceBundle {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([k, v]) => PKCE_KEY.test(k) && typeof v === "string"),
    ) as PkceBundle;
  } catch {
    return {};
  }
}

function capFlows(bundle: PkceBundle): PkceBundle {
  const flows = Object.keys(bundle).filter((k) => k.includes("-flow-"));
  for (const old of flows.slice(0, Math.max(0, flows.length - MAX_PKCE_FLOWS))) delete bundle[old];
  return bundle;
}

/**
 * supabase-js 키 → SecureStore 키.
 * - `auth.session` → 그대로(세션 JSON)
 * - PKCE 키들 → `auth.pkce` 한 항목의 JSON 필드(로그아웃 때 한 번에 삭제)
 * - `auth.session-user` → 저장 안 함(읽기 null, 지우기 무시)
 * - 그 밖 → 오류(키 원문 미포함)
 * 묶음 읽기-수정-쓰기는 어댑터 대기열로 직렬화한다.
 */
export function createAuthStorage(store: SecureStore): AuthStorageAdapter {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = tail.then(op, op);
    tail = next.catch(() => undefined);
    return next;
  };
  const kind = (key: string): "session" | "pkce" | "user" => {
    if (key === AUTH_STORAGE_KEY) return "session";
    if (PKCE_KEY.test(key)) return "pkce";
    if (key === USER_KEY) return "user";
    throw new BridgeError("SECRET_KEY_NOT_ALLOWED");
  };
  const updateBundle = (mutate: (b: PkceBundle) => void) =>
    serial(async () => {
      const bundle = parseBundle(await store.get(AUTH_PKCE_KEY));
      mutate(bundle);
      capFlows(bundle);
      if (Object.keys(bundle).length === 0) await store.delete(AUTH_PKCE_KEY);
      else await store.set(AUTH_PKCE_KEY, JSON.stringify(bundle));
    });

  return {
    async getItem(key) {
      switch (kind(key)) {
        case "session":
          return serial(() => store.get(AUTH_STORAGE_KEY));
        case "pkce":
          return serial(async () => parseBundle(await store.get(AUTH_PKCE_KEY))[key] ?? null);
        case "user":
          return null;
      }
    },
    async setItem(key, value) {
      switch (kind(key)) {
        case "session":
          return serial(() => store.set(AUTH_STORAGE_KEY, value));
        case "pkce":
          if (typeof value !== "string") throw new BridgeError("SECRET_INVALID_VALUE");
          return updateBundle((b) => {
            delete b[key]; // 다시 쓰면 최신으로(삽입 순서 = 오래된 순)
            b[key] = value;
          });
        case "user":
          throw new BridgeError("SECRET_KEY_NOT_ALLOWED");
      }
    },
    async removeItem(key) {
      switch (kind(key)) {
        case "session":
          return serial(() => store.delete(AUTH_STORAGE_KEY));
        case "pkce":
          return updateBundle((b) => {
            delete b[key];
          });
        case "user":
          return;
      }
    },
  };
}

export interface ArchSupabaseOptions {
  url: string;
  /** 공개(anon/publishable) 키만. service_role 키 금지. */
  anonKey: string;
  secrets: SecureStore;
  /** 테스트용 fetch. */
  fetch?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** JWT 형식이면 payload(base64url)의 role을 읽는다. 형식이 아니거나 해석 불가면 undefined. */
function jwtRole(key: string): unknown {
  const parts = key.split(".");
  if (parts.length !== 3) return undefined;
  try {
    // 브라우저·웹뷰에는 Buffer가 없다: base64url → base64 → atob → UTF-8.
    const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload === "object" && payload !== null ? (payload as { role?: unknown }).role : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 클라이언트에 넣을 수 없는 값을 거부한다: 비밀 키(`sb_secret_`·service_role JWT)와 https가 아닌 URL(개발용 loopback 제외).
 * 오류에는 코드만 담는다(키·URL 값 미포함).
 */
export function assertClientConfig(url: string, anonKey: string): void {
  const key = anonKey.trim();
  if (key.startsWith("sb_secret_") || jwtRole(key) === "service_role") {
    throw new BridgeError("SUPABASE_KEY_FORBIDDEN");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BridgeError("SUPABASE_URL_INSECURE");
  }
  const loopbackDev = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopbackDev) throw new BridgeError("SUPABASE_URL_INSECURE");
}

/**
 * PKCE·`detectSessionInUrl: false`(딥링크 `code`는 shell-bridge auth가 직접 교환) 고정.
 * 세션·verifier는 `secrets`에만 저장된다.
 */
export function createArchSupabaseClient(options: ArchSupabaseOptions): SupabaseClient {
  assertClientConfig(options.url, options.anonKey);
  return createClient(options.url, options.anonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: AUTH_STORAGE_KEY,
      storage: createAuthStorage(options.secrets),
    },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}
