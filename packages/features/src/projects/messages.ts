// 프로젝트 화면 문구와 오류 분류(03장 5.1·5.2·5.4절, 04장 7.3절 AR060·AR061, ADR-001 3.2). 순수 함수(node --test 대상).
// 오류는 코드로만 판별한다(값·경로·이름을 문구에 넣지 않는다). 로컬 저장소 오류는 BridgeError 모양, 클라우드는 ApiError 코드.
import type { EntitlementDecision } from "@arch-studio/shell-bridge";
import { bridgeErrorCode } from "../shell/errors.ts";
import { DENY_TEXT } from "../shell/nav.ts";

export const TEXT = {
  title: "프로젝트",
  description: "만들던 프로젝트를 이어서 엽니다.",
  newProject: "새 프로젝트",
  sample: "샘플 대지로 시작",
  sampleLater: "샘플 대지 묶음은 아직 이 빌드에 없습니다.",
  /** 5.4절 빈 상태 그대로. */
  emptyTitle: "아직 프로젝트가 없습니다",
  emptyDescription: "예시 대지로 판정과 도면을 먼저 확인해 보세요.",
  filteredEmptyTitle: "조건에 맞는 프로젝트가 없습니다",
  filteredEmptyDescription: "검색어나 저장 위치 필터를 바꿔 보세요.",
  loading: "프로젝트 목록을 불러오는 중",
  listErrorTitle: "프로젝트 목록을 불러오지 못했습니다",
  todayTitle: "오늘 처리할 일",
  todayEmpty: "오늘 처리할 일이 없습니다",
  todayEmptyDescription: "열람 모드·폴백·저장 충돌이 생기면 여기에 모입니다.",
  cloudSignedOut: "로그인하면(인터넷 연결 후) 클라우드 작업이 보입니다.",
  cloudUnavailable: "클라우드 사본 정보를 불러오지 못했습니다. 목록은 이 PC 기준으로 보입니다.",
  /** 5.1절 저장 모드 칩. */
  chipLocal: "이 PC에만",
  chipLocalLong: "이 PC에만 저장됨 · 서버에 없음",
  chipCloud: "클라우드 사본",
  /** 5.1절 체험만료 잠금 문구. */
  viewOnlyExpired: "체험이 끝나 열람과 내보내기만 됩니다. 라이선스나 구독으로 편집을 이어 가세요.",
  viewOnlyTitle: "열람 모드",
  newLocked: "새 프로젝트를 만들 수 없습니다",
  /** AR061(04장 7.3절): 저장·삭제 차단, 열기·내보내기 허용. */
  readOnlyTitle: "저장소가 읽기 전용 상태입니다",
  readOnlyBody: "열람·내보내기만 됩니다. 앱을 다시 시작하고 디스크 여유 공간을 확인하세요. 계속되면 고객지원에 문의하세요.",
  /** AR060(04장 7.3절): 목록 대신 복구 안내, 저장 차단. */
  corruptTitle: "이 PC의 프로젝트 저장소를 열지 못했습니다",
  corruptBody:
    "백업에서 복구하거나 고객지원에 문의하세요. 업데이트 전 스냅샷은 앱 데이터 폴더의 backups/pre-migrate.db에 있습니다. 지금은 저장하지 않습니다.",
  saveFailed: "저장하지 못했습니다. 잠시 뒤 다시 저장하세요.",
  /** AR041 / VERSION_CONFLICT(5.2절, ADR-001 3장). 두 선택만. */
  conflictTitle: "다른 곳에서 먼저 저장되었습니다",
  conflictBody: "다른 곳에서 이 프로젝트가 먼저 저장되었습니다. 병합하지 않습니다. 아래 두 가지 중 고르세요.",
  conflictCopy: "내 변경을 사본으로 저장",
  conflictLatestCloud: "서버 최신 열기",
  conflictLatestLocal: "저장된 최신 열기",
  conflictLatestWarn: "최신을 열면 저장하지 않은 변경은 사라집니다.",
  /** 5.2절 AR040. n은 서버가 주는 상한. */
  cloudLimit: (n: number | null) =>
    n === null ? "클라우드 사본 개수 한도에 도달했습니다. 오래된 사본을 지우세요." : `클라우드 사본은 ${n}개까지 올립니다. 오래된 사본을 지우세요.`,
  historyTitle: "버전 이력",
  historyUnavailable: "이 빌드는 이전 버전 목록을 아직 읽지 못합니다. 지금 버전만 보입니다.",
  historyRestoreNote: (v: number) => `v${v}에서 복원`,
  deleteTitle: "프로젝트를 삭제할까요?",
  deleteBody: "삭제하면 목록에서 사라집니다. 클라우드 사본은 지워지지 않습니다.",
} as const;

/** 거부 사유 → 열람 모드 문구(5.1절). 만료는 5.1절 문구 그대로, 나머지는 셸 짧은 사유 + 다음 행동. */
export function viewOnlyReason(decision: EntitlementDecision | undefined): string | null {
  if (!decision || decision.allowed) return null;
  if (decision.reason === "expired") return TEXT.viewOnlyExpired;
  return `${DENY_TEXT[decision.reason] ?? DENY_TEXT.unverified}. 열람과 내보내기만 됩니다. 라이선스 화면에서 상태를 확인하세요.`;
}

/** 화면이 만드는 저장소 오류(070 BridgeError와 같은 모양: name "BridgeError" + code, 메시지에 값 없음). */
export function localError(code: "NOT_FOUND" | "AR060"): Error & { code: string } {
  const e = new Error(`shell-bridge: ${code}`) as Error & { code: string };
  e.name = "BridgeError";
  e.code = code;
  return e;
}

/** 로컬 저장소 오류 분류. corrupt = AR060(목록 대신 복구 안내), readOnly = AR061(저장·삭제 차단), conflict = 버전 충돌. */
export type StoreProblem = "corrupt" | "readOnly" | "conflict" | "notFound" | "invalid" | "other";

export function classifyStoreError(err: unknown): StoreProblem {
  switch (bridgeErrorCode(err)) {
    case "AR060":
      return "corrupt";
    case "AR061":
      return "readOnly";
    case "VERSION_CONFLICT":
      return "conflict";
    case "NOT_FOUND":
      return "notFound";
    case "INVALID_INPUT":
      return "invalid";
    default:
      return "other";
  }
}

/** 쓰기(저장·삭제·복원·이름 바꾸기) 실패 문구. 충돌·읽기 전용은 화면이 대화상자·배너로 따로 보인다. */
export function storeErrorText(err: unknown): string {
  switch (classifyStoreError(err)) {
    case "corrupt":
      return TEXT.corruptTitle + ". " + TEXT.corruptBody;
    case "readOnly":
      return TEXT.readOnlyTitle + ". " + TEXT.readOnlyBody;
    case "conflict":
      return TEXT.conflictBody;
    case "notFound":
      return "프로젝트를 찾지 못했습니다. 목록에서 다시 여세요.";
    case "invalid":
      return "입력 값을 저장할 수 없습니다. 이름·대지 정보를 확인하세요.";
    default:
      return TEXT.saveFailed;
  }
}

/** 클라우드 저장 오류(ApiError.code) 분류. AR041 = 충돌(2선택), AR040 = 한도, 402 = 편집 권한 없음. */
export type CloudProblem = "conflict" | "limit" | "tooLarge" | "noEdit" | "offline" | "other";

export function classifyCloudError(code: string | null | undefined, httpStatus?: number | null): CloudProblem {
  if (code === "AR041") return "conflict";
  if (code === "AR040") return "limit";
  if (code === "AR031") return "tooLarge";
  if (httpStatus === 402 || code === "entitlement_expired") return "noEdit";
  if (code === "network_offline" || code === "queue_expired") return "offline";
  return "other";
}

/** 클라우드 저장 실패 문구(5.1·5.2절, ADR-001 3.2). */
export function cloudErrorText(code: string | null | undefined, httpStatus?: number | null, limit: number | null = null): string {
  switch (classifyCloudError(code, httpStatus)) {
    case "conflict":
      return `${TEXT.conflictBody} 최신을 열면 저장하지 않은 변경은 사라집니다(먼저 파일로 내려받기 가능).`;
    case "limit":
      return TEXT.cloudLimit(limit);
    case "tooLarge":
      return "보내는 파일이 너무 큽니다. 저장 안 됨. 파일로 내려받아 보관하세요.";
    case "noEdit":
      return "편집 권한이 없어 저장하지 못했습니다. 열람·내보내기·프로젝트 내려받기는 그대로 됩니다.";
    case "offline":
      return "인터넷 연결 후 씁니다.";
    default:
      return TEXT.saveFailed;
  }
}

/** 수정일 표시(로캘 비의존, 결정적): YYYY-MM-DD HH:mm(기기 시간대). 깨진 값은 "-". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
