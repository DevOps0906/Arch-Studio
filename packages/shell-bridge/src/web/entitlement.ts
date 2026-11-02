// 웹 EntitlementClient(AR-06-072): 서버 `GET /api/entitlement`(04_API 2.1절)의 `rights`만 본다. 라이선스 파일 없음(license = null).
// 실패 닫힘: 서버 응답을 얻지 못하면 Deny("offline"|"unverified"). `view_export`는 모든 상태에서 허용(ADR-001 4.7, 데이터 회수 경로).
// 판정 결과는 캐시하지 않는다(좌석 회수·만료가 바로 반영되도록 호출마다 서버, 화면이 필요하면 자체 TTL).
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
import type { WebApi } from "./http.ts";

interface ServerEntitlement {
  readonly rights: Readonly<Record<string, unknown>>;
  readonly seat: string | null;
  readonly products: readonly { termEndsAt: string | null }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(data: unknown): ServerEntitlement | null {
  if (!isRecord(data) || !isRecord(data.rights)) return null;
  const seat = isRecord(data.seat) && typeof data.seat.state === "string" ? data.seat.state : null;
  const products = Array.isArray(data.products)
    ? data.products.filter(isRecord).map((p) => ({ termEndsAt: typeof p.term_ends_at === "string" ? p.term_ends_at : null }))
    : [];
  return { rights: data.rights, seat, products };
}

export class WebEntitlementClient implements EntitlementClient {
  readonly license = null;
  readonly #api: WebApi;
  readonly #now: () => number;

  constructor(api: WebApi, now: () => number = Date.now) {
    this.#api = api;
    this.#now = now;
  }

  async #fetch(): Promise<{ ok: true; value: ServerEntitlement } | { ok: false; reason: DenyReason }> {
    const r = await this.#api.call("GET", "/api/entitlement");
    if (r.status === 0 || r.status >= 500) return { ok: false, reason: "offline" };
    const value = r.status === 200 ? parse(r.data) : null;
    return value ? { ok: true, value } : { ok: false, reason: "unverified" };
  }

  /** 권리가 false일 때의 사유(좌석 → 상품 유무 → 만료 → 폴백 순). */
  #reasonOf(e: ServerEntitlement): DenyReason {
    if (e.seat === "revoked") return "seat_revoked";
    if (e.seat === "unassigned" || e.seat === "shortage") return "seat_unassigned";
    if (e.products.length === 0) return "no_product";
    const now = this.#now();
    const live = e.products.some((p) => p.termEndsAt === null || Date.parse(p.termEndsAt) > now);
    return live ? "fallback" : "expired";
  }

  async can(feature: EntitlementFeature): Promise<EntitlementDecision> {
    assertEntitlementFeature(feature);
    if (feature === "view_export") return ALLOW;
    const got = await this.#fetch();
    if (!got.ok) return deny(got.reason);
    const right = got.value.rights[feature];
    if (typeof right !== "boolean") return deny("unverified");
    return right ? ALLOW : deny(this.#reasonOf(got.value));
  }

  async status(): Promise<EntitlementStatus> {
    const got = await this.#fetch();
    let state: LicenseState = "none";
    if (got.ok) {
      const e = got.value;
      if (e.rights.web_edit === true || e.rights.desktop_edit === true) state = "active";
      else {
        const reason = this.#reasonOf(e);
        state = reason === "seat_revoked" ? "revoked" : reason === "no_product" ? "none" : "expired";
      }
    }
    return { state, offlineValidUntil: null };
  }
}
