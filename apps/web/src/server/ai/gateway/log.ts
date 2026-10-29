// AI 게이트·업로드·잡 조회 전용 로그(허용 목록). 토큰·워커 키·서명 URL·업로드 경로·본문은 형식상 통과할 수 없다(04_API.md 1장 "로그").
// 기본 logger의 redact는 키 이름으로만 가리므로, 여기서는 필드 이름과 값 형식을 모두 고정한다.
import { logger } from "../../../lib/logger.ts";

export type GatewayRoute = "ai_token" | "ai_settle" | "uploads_sign" | "jobs_get" | "start_ai_run";

export interface GatewayLogFields {
  route: GatewayRoute;
  code?: string;
  status?: number;
  job_id?: string;
  run_id?: string;
  purpose?: string;
  kind?: string;
  variant?: string;
  reason?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORD = /^[a-z0-9_]{1,40}$/i;
const ROUTES = new Set<GatewayRoute>(["ai_token", "ai_settle", "uploads_sign", "jobs_get", "start_ai_run"]);

export function sanitizeGatewayLog(fields: GatewayLogFields): Record<string, string | number> {
  const out: Record<string, string | number> = { route: ROUTES.has(fields.route) ? fields.route : "unknown" };
  for (const name of ["code", "purpose", "kind", "variant", "reason"] as const) {
    const v = fields[name];
    if (typeof v === "string" && WORD.test(v)) out[name] = v;
  }
  for (const name of ["job_id", "run_id"] as const) {
    const v = fields[name];
    if (typeof v === "string" && UUID.test(v)) out[name] = v;
  }
  if (Number.isInteger(fields.status)) out.status = fields.status as number;
  return out;
}

export const gatewayLog = {
  info: (event: string, fields: GatewayLogFields) => logger.info(event, sanitizeGatewayLog(fields)),
  warn: (event: string, fields: GatewayLogFields) => logger.warn(event, sanitizeGatewayLog(fields)),
  error: (event: string, fields: GatewayLogFields) => logger.error(event, sanitizeGatewayLog(fields)),
};
