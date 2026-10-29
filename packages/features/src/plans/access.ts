// 평면 화면 권한(03장 5.1절 잠금, 6.4절 모바일 보장 범위). 순수 함수.
import type { EntitlementDecision } from "@arch-studio/shell-bridge";
import { DENY_TEXT } from "../shell/nav.ts";

export const EXPIRED_TEXT = "체험이 끝나 열람과 내보내기만 됩니다. 라이선스나 구독으로 편집을 이어 가세요.";
export const NARROW_TEXT = "편집은 화면 폭 768 이상(태블릿·PC)에서 할 수 있습니다. 지금은 열람만 됩니다.";

export interface PlansAccess {
  /** 실·벽·문·창 편집과 저장. 권리가 있고 화면 폭이 768 이상일 때만 참. */
  readonly edit: boolean;
  /** 판정 전(undefined): 잠그되 잠금 안내 대신 로딩으로 본다. */
  readonly pending: boolean;
  /** 권리 때문에 잠긴 이유(5.1절). 권리가 있으면 null. */
  readonly lockReason: string | null;
  /** 폭 때문에 열람만인가(권리와 별개). */
  readonly narrow: boolean;
}

/** 편집 권리(desktop_edit/web_edit) + 화면 폭 → 상태. 판정 전·실패는 편집 불가(실패 닫힘). */
export function plansAccess(decision: EntitlementDecision | undefined, wide: boolean): PlansAccess {
  if (!decision) return { edit: false, pending: true, lockReason: null, narrow: !wide };
  if (!decision.allowed) {
    const reason = decision.reason === "expired" ? EXPIRED_TEXT : `${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람·내보내기는 그대로 됩니다.`;
    return { edit: false, pending: false, lockReason: reason, narrow: !wide };
  }
  return { edit: wide, pending: false, lockReason: null, narrow: !wide };
}
