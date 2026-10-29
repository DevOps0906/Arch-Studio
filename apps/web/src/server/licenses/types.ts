// 라이선스 서버 로직의 의존성 계약. DB·세션·시계·서명기를 주입받아 단위 테스트에서 목으로 바꾼다.
// 구현: supabase-repo.ts(실제 DB), deps.ts(배선). 이 파일은 server-only를 import하지 않는다(node --test 대상).
import type { PayloadExtension, OrgFeaturesView } from "./payload.ts";
import type { RateLimitStore, TrustedProxyConfig } from "./rate-limit.ts";
import type { LicenseSigner } from "./signing.ts";

export interface LicenseSession {
  userId: string;
  orgId: string;
  role: string;
  accessToken: string;
}

/** 요청 → 세션. 실패는 LicenseApiError(unauthorized·account_inactive·no_org)로 throw. */
export interface SessionResolver {
  resolve(req: Request): Promise<LicenseSession>;
}

export interface LicenseRow {
  id: string;
  org_id: string;
  sku_code: string;
  serial_last5: string;
  status: string;
  purchased_at: string;
  updates_until: string;
}

export interface ActivationRow {
  id: string;
  license_id: string | null;
  source: "license" | "plan";
  device_label: string | null;
  activated_at: string;
  last_seen_at: string;
}

export interface ActivateLicenseResult {
  activation: { id: string; activated_at: string; last_seen_at: string };
  license: { id: string; org_id: string; sku: string; serial_last5: string; updates_until: string; status: string };
}

export interface RefreshActivation {
  id: string;
  org_id: string;
  license_id: string | null;
  source: "license" | "plan";
  device_hash: string;
  deactivated_at: string | null;
}

/** 사용자 JWT 클라이언트(RLS·authenticated RPC). DB 오류는 DbCallError로 throw. */
export interface UserLicenseRepo {
  /** 호출자(JWT)의 그 조직 현재 역할이 roles 중 하나인지. core.has_org_role(org, roles)(authenticated EXECUTE, 활성 멤버만). */
  hasOrgRole(orgId: string, roles: readonly string[]): Promise<boolean>;
  orgFeatures(orgId: string): Promise<OrgFeaturesView>;
  deactivateActivation(activationId: string): Promise<{ id: string; org_id: string; deactivated_at: string }>;
  countSelfDeactivations(orgId: string, sinceIso: string): Promise<number>;
  getLicense(licenseId: string): Promise<Pick<LicenseRow, "id" | "org_id" | "sku_code" | "status" | "updates_until" | "serial_last5"> | null>;
  listLicenses(orgId: string): Promise<LicenseRow[]>;
  listActiveActivations(orgId: string): Promise<ActivationRow[]>;
}

/** service_role 클라이언트. 사용 지점은 이 세 개뿐(이유: tasks/logs/AR-06-040.md "서비스 롤 사용 지점"). */
export interface PrivilegedLicenseRepo {
  activateLicense(input: { serialHash: string; deviceHash: string; userId: string }): Promise<ActivateLicenseResult>;
  activatePlanDevice(input: { orgId: string; userId: string; deviceHash: string }): Promise<{ id: string; activated_at: string }>;
  getActivationForRefresh(activationId: string): Promise<RefreshActivation | null>;
}

export interface LicenseDeps {
  session: SessionResolver;
  userRepo(session: LicenseSession): UserLicenseRepo;
  privilegedRepo(): PrivilegedLicenseRepo;
  /** 실패 시 LicenseSignerError. DB 호출 전에 부른다. */
  signer(): LicenseSigner;
  rateLimit: RateLimitStore;
  ipSalt(): string;
  proxy: TrustedProxyConfig;
  now(): number;
  /** AR-06-074/074a 확장점(좌석·권리 합성). 없으면 확장 필드 생략. */
  extension?(input: { session: LicenseSession; orgId: string; source: "license" | "plan" }): Promise<PayloadExtension | undefined>;
}
