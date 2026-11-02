// 웹 EntitlementClient: 서버 `GET /api/entitlement`(04_API.md 2.1절, `arch.org_features` + 좌석, ADR-001 4.2·4.7)가 정본.
// 라이선스 파일 없음(license = null). 세션마다 한 번 조회해 메모리에 둔다(로그아웃 = reset). 실패 닫힘: 응답을 못 받으면 `offline`,
// 모양이 다르거나 서버 rights에 없는 권리(ai_chat 등)는 `unverified`. 열람·내보내기는 상태와 무관하게 허용.
import {
  ALLOW,
  assertEntitlementFeature,
  deny,
  type DenyReason,
  type EntitlementClient,
  type EntitlementDecision,
  type EntitlementFeature,
  type EntitlementStatus,
} from "../adapters/entitlement.ts";
import type { LicenseState } from "../adapters/license-client.ts";
import type { WebHttp } from "./http.ts";

interface Snapshot {
  readonly rights: Readonly<Record<string, unknown>>;
  readonly reason: DenyReason;
  readonly state: LicenseState;
}

/** OrgFeatures.state → 화면 상태. 폴백(영구, 업데이트 만료)은 편집 가능한 활성 상태다. */
const STATE: Readonly<Record<string, LicenseState>> = Object.freeze({
  trial: "active",
  licensed: "active",
  licensed_fallback: "active",
  subscribed: "active",
  trial_expired: "expired",
  subscription_expired: "expired",
});

const UNKNOWN_STATUS: EntitlementStatus = Object.freeze({ state: "none", offlineValidUntil: null });

function parse(data: unknown): Snapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.rights !== "object" || d.rights === null) return null;
  const seat = typeof d.seat === "object" && d.seat !== null ? (d.seat as Record<string, unknown>).state : undefined;
  const products = Array.isArray(d.products) ? d.products : [];
  let state: LicenseState = typeof d.state === "string" ? (STATE[d.state] ?? "none") : "none";
  let reason: DenyReason = "no_product";
  if (seat === "revoked") {
    reason = "seat_revoked";
    state = "revoked";
  } else if (seat === "unassigned") reason = "seat_unassigned";
  else if (d.state === "licensed_fallback") reason = "fallback";
  else if (state === "expired") reason = "expired";
  else if (products.length === 0) reason = "no_product";
  return { rights: d.rights as Record<string, unknown>, reason, state };
}

export class WebEntitlementClient implements EntitlementClient {
  readonly license = null;
  readonly #http: WebHttp;
  #snapshot: Promise<Snapshot | null | "offline"> | null = null;

  constructor(http: WebHttp) {
    this.#http = http;
  }

  /** 다음 판정 때 서버를 다시 조회한다(로그아웃·결제 후). */
  reset(): void {
    this.#snapshot = null;
  }

  #load(): Promise<Snapshot | null | "offline"> {
    this.#snapshot ??= this.#http.api("GET", "/api/entitlement").then(
      (r) => (r.ok ? parse(r.data) : null),
      () => "offline" as const,
    );
    const p = this.#snapshot;
    // 실패는 기억하지 않는다(다음 판정에서 다시 조회).
    void p.then((s) => {
      if ((s === null || s === "offline") && this.#snapshot === p) this.#snapshot = null;
    });
    return p;
  }

  async can(feature: EntitlementFeature): Promise<EntitlementDecision> {
    assertEntitlementFeature(feature);
    if (feature === "view_export") return ALLOW;
    const s = await this.#load();
    if (s === "offline") return deny("offline");
    if (!s) return deny("unverified");
    const v = s.rights[feature];
    if (v === true) return ALLOW;
    if (v === false) return deny(s.reason);
    return deny("unverified");
  }

  async status(): Promise<EntitlementStatus> {
    const s = await this.#load();
    if (!s || s === "offline") return UNKNOWN_STATUS;
    return Object.freeze({ state: s.state, offlineValidUntil: null });
  }
}
