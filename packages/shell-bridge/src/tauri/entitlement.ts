// 설치형 EntitlementClient. 로컬 권리(`desktop_edit`)는 서명 라이선스 파일 상태(LicenseClient)로, 클라우드 권리는 서버 판정이다.
// 지금은 Rust `license.rs`(041)·서버 판정(074)이 없어 `license = null`이고, 판정 근거가 없으면 `unverified`로 거부한다(실패 닫힘).
// 041이 Rust 명령 기반 LicenseClient를, 074가 서버 판정을 여기에 넣는다. 열람·내보내기는 상태와 무관하게 허용(ADR-001 4.7).
import {
  ALLOW,
  assertEntitlementFeature,
  deny,
  SERVER_FEATURES,
  type EntitlementClient,
  type EntitlementDecision,
  type EntitlementFeature,
  type EntitlementStatus,
} from "../adapters/entitlement.ts";
import type { LicenseClient, LicenseState } from "../adapters/license-client.ts";

const LOCAL_DECISION: Readonly<Record<LicenseState, EntitlementDecision>> = Object.freeze({
  active: ALLOW,
  grace: ALLOW,
  none: deny("no_product"),
  expired: deny("expired"),
  revoked: deny("seat_revoked"),
});

const UNKNOWN_STATUS: EntitlementStatus = Object.freeze({ state: "none", offlineValidUntil: null });

export class TauriEntitlementClient implements EntitlementClient {
  readonly license: LicenseClient | null;

  constructor(license: LicenseClient | null = null) {
    this.license = license;
  }

  async status(): Promise<EntitlementStatus> {
    if (!this.license) return UNKNOWN_STATUS;
    try {
      const s = await this.license.status();
      return Object.freeze({ state: s.state, offlineValidUntil: s.offlineValidUntil });
    } catch {
      return UNKNOWN_STATUS;
    }
  }

  async can(feature: EntitlementFeature): Promise<EntitlementDecision> {
    assertEntitlementFeature(feature);
    if (feature === "view_export") return ALLOW;
    // 서버 판정 경로는 074 전까지 없다.
    if (SERVER_FEATURES.includes(feature)) return deny("unverified");
    if (!this.license) return deny("unverified");
    try {
      const { state } = await this.license.status();
      return LOCAL_DECISION[state] ?? deny("unverified");
    } catch {
      return deny("unverified");
    }
  }
}
