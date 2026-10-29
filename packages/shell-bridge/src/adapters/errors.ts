// shell-bridge 공용 오류(어댑터 5종 공통). message에는 코드만 넣는다: 값·키 원문·경로·원 오류 메시지(토큰이 섞일 수 있음)는
// 담지 않고 cause도 보존하지 않는다. 구현(tauri/·web/)은 플랫폼 오류를 `errorFrom`으로 알려진 코드만 남겨 바꾼다.

/** SecureStore 오류 코드(Rust `commands/secrets.rs` `code`와 같은 값). */
export type SecretErrorCode = "SECRET_KEY_NOT_ALLOWED" | "SECRET_TOO_LARGE" | "SECRET_INVALID_VALUE" | "SECRET_UNAVAILABLE";

/** Exporter 오류 코드(04_API.md 7.3: AR052 쓰기 실패, AR055 크기 초과). */
export type ExportErrorCode = "AR052" | "AR055" | "CANCELLED" | "INVALID_INPUT";

/** FileGateway 오류 코드: 내보내기 코드 + 가져오기 읽기 실패. */
export type FileErrorCode = ExportErrorCode | "READ_FAILED";

/**
 * ProjectStore 오류 코드(Rust `commands/mod.rs` `code`와 같은 값).
 * VERSION_CONFLICT = `expected_version` 불일치(웹 409 `AR041`도 이 코드로 바꾼다), AR060 로컬 DB 손상, AR061 읽기 전용 모드,
 * PROJECT_UNAVAILABLE = 그 밖의 실패(알 수 없는 오류 모양 포함).
 */
export type ProjectErrorCode =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_INPUT"
  | "AR060"
  | "AR061"
  | "PROJECT_UNAVAILABLE";

/** LicenseClient 오류 코드(구현은 041). */
export type LicenseErrorCode =
  | "LICENSE_INVALID"
  | "LICENSE_SIGNATURE"
  | "LICENSE_SEAT_LIMIT"
  | "LICENSE_NETWORK"
  | "LICENSE_UNAVAILABLE";

/** Updater 오류 코드(구현은 updater 작업). 서명 불일치는 설치하지 않는다. */
export type UpdaterErrorCode = "UPDATE_NETWORK" | "UPDATE_SIGNATURE" | "UPDATE_UNAVAILABLE";

/** Rasterizer 오류 코드(AR-06-080, Rust `commands/raster.rs`): AR055 상한 초과, AR056 PNG 실패·시간 초과, BUSY 래스터화 진행 중. */
export type RasterErrorCode = "AR055" | "AR056" | "INVALID_INPUT" | "BUSY";

/** Supabase 클라이언트 설정 검증 오류(키·URL 값은 메시지에 담지 않는다). */
export type ConfigErrorCode = "SUPABASE_KEY_FORBIDDEN" | "SUPABASE_URL_INSECURE";

/** 전체 코드. NOT_SUPPORTED = 이 플랫폼에 없는 기능(capabilities가 false인 기능을 부름). */
export type BridgeErrorCode =
  | SecretErrorCode
  | FileErrorCode
  | ProjectErrorCode
  | LicenseErrorCode
  | UpdaterErrorCode
  | RasterErrorCode
  | ConfigErrorCode
  | "NOT_SUPPORTED";

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

/** 오류가 이 코드의 BridgeError인지(화면 분기용). */
export function isBridgeError<C extends BridgeErrorCode>(err: unknown, code?: C): err is BridgeError & { code: C } {
  return err instanceof BridgeError && (code === undefined || err.code === code);
}

/**
 * 플랫폼 실패 값(Rust AppError `{code, detail}`, Error, 임의 값)에서 `known`에 있는 코드만 꺼낸다. 없으면 `fallback`.
 * `detail`·message는 버린다(경로·값이 섞일 수 있음). 이미 BridgeError면 코드가 `known`에 있을 때만 그대로 쓴다.
 */
export function errorFrom<C extends BridgeErrorCode>(raw: unknown, known: readonly C[], fallback: C): BridgeError {
  const code =
    typeof raw === "object" && raw !== null && "code" in raw ? (raw as { code: unknown }).code : undefined;
  const hit = known.find((c) => c === code);
  return new BridgeError(hit ?? fallback);
}

const SECRET_CODES: readonly SecretErrorCode[] = [
  "SECRET_KEY_NOT_ALLOWED",
  "SECRET_TOO_LARGE",
  "SECRET_INVALID_VALUE",
  "SECRET_UNAVAILABLE",
];

/** invoke 실패 값에서 SecureStore 코드만 꺼낸다. 나머지는 SECRET_UNAVAILABLE. */
export function secretErrorFrom(raw: unknown): BridgeError {
  return errorFrom(raw, SECRET_CODES, "SECRET_UNAVAILABLE");
}
