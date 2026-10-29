import { maskSecrets } from "./mask.ts";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const MAX_DEPTH = 8;

/**
 * 값을 재귀적으로 마스킹한다. JSON 직렬화 뒤에 가리면 따옴표·역슬래시·개행이 든 비밀이
 * 이스케이프된 모양으로 바뀌어 일치하지 않으므로, 직렬화 전에 원래 문자열에서 가린다.
 */
export function sanitize(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === "string") return maskSecrets(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth]";
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: maskSecrets(value.message, secrets) };
    if (value.cause !== undefined) out["cause"] = sanitize(value.cause, secrets, depth + 1);
    if (value.stack) out["stack"] = maskSecrets(value.stack, secrets);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, secrets, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, secrets, depth + 1)]));
}

/** JSON 한 줄 로그. 필드 값을 먼저 마스킹한 뒤 직렬화한다. */
export function createLogger(secrets: readonly string[], write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  const emit = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const body = sanitize({ level, msg, ...fields }, secrets) as Record<string, unknown>;
    write(JSON.stringify({ ...body, ts: new Date().toISOString() }));
  };
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
