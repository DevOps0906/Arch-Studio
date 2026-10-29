// 실패 분류: 재시도 여부는 fail_job(p_retryable)로 넘기고, 시도 횟수 한도(max_attempts)는 DB가 판단한다.
export class JobError extends Error {
  readonly retryable: boolean;
  readonly code: string;
  constructor(message: string, opts: { retryable: boolean; code: string; cause?: unknown }) {
    super(message, { cause: opts.cause });
    this.name = "JobError";
    this.retryable = opts.retryable;
    this.code = opts.code;
  }
}

export class JobTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`job timed out after ${timeoutMs}ms`);
    this.name = "JobTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** PostgREST·RPC 오류. code는 SQLSTATE(예: AR033, JB001, 42501). */
export class DbError extends Error {
  readonly code: string;
  constructor(fn: string, message: string, code: string) {
    super(`${fn}: ${message}`);
    this.name = "DbError";
    this.code = code;
  }
}

export interface Classified {
  retryable: boolean;
  /** 사용자에게 보일 수 있는 실행 행 error 칸용 짧은 코드(내부 메시지 대신). */
  reason: string;
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_SOCKET"]);

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

/**
 * 오류 → 재시도 여부. 기본은 재시도하지 않는다(모르는 오류로 크레딧 재소모 방지).
 * 재시도: JobError(retryable), 네트워크 오류, 잡 종류 정책이 허용한 타임아웃.
 */
export function classifyError(err: unknown, retryOnTimeout: boolean): Classified {
  if (err instanceof JobTimeoutError) return { retryable: retryOnTimeout, reason: "timeout" };
  if (err instanceof JobError) return { retryable: err.retryable, reason: err.code };
  if (err instanceof DbError) return { retryable: false, reason: `db_${err.code}` };
  if (isNetworkError(err)) return { retryable: true, reason: "network" };
  return { retryable: false, reason: "error" };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
