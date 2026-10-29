// AI 국외 이전 동의 상태(03장 3.15절 "owner·admin 변경", 2.1 6단계, PRD 6장 "국외 이전").
// DB에는 `public.set_ai_cross_border_ack(p_org_id, p_ack, p_notice_version)`(owner·admin, 42501)과 `ai_org_settings`가 있지만
// 설치형·웹 화면이 부를 HTTP 경로(상태 조회·변경)가 없다(04_API.md에 없음, 이 작업 소유 경로 밖) → 008 `unsupportedTermsStore`와
// 같은 방식으로 인터페이스 + 미지원 구현만 둔다: 상태는 "확인할 수 없음", 변경은 항상 실패(기록 안 함). 화면은 상태 표시·잠금까지.
// 연결할 때: 서버 경로(예: GET|PUT /api/ai-consent, 세션 조직·owner·admin, 고지문 버전은 서버 env AI_CROSS_BORDER_NOTICE_VERSION)를 만들고
// 이 인터페이스의 구현만 바꾼다.

export type ConsentStatus =
  | { readonly kind: "unknown" }
  | { readonly kind: "acked"; readonly at: string; readonly noticeVersion: string }
  | { readonly kind: "not_acked" };

export interface ConsentStore {
  /** 조직의 국외 이전 동의 상태. */
  crossBorder(): Promise<ConsentStatus>;
  /** 동의·철회 기록. 저장소가 없으면 false(기록 못 함). */
  setCrossBorder(ack: boolean): Promise<boolean>;
  /** 상담 녹음 고지문 버전(서버 ARCH_RECORDING_NOTICE_VERSION). 모르면 null. */
  recordingNoticeVersion(): Promise<string | null>;
}

export const unsupportedConsentStore: ConsentStore = {
  async crossBorder() {
    return { kind: "unknown" };
  },
  async setCrossBorder() {
    return false;
  },
  async recordingNoticeVersion() {
    return null;
  },
};

/** 국외 이전 동의를 바꿀 수 있는 역할(03장 2.1 6단계·DB set_ai_cross_border_ack: owner·admin). 화면 표시용이고 DB가 다시 거부한다. */
export function canChangeCrossBorder(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export interface ConsentView {
  readonly label: string;
  /** 스위치 조작 가능 여부. */
  readonly changeable: boolean;
  readonly reason: string | null;
}

export function consentView(status: ConsentStatus, role: string | null | undefined, storeSupported: boolean): ConsentView {
  const label =
    status.kind === "acked" ? `동의함(고지문 ${status.noticeVersion})` : status.kind === "not_acked" ? "동의하지 않음 — 오픈소스 경로만 씁니다" : "확인할 수 없음";
  if (!canChangeCrossBorder(role)) return { label, changeable: false, reason: "국외 이전 동의는 조직 owner·admin만 바꿀 수 있습니다." };
  if (!storeSupported) return { label, changeable: false, reason: "이 앱 버전에서는 동의 상태를 바꿀 수 없습니다. 서버 연결 후 제공합니다." };
  return { label, changeable: true, reason: null };
}
