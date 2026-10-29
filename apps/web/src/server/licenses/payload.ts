// 라이선스 payload 조립(04_API.md 2.4절 LicensePayloadV1, PRD 4.4절 필드). 순수 함수: 시각은 주입받는다.
// 상품 3종(영구·기간제·구독) 합성 필드(seat_id·rights·rights_expiry, 기간제 종료 clamp)는 AR-06-074/074a 소유라
// 여기서는 PayloadExtension으로 받기만 한다. 없으면 필드를 생략한다(정준화가 undefined 칸을 뺀다).

export const PLAN_OFFLINE_DAYS = 7; // 02_ARCHITECTURE.md 2.2절 제안값(체험·월 구독 발급 + 7일)
const DAY_MS = 86_400_000;

export interface LicenseFeatures {
  drafting_watermark: boolean;
  rule_pack_updates: boolean;
  cloud_review: boolean;
  ai_render: boolean;
}

/** arch.org_features 반환에서 이 작업이 읽는 키(04_API.md 3장 OrgFeatures의 부분집합). */
export interface OrgFeaturesView {
  state: string;
  plan_code: string | null;
  trial_ends_at: string | null;
  updates_until: string | null;
  drafting_watermark: boolean;
  rule_pack_updates: boolean;
  cloud_review: boolean;
  ai_render: boolean;
  [key: string]: unknown;
}

/** AR-06-074/074a가 채울 확장 필드. 값이 있을 때만 payload에 들어간다. */
export interface PayloadExtension {
  seat_id?: string;
  rights?: Record<string, boolean | number>;
  rights_expiry?: Record<string, string | null>;
  /** 상품 종료 시각(RFC 3339). 있으면 offline_valid_until을 이 값 이하로 clamp(D-H3). */
  product_ends_at?: string | null;
}

export interface LicensePayloadV1 {
  v: 1;
  license_id: string | null;
  org_id: string;
  app_id: "arch";
  sku: string;
  source: "license" | "plan";
  updates_until: string | null;
  activation_id: string;
  device_hash: string;
  issued_at: string;
  kid: string;
  offline_valid_until: string | null;
  features: LicenseFeatures;
  seat_id?: string;
  rights?: Record<string, boolean | number>;
  rights_expiry?: Record<string, string | null>;
}

/** 초 단위 RFC 3339 UTC(밀리초 버림): 같은 시각 → 같은 문자열. */
export function rfc3339(ms: number): string {
  if (!Number.isFinite(ms)) throw new RangeError("invalid clock value");
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * offline_valid_until 계산.
 * - license(영구) 출처: null(오프라인 무기한. 영구 권리의 30일 재확인은 rights_expiry, AR-06-074 소유)
 * - plan(체험·월 구독) 출처: min(발급 + 7일, 상품 종료 시각들). 종료 시각을 알 수 없으면 발급 + 7일.
 */
export function computeOfflineValidUntil(source: "license" | "plan", issuedAtMs: number, productEnds: readonly (string | null | undefined)[]): string | null {
  if (source === "license") return null;
  let limit = Math.floor(issuedAtMs / 1000) * 1000 + PLAN_OFFLINE_DAYS * DAY_MS;
  for (const end of productEnds) {
    const ms = parseInstant(end);
    if (ms !== null && ms < limit) limit = ms;
  }
  return rfc3339(limit);
}

export function pickFeatures(f: OrgFeaturesView): LicenseFeatures {
  return {
    drafting_watermark: f.drafting_watermark === true,
    rule_pack_updates: f.rule_pack_updates === true,
    cloud_review: f.cloud_review === true,
    ai_render: f.ai_render === true,
  };
}

export interface BuildPayloadInput {
  source: "license" | "plan";
  licenseId: string | null;
  orgId: string;
  sku: string;
  updatesUntil: string | null;
  activationId: string;
  deviceHash: string;
  kid: string;
  nowMs: number;
  features: OrgFeaturesView;
  extension?: PayloadExtension;
}

export function buildLicensePayload(input: BuildPayloadInput): LicensePayloadV1 {
  const ext = input.extension ?? {};
  const productEnds = [input.source === "plan" ? input.features.trial_ends_at : null, ext.product_ends_at];
  return {
    v: 1,
    license_id: input.source === "license" ? input.licenseId : null,
    org_id: input.orgId,
    app_id: "arch",
    sku: input.sku,
    source: input.source,
    updates_until: input.source === "license" ? input.updatesUntil : null,
    activation_id: input.activationId,
    device_hash: input.deviceHash,
    issued_at: rfc3339(input.nowMs),
    kid: input.kid,
    offline_valid_until: computeOfflineValidUntil(input.source, input.nowMs, productEnds),
    features: pickFeatures(input.features),
    seat_id: ext.seat_id,
    rights: ext.rights,
    rights_expiry: ext.rights_expiry,
  };
}
