// 라이선스 전용 로그(허용 목록). 시리얼 원문·라이선스 파일·서명·키·device_hash·토큰은 형식상 통과할 수 없다(04_API.md 1장 "로그").
// 기존 logger의 redact는 키 이름(key|secret|token…)으로만 가려 serial·sig를 막지 못하므로 값 형식까지 검사한다.
import { logger } from "../../lib/logger.ts";

export type LicenseRoute = "activate" | "deactivate" | "refresh" | "list";

export interface LicenseLogFields {
  route: LicenseRoute;
  code?: string;
  status?: number;
  serial_last5?: string;
  activation_id?: string;
  source?: "license" | "plan";
  signer_reason?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAST5 = /^[0-9A-Z]{5}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;

export function sanitizeLogFields(fields: LicenseLogFields): Record<string, string | number> {
  const out: Record<string, string | number> = { route: fields.route };
  if (fields.code && CODE.test(fields.code)) out.code = fields.code;
  if (Number.isInteger(fields.status)) out.status = fields.status as number;
  if (fields.serial_last5 && LAST5.test(fields.serial_last5)) out.serial_last5 = fields.serial_last5;
  if (fields.activation_id && UUID.test(fields.activation_id)) out.activation_id = fields.activation_id;
  if (fields.source === "license" || fields.source === "plan") out.source = fields.source;
  if (fields.signer_reason && CODE.test(fields.signer_reason)) out.signer_reason = fields.signer_reason;
  return out;
}

export const licenseLog = {
  info: (event: string, fields: LicenseLogFields) => logger.info(event, sanitizeLogFields(fields)),
  warn: (event: string, fields: LicenseLogFields) => logger.warn(event, sanitizeLogFields(fields)),
  error: (event: string, fields: LicenseLogFields) => logger.error(event, sanitizeLogFields(fields)),
};
