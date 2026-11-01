// 대지 조회 전용 로그(허용 목록). 주소·지번·PNU·해시·좌표·URL·키는 필드가 없어 형식상 남을 수 없다(로그 A2·A6).
import { logger } from "../../lib/logger.ts";

export type SiteLogRoute = "site_lookup" | "site_search" | "site_tiles";

export interface SiteLogFields {
  /** 기본 site_lookup. */
  route?: SiteLogRoute;
  code?: string;
  status?: number;
  kind?: string;
  reason?: string;
  /** 실패 단계: method·switch·session·input·limit·resolve·record·fetch. */
  stage?: string;
  remaining?: number;
}

const WORD = /^[a-z0-9_]{1,40}$/i;

export function sanitizeSiteLog(fields: SiteLogFields): Record<string, string | number> {
  const route: SiteLogRoute = fields.route === "site_search" || fields.route === "site_tiles" ? fields.route : "site_lookup";
  const out: Record<string, string | number> = { route };
  for (const name of ["code", "kind", "reason", "stage"] as const) {
    const v = fields[name];
    if (typeof v === "string" && WORD.test(v)) out[name] = v;
  }
  for (const name of ["status", "remaining"] as const) {
    const v = fields[name];
    if (Number.isSafeInteger(v)) out[name] = v as number;
  }
  return out;
}

export const siteLog = {
  info: (event: string, fields: SiteLogFields) => logger.info(event, sanitizeSiteLog(fields)),
  warn: (event: string, fields: SiteLogFields) => logger.warn(event, sanitizeSiteLog(fields)),
};
