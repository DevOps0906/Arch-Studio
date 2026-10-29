// shell-bridge 오류. message에는 코드만 넣는다: 값·키 원문·원 오류 메시지(토큰이 섞일 수 있음)는 담지 않고 cause도 보존하지 않는다.

/** SecureStore 오류 코드(Rust `commands/secrets.rs` `code`와 같은 값). */
export type SecretErrorCode = "SECRET_KEY_NOT_ALLOWED" | "SECRET_TOO_LARGE" | "SECRET_INVALID_VALUE" | "SECRET_UNAVAILABLE";

/** Exporter 오류 코드(04_API.md 7.3: AR052 쓰기 실패, AR055 크기 초과). */
export type ExportErrorCode = "AR052" | "AR055" | "CANCELLED" | "INVALID_INPUT";

/** LicenseClient 오류 코드(구현은 041). */
export type LicenseErrorCode =
  | "LICENSE_INVALID"
  | "LICENSE_SIGNATURE"
  | "LICENSE_SEAT_LIMIT"
  | "LICENSE_NETWORK"
  | "LICENSE_UNAVAILABLE";

/** Supabase 클라이언트 설정 검증 오류(키·URL 값은 메시지에 담지 않는다). */
export type ConfigErrorCode = "SUPABASE_KEY_FORBIDDEN" | "SUPABASE_URL_INSECURE";

/** 플랫폼 기능 미지원(웹에서 로컬 파일 등). */
export type BridgeErrorCode = SecretErrorCode | ExportErrorCode | LicenseErrorCode | ConfigErrorCode | "NOT_SUPPORTED";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode) {
    super(`shell-bridge: ${code}`);
    this.name = "BridgeError";
    this.code = code;
  }

  toJSON(): { name: string; code: BridgeErrorCode } {
    return { name: this.name, code: this.code };
  }
}

const SECRET_CODES: readonly SecretErrorCode[] = [
  "SECRET_KEY_NOT_ALLOWED",
  "SECRET_TOO_LARGE",
  "SECRET_INVALID_VALUE",
  "SECRET_UNAVAILABLE",
];

/** invoke 실패 값(Rust AppError `{code, detail}` 또는 임의 값)에서 알려진 코드만 꺼낸다. 나머지는 버린다. */
export function secretErrorFrom(raw: unknown): BridgeError {
  const code =
    typeof raw === "object" && raw !== null && "code" in raw ? (raw as { code: unknown }).code : undefined;
  const known = SECRET_CODES.find((c) => c === code);
  return new BridgeError(known ?? "SECRET_UNAVAILABLE");
}
