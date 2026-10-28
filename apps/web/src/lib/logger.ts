// 구조화 로거(JSON 한 줄). 비밀이 로그에 남지 않도록 이름이 비밀처럼 보이는 필드는 중첩 객체·배열까지 가린다.
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEY = /key|secret|token|password|authorization|cookie/i;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [name, SECRET_KEY.test(name) ? REDACTED : redact(item, seen)]),
  );
}

function write(level: Level, message: string, fields: Fields = {}) {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(redact(fields) as Fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Fields) => write("debug", message, fields),
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
