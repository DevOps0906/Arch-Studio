// EntitlementClient: 권한 판정(ADR-001 2.1·4.2·4.7). 설치형은 서명 라이선스 파일(005 `LicenseClient`, Rust `license.rs`는 041)로
// 로컬 기능을 판정하고 클라우드 기능은 서버가 정본이다. 웹은 서버 `arch.org_features`(072·074)만 본다(라이선스 파일 없음).
// 판정 결과는 throw하지 않고 Allow/Deny(사유)로 돌려준다(실패 닫힘: 판정할 수 없으면 Deny). 열람·내보내기는 모든 상태에서 허용.
import { BridgeError } from "./errors.ts";
import type { LicenseClient, LicenseState } from "./license-client.ts";

/** 권리 키(ADR-001 4.7 표의 열). 서버 `rights.*` 이름과 맞춘다. */
export const ENTITLEMENT_FEATURES = [
  "view_export",
  "desktop_edit",
  "web_edit",
  "ai_render",
  "ai_chat",
  "cloud_review",
] as const;
export type EntitlementFeature = (typeof ENTITLEMENT_FEATURES)[number];

/**
 * 거부 사유. 앞 5개는 서버 402 `entitled=false` 사유(04_API.md 1장)와 같다.
 * `offline` = 네트워크가 필요한 판정을 할 수 없음, `unverified` = 판정 근거(라이선스 파일·서버 응답)를 아직 얻지 못함.
 */
export const DENY_REASONS = [
  "expired",
  "fallback",
  "seat_unassigned",
  "seat_revoked",
  "no_product",
  "offline",
  "unverified",
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

export type EntitlementDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason };

export const ALLOW: EntitlementDecision = Object.freeze({ allowed: true });
export const deny = (reason: DenyReason): EntitlementDecision => Object.freeze({ allowed: false, reason });

/** 화면 표시용 요약(만료·유예 상태 포함). 시리얼·서명 원문은 담지 않는다. */
export interface EntitlementStatus {
  /** 005 `LicenseState`와 같은 값(웹은 서버 판정을 이 값으로 바꾼다). */
  readonly state: LicenseState;
  /** 오프라인 사용 가능 기한(ISO 8601). 웹·영구는 null. */
  readonly offlineValidUntil: string | null;
}

export interface EntitlementClient {
  /** 권리 하나 판정. 알 수 없는 키는 INVALID_INPUT을 던진다(오타가 조용히 Deny/Allow가 되지 않게). */
  can(feature: EntitlementFeature): Promise<EntitlementDecision>;
  status(): Promise<EntitlementStatus>;
  /**
   * 설치형 시리얼 활성화(005 LicenseClient). 이 플랫폼에 없으면 null이며 `capabilities.licenseActivation`과 항상 같다.
   */
  readonly license: LicenseClient | null;
}

export function isEntitlementFeature(f: unknown): f is EntitlementFeature {
  return typeof f === "string" && (ENTITLEMENT_FEATURES as readonly string[]).includes(f);
}

export function assertEntitlementFeature(f: unknown): asserts f is EntitlementFeature {
  if (!isEntitlementFeature(f)) throw new BridgeError("INVALID_INPUT");
}

/** 서버 판정이 필요한 권리(설치형에서도 호출마다 서버, ADR-001 4.2 "클라우드 기능"). */
export const SERVER_FEATURES: readonly EntitlementFeature[] = ["web_edit", "ai_render", "ai_chat", "cloud_review"];
