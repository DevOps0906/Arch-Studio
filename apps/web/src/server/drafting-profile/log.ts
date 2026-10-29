// 표제란 설정 로그(허용 목록). 프로필 값(사무소명·연락처)·레이어 이름·로고 경로·서명 URL·토큰은 형식상 실을 수 없다.
// 남기는 것: 경로 이름, 코드, 바뀐 키 이름(허용 키 8개 중), 경고 수.
import { logger } from "../../lib/logger.ts";

export type ProfileRoute = "drafting_profile_get" | "drafting_profile_put" | "drafting_logo_url";

export interface ProfileLogFields {
  route: ProfileRoute;
  code?: string;
  field?: string;
  keys?: readonly string[];
  warnings?: number;
}

const ROUTES = new Set<ProfileRoute>(["drafting_profile_get", "drafting_profile_put", "drafting_logo_url"]);
const WORD = /^[a-z0-9_]{1,40}$/i;
const KEYS = new Set(["office_name", "architect_name", "contact", "logo_storage_path", "layer_map", "default_paper", "default_text_height_mm", "font_family"]);

export function sanitizeProfileLog(fields: ProfileLogFields): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = { route: ROUTES.has(fields.route) ? fields.route : "unknown" };
  if (typeof fields.code === "string" && WORD.test(fields.code)) out.code = fields.code;
  if (typeof fields.field === "string" && KEYS.has(fields.field)) out.field = fields.field;
  if (Array.isArray(fields.keys)) out.keys = fields.keys.filter((k) => KEYS.has(k));
  if (Number.isSafeInteger(fields.warnings) && (fields.warnings as number) >= 0) out.warnings = fields.warnings as number;
  return out;
}

export const profileLog = {
  info: (event: string, fields: ProfileLogFields) => logger.info(event, sanitizeProfileLog(fields)),
  warn: (event: string, fields: ProfileLogFields) => logger.warn(event, sanitizeProfileLog(fields)),
};
