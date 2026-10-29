// LicenseClient 인터페이스(구현은 041 `license.rs` 서명 검증 + 074 판정). 시리얼 원문은 결과·오류·로그에 남기지 않는다(끝 5자만).
// 실패는 BridgeError(LicenseErrorCode)로 던진다.

export type LicenseState = "none" | "active" | "grace" | "expired" | "revoked";

export interface LicenseStatus {
  readonly state: LicenseState;
  /** 상품 코드(license_skus). 없으면 null. */
  readonly sku: string | null;
  /** 오프라인 사용 가능 기한(ISO 8601). */
  readonly offlineValidUntil: string | null;
  /** 시리얼 끝 5자(표시용). */
  readonly serialSuffix: string | null;
}

export interface LicenseClient {
  /** 로컬 서명 라이선스 파일 기준 상태(네트워크 없이). */
  status(): Promise<LicenseStatus>;
  /** 시리얼로 활성화(서버 발급 → 서명 검증 → 저장). */
  activate(serial: string): Promise<LicenseStatus>;
  /** 이 기기 셀프 해제(D-8). */
  deactivate(): Promise<void>;
}
