// 온보딩 동의(03_SCREENS_UX.md 3.2절). 국외 이전 동의는 기존 RPC `set_ai_cross_border_ack`(owner·admin)를 쓴다.
// 약관 동의는 저장 테이블·RPC가 아직 없다(05장·마이그레이션에 없음, 스키마 변경 금지) → 인터페이스 + 미지원 구현만 둔다.
// 미지원 구현은 "동의 기록 없음"으로 답하므로 finishLogin은 매번 온보딩으로 보낸다(기본 닫힘). 코어/DB 요청: tasks/logs/AR-06-008.md.

export const TERMS_DOCS = ["terms", "license_terms", "privacy"] as const;
export type TermsDoc = (typeof TERMS_DOCS)[number];

export interface TermsConsentStore {
  /** 현재 버전 약관 전부에 동의했는가. */
  hasAcceptedCurrent(userId: string): Promise<boolean>;
  /** 동의 기록. 저장소가 없으면 false(기록 못 함). */
  record(userId: string, docs: readonly TermsDoc[]): Promise<boolean>;
}

export const unsupportedTermsStore: TermsConsentStore = {
  async hasAcceptedCurrent() {
    return false;
  },
  async record() {
    return false;
  },
};

/** 약관 단계 입력 검사: 필수 3종이 모두 체크돼야 한다. */
export function allTermsChecked(checked: ReadonlySet<string>): boolean {
  return TERMS_DOCS.every((d) => checked.has(d));
}

/** 국외 이전 동의 단계를 보여 줄 역할(03장 2.1 6단계: owner·admin). */
export function canSetCrossBorder(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
