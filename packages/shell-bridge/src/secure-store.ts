// SecureStore: 토큰·PKCE verifier 보관(ADR-001 2.1). 설치형은 OS 키체인(Rust secrets.rs), 웹 대체는 메모리만.
// 키는 허용 목록만. 새 키는 Rust `ALLOWED_KEYS`와 함께 추가하고 보안 리뷰를 거친다.
import { BridgeError } from "./errors.ts";

/** supabase-js `storageKey`(세션 JSON). */
export const AUTH_STORAGE_KEY = "auth.session";
/**
 * PKCE verifier 묶음. supabase-js 2.118은 로그인 시도마다 `<storageKey>-flow-<id>-code-verifier` 키를 새로 만든다.
 * 키체인은 항목 열거가 안 돼 로그아웃 때 다 못 지우므로, 어댑터가 이 키들을 JSON 한 항목에 모은다(supabase/client.ts).
 */
export const AUTH_PKCE_KEY = "auth.pkce";

export const SECRET_KEYS = [AUTH_STORAGE_KEY, AUTH_PKCE_KEY] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** 값 상한(UTF-8 바이트). Rust `MAX_VALUE_BYTES`와 같다. */
export const MAX_SECRET_BYTES = 16 * 1024;

export interface SecureStore {
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}

export function isSecretKey(key: unknown): key is SecretKey {
  return typeof key === "string" && (SECRET_KEYS as readonly string[]).includes(key);
}

/** 키 검사. 실패 오류에 키 원문을 담지 않는다(키 자리에 토큰을 넣은 실수 대비). */
export function assertSecretKey(key: unknown): asserts key is SecretKey {
  if (!isSecretKey(key)) throw new BridgeError("SECRET_KEY_NOT_ALLOWED");
}

const encoder = new TextEncoder();

/** 값 검사: 문자열만(Rust 역직렬화 오류가 스칼라 값을 되풀이하는 경로 차단), 크기 상한. */
export function assertSecretValue(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new BridgeError("SECRET_INVALID_VALUE");
  if (encoder.encode(value).byteLength > MAX_SECRET_BYTES) throw new BridgeError("SECRET_TOO_LARGE");
}

/**
 * 메모리 저장소(웹 대체·테스트). 영속 저장소를 쓰지 않으므로 새로고침 = 세션 없음.
 * 값은 #private Map에만 있고 JSON 직렬화·inspect에 드러나지 않는다.
 */
export class MemorySecureStore implements SecureStore {
  readonly #items = new Map<SecretKey, string>();

  async get(key: SecretKey): Promise<string | null> {
    assertSecretKey(key);
    return this.#items.get(key) ?? null;
  }

  async set(key: SecretKey, value: string): Promise<void> {
    assertSecretKey(key);
    assertSecretValue(value);
    this.#items.set(key, value);
  }

  async delete(key: SecretKey): Promise<void> {
    assertSecretKey(key);
    this.#items.delete(key);
  }

  toJSON(): { redacted: true } {
    return { redacted: true };
  }
}

/** 허용 키 전부 삭제(로그아웃). 하나가 실패해도 나머지를 지운 뒤 첫 오류를 던진다. */
export async function clearAllSecrets(store: SecureStore): Promise<void> {
  let first: unknown;
  for (const key of SECRET_KEYS) {
    try {
      await store.delete(key);
    } catch (err) {
      first ??= err;
    }
  }
  if (first !== undefined) throw first;
}
