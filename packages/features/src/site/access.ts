// 대지 화면 권한·조회 상태(03장 5.1절 잠금·오프라인, 2.2절 실패 분기). 순수 함수.
import type { EntitlementDecision } from "@arch-studio/shell-bridge";
import { DENY_TEXT } from "../shell/nav.ts";

export interface SiteAccess {
  /** 경계·속성 편집·저장·DXF 가져오기. */
  readonly edit: boolean;
  /** 판정 중(undefined)이면 잠그되 잠금 안내 대신 로딩으로 본다. */
  readonly pending: boolean;
  /** 잠금 이유(5.1절). 편집 가능하면 null. */
  readonly lockReason: string | null;
  /** 주소·지번 조회 버튼 상태. */
  readonly lookup: "ok" | "offline" | "locked";
}

/** 체험만료 문구(5.1절). */
export const EXPIRED_TEXT = "체험이 끝나 열람과 내보내기만 됩니다. 라이선스나 구독으로 편집을 이어 가세요.";

/** 편집 권리(desktop_edit/web_edit) 판정 + 온라인 여부 → 화면 상태. 판정 전·실패는 편집 불가(실패 닫힘). */
export function siteAccess(decision: EntitlementDecision | undefined, online: boolean): SiteAccess {
  if (!decision) return { edit: false, pending: true, lockReason: null, lookup: "locked" };
  if (!decision.allowed) {
    const reason = decision.reason === "expired" ? EXPIRED_TEXT : `${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람·내보내기는 그대로 됩니다.`;
    return { edit: false, pending: false, lockReason: reason, lookup: "locked" };
  }
  return { edit: true, pending: false, lockReason: null, lookup: online ? "ok" : "offline" };
}

/** 조회 실패 → 화면 안내. 모든 실패는 직접 그리기로 이어 간다(2.2절). */
export interface LookupFailure {
  readonly message: string;
  /** true면 "직접 그리기" 버튼을 주 행동으로 보인다. */
  readonly toDraw: boolean;
}

export const LOOKUP_TEXT = {
  AR020: "오늘 대지 조회 한도를 모두 썼습니다. 직접 그리기로 이어 가세요.",
  AR021: "공공 데이터 서비스가 응답하지 않습니다. 잠시 뒤 다시 조회하거나 직접 그리세요.",
  notConfigured: "이 환경에서는 대지 조회를 쓰지 않습니다. 직접 그리기나 DXF 가져오기로 대지를 넣으세요.",
  notFound: "입력한 주소·지번의 필지를 찾지 못했습니다. 표기를 확인하거나 직접 그리세요.",
  invalid: "주소·지번 형식이 올바르지 않습니다. 예: 운중동 12-4, 경기도 성남시 분당구 운중로 135",
  offline: "인터넷 연결 후 씁니다. 지금은 직접 그리기로 이어 가세요.",
  badCandidate: "조회한 경계를 쓸 수 없습니다(형식 이상). 직접 그리기로 이어 가세요.",
} as const;

/** API 오류(code·details.reason·userMessage) → 안내. 문구에 입력값을 넣지 않는다. */
export function lookupFailure(code: string, reason: string | undefined, userMessage: string): LookupFailure {
  if (code === "AR020") return { message: LOOKUP_TEXT.AR020, toDraw: true };
  if (code === "AR021") {
    if (reason === "not_configured") return { message: LOOKUP_TEXT.notConfigured, toDraw: true };
    if (reason === "not_found") return { message: LOOKUP_TEXT.notFound, toDraw: true };
    return { message: LOOKUP_TEXT.AR021, toDraw: true };
  }
  if (code === "invalid_input") return { message: LOOKUP_TEXT.invalid, toDraw: false };
  if (code === "network_offline" || code === "queue_expired") return { message: LOOKUP_TEXT.offline, toDraw: true };
  if (code === "invalid_response") return { message: LOOKUP_TEXT.badCandidate, toDraw: true };
  return { message: userMessage, toDraw: true };
}

/** 클라이언트 쪽 입력 사전 검사(서버 schema.ts와 같은 규칙: 제어문자·URL 의미 문자 거부, 2~200자). */
export function lookupInputOk(kind: "address" | "jibun" | "pnu", value: string): boolean {
  const v = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (/[\p{Cc}\p{Cf}]/u.test(value) || v.length < 2 || v.length > 200) return false;
  if (kind === "pnu") return /^\d{10}[12]\d{8}$/.test(v);
  if (!/^[0-9A-Za-zㄱ-ㆎ가-힣 \-.,()·]+$/u.test(v)) return false;
  return kind === "address" || /\d/.test(v);
}
