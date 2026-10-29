// 모델러 편집 권한(순수). 03장 3.5절: 체험만료·구독만료 = 뷰포트 읽기 전용 + 도구 막대 숨김. 6.4절: 화면 폭 767 이하 = 읽기 전용 안내.
// 판정 전(undefined)·거부는 편집 불가(실패 닫힘). 판정 패널·레이어 보기·카메라는 열람에서도 된다.
import type { EntitlementDecision } from "@arch-studio/shell-bridge";
import { DENY_TEXT } from "../../shell/nav.ts";

export interface ModelerAccess {
  readonly editable: boolean;
  /** 권리 판정 중. */
  readonly pending: boolean;
  /** 편집 불가 이유(화면 문구). 편집 가능하면 null. */
  readonly reason: string | null;
  /** 이유 종류: 권리(라이선스 보기 링크) / 화면 폭. */
  readonly kind: "ok" | "pending" | "entitlement" | "narrow";
}

export const READ_ONLY_TITLE = "열람 모드: 편집하려면 라이선스나 구독이 필요합니다";
export const EXPIRED_TEXT = "체험이 끝나 열람과 내보내기만 됩니다. 라이선스나 구독으로 편집을 이어 가세요.";
export const NARROW_TEXT = "편집은 화면 폭 768px 이상(태블릿·PC)에서 할 수 있습니다.";

export function modelerAccess(decision: EntitlementDecision | undefined, wide: boolean): ModelerAccess {
  if (!decision) return { editable: false, pending: true, reason: "편집 권한을 확인하는 중입니다.", kind: "pending" };
  if (!decision.allowed) {
    const reason = decision.reason === "expired" ? EXPIRED_TEXT : `${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람·판정 확인은 그대로 됩니다.`;
    return { editable: false, pending: false, reason, kind: "entitlement" };
  }
  if (!wide) return { editable: false, pending: false, reason: NARROW_TEXT, kind: "narrow" };
  return { editable: true, pending: false, reason: null, kind: "ok" };
}
