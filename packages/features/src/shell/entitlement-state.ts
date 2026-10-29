// 라이선스 상태 → 헤더 배지(ui LicenseStatusBadge). 판정 정본은 EntitlementClient(설치형 041 라이선스 파일, 웹 074 서버)다.
import type { LicenseState } from "@arch-studio/shell-bridge";

export type LicenseBadge = "active" | "trial" | "update-expired" | "expired" | "device-limit";

/**
 * 판정 전(undefined)·근거 없음(none)은 배지 없음(null → "라이선스 미확인") — 단, 서버 세션 플랜이 trial이면 "체험 중".
 * grace(오프라인 유예)는 사용 가능이라 active로 보인다. revoked는 만료와 같은 위험 표시.
 */
export function licenseBadgeOf(state: LicenseState | undefined, planCode: string | null): LicenseBadge | null {
  switch (state) {
    case "active":
    case "grace":
      return "active";
    case "expired":
    case "revoked":
      return "expired";
    default:
      return planCode === "trial" ? "trial" : null;
  }
}
