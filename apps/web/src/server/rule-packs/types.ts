// 규칙 팩·단가표·업데이트 배포 API 의존성 계약(AR-06-042). DB·저장소·세션·시계를 주입받아 테스트에서 목으로 바꾼다.
// 이 파일은 server-only를 import하지 않는다(node --test 대상).
import type { OrgFeaturesView } from "../licenses/payload.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import type { LicenseSession, SessionResolver } from "../licenses/types.ts";

export type { LicenseSession as ReleaseSession, SessionResolver };

/** `arch.eligible_rule_packs` 행(04_API 3장). */
export interface EligibleRulePackRow {
  version: string;
  published_at: string;
  basis_date: string;
  sha256: string;
  signature: string;
  kid: string;
  bytes: number;
  status: string;
}

export interface RulePackChangeRow {
  title: string;
  effective_from: string;
}

export interface CostCatalogRow {
  version: string;
  basis_date: string;
  published_at: string;
  items: unknown[];
  source_note: string;
  sha256: string;
}

/** 사용자 JWT 클라이언트(RLS·authenticated RPC). DB 오류는 DbCallError. */
export interface ReleaseUserRepo {
  eligibleRulePacks(orgId: string): Promise<EligibleRulePackRow[]>;
  /** RLS가 보이는 메타데이터(published·withdrawn). 없으면 null. */
  rulePackStatus(version: string): Promise<{ status: string } | null>;
  /** 이 시각 뒤에 게시된 팩의 개정 제목(최대 limit개, 시행일 순). */
  changesPublishedAfter(publishedAtIso: string | null, limit: number): Promise<RulePackChangeRow[]>;
  latestCostCatalog(orgId: string): Promise<CostCatalogRow | null>;
  orgFeatures(orgId: string): Promise<OrgFeaturesView>;
}

export interface RulePackObjectRow {
  storage_path: string;
  status: string;
  sha256: string;
  bytes: number;
  kid: string;
  signature: string;
}

export interface BuildRow {
  version: string;
  build_date: string;
  storage_path: string;
  signature: string;
  notes: string | null;
  published_at: string;
}

/** service_role 클라이언트. 사용 지점: 저장소 경로 조회·서명 URL·작은 매니페스트 읽기·빌드 자격(service_role 전용 RPC). */
export interface ReleasePrivilegedRepo {
  rulePackObject(version: string): Promise<RulePackObjectRow | null>;
  /** 비공개 버킷 arch-releases 서명 URL. */
  signedUrl(path: string, seconds: number): Promise<string>;
  /** 작은 객체를 maxBytes까지만 읽는다. 넘거나 없으면 null. */
  readSmallText(path: string, maxBytes: number): Promise<string | null>;
  eligibleBuild(orgId: string, platform: string, current: string): Promise<BuildRow | null>;
  build(platform: string, version: string): Promise<{ build_date: string } | null>;
}

export interface ReleaseDeps {
  session: SessionResolver;
  userRepo(session: LicenseSession): ReleaseUserRepo;
  privilegedRepo(): ReleasePrivilegedRepo;
  rateLimit: RateLimitStore;
  now(): number;
}
