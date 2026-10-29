// 인증 전용 로그(허용 목록). 토큰·이메일·비밀번호·code·user_id는 형식상 통과할 수 없다(AR-F-027 수용 기준, 04_API.md 1장 "로그").
import { logger } from "../logger.ts";
import { isMockPersonaKey } from "./personas.ts";

export type AuthRoute = "dev_login" | "auth_finish" | "onboarding";

export interface AuthLogFields {
  route: AuthRoute;
  code?: string;
  status?: number;
  persona?: string;
  first_login?: boolean;
  provider?: string;
}

const CODE = /^[A-Za-z0-9_]{1,40}$/;
const PROVIDER = /^(google|kakao|naver|email)$/;

export function sanitizeAuthLog(fields: AuthLogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = { route: fields.route };
  if (fields.code && CODE.test(fields.code)) out.code = fields.code;
  if (Number.isInteger(fields.status)) out.status = fields.status as number;
  if (isMockPersonaKey(fields.persona)) out.persona = fields.persona;
  if (typeof fields.first_login === "boolean") out.first_login = fields.first_login;
  if (fields.provider && PROVIDER.test(fields.provider)) out.provider = fields.provider;
  return out;
}

export const authLog = {
  info: (event: string, fields: AuthLogFields) => logger.info(event, sanitizeAuthLog(fields)),
  warn: (event: string, fields: AuthLogFields) => logger.warn(event, sanitizeAuthLog(fields)),
  error: (event: string, fields: AuthLogFields) => logger.error(event, sanitizeAuthLog(fields)),
};

/** DB·Auth 오류 → 로그용 코드(SQLSTATE 등 짧은 코드만, 메시지 원문은 버린다). */
export function errorCodeOf(error: unknown): string {
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && CODE.test(code) ? code : "unknown";
}
