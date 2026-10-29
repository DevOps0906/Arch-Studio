// 설치형 SecureStore: Rust `secret_get/secret_set/secret_delete`(OS 키체인).
// 비동기 Tauri 명령은 스레드 풀에서 실행돼 보낸 순서와 적용 순서가 어긋날 수 있으므로 한 줄 대기열로 직렬화한다.
import { secretErrorFrom } from "../errors.ts";
import { assertSecretKey, assertSecretValue, type SecretKey, type SecureStore } from "../secure-store.ts";
import type { InvokeFn } from "./invoke.ts";

export class TauriSecureStore implements SecureStore {
  readonly #invoke: InvokeFn;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(invoke: InvokeFn) {
    this.#invoke = invoke;
  }

  /** 앞 호출이 끝난 뒤 실행. invoke 오류는 코드만 남긴 BridgeError로 바꾼다(원 메시지 폐기). */
  #enqueue<T>(op: () => Promise<unknown>, map: (raw: unknown) => T): Promise<T> {
    const run = async (): Promise<T> => {
      let raw: unknown;
      try {
        raw = await op();
      } catch (err) {
        throw secretErrorFrom(err);
      }
      return map(raw);
    };
    const next = this.#tail.then(run, run);
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async get(key: SecretKey): Promise<string | null> {
    assertSecretKey(key);
    return this.#enqueue(
      () => this.#invoke("secret_get", { key }),
      (raw) => (typeof raw === "string" ? raw : null),
    );
  }

  async set(key: SecretKey, value: string): Promise<void> {
    assertSecretKey(key);
    assertSecretValue(value);
    return this.#enqueue(
      () => this.#invoke("secret_set", { key, value }),
      () => undefined,
    );
  }

  async delete(key: SecretKey): Promise<void> {
    assertSecretKey(key);
    return this.#enqueue(
      () => this.#invoke("secret_delete", { key }),
      () => undefined,
    );
  }

  toJSON(): { redacted: true } {
    return { redacted: true };
  }
}
