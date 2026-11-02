// 클라우드 사본 API 전용 로그(허용 목록). 프로젝트 이름·업로드 경로·서명 URL·본문·토큰·커서는 형식상 통과할 수 없다(04_API.md 1장 "로그").
// 기본 logger의 redact는 키 이름으로만 가리므로 필드 이름과 값 형식을 모두 고정한다(licenses/log.ts·ai/gateway/log.ts와 같은 방식).
import { logger } from "../../lib/logger.ts";

export type CloudRoute = "cloud_projects_list" | "cloud_projects_save" | "cloud_projects_upload_url" | "cloud_projects_blob";

export interface CloudLogFields {
  route: CloudRoute;
  code?: string;
  status?: number;
  project_uuid?: string;
  version?: number;
  count?: number;
  reason?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORD = /^[a-z0-9_]{1,40}$/i;
const ROUTES = new Set<CloudRoute>(["cloud_projects_list", "cloud_projects_save", "cloud_projects_upload_url", "cloud_projects_blob"]);

export function sanitizeCloudLog(fields: CloudLogFields): Record<string, string | number> {
  const out: Record<string, string | number> = { route: ROUTES.has(fields.route) ? fields.route : "unknown" };
  for (const name of ["code", "reason"] as const) {
    const v = fields[name];
    if (typeof v === "string" && WORD.test(v)) out[name] = v;
  }
  if (typeof fields.project_uuid === "string" && UUID.test(fields.project_uuid)) out.project_uuid = fields.project_uuid;
  for (const name of ["status", "version", "count"] as const) {
    const v = fields[name];
    if (Number.isSafeInteger(v)) out[name] = v as number;
  }
  return out;
}

export const cloudLog = {
  info: (event: string, fields: CloudLogFields) => logger.info(event, sanitizeCloudLog(fields)),
  warn: (event: string, fields: CloudLogFields) => logger.warn(event, sanitizeCloudLog(fields)),
  error: (event: string, fields: CloudLogFields) => logger.error(event, sanitizeCloudLog(fields)),
};
