// 04_API.md 7장 오류 코드 → 03_SCREENS_UX.md 5.2·5.3절 화면 문구 매핑 표.
// 문구 정본은 03장이다. 문서에 없는 코드(AR044·AR045·CR001·AI002·앱 코드·클라이언트 코드)는 이 표가 제안값이며
// tasks/logs/AR-06-007.md에 기록한다. 서버가 준 message 원문은 화면에 쓰지 않는다(예외 원문 노출 금지).

export interface ErrorInfo {
  /** 화면에 그대로 보이는 문구(버튼 라벨은 actions로 분리). */
  readonly message: string;
  /** 문구 뒤에 붙는 버튼 라벨(03장 5.2절의 [대괄호] 부분). */
  readonly actions: readonly string[];
}

const info = (message: string, ...actions: string[]): ErrorInfo => ({ message, actions });

/** 안전한 기본 문구: 모르는 코드, 코드 없는 응답. */
export const DEFAULT_ERROR_INFO: ErrorInfo = info(
  "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도하세요. 문제가 계속되면 고객지원에 문의하세요.",
);

/** 서버 SQLSTATE `AR`(04장 7.1절) + 03장 5.2절 문구. */
const SERVER_AR: Record<string, ErrorInfo> = {
  AR001: info("이 라이선스는 PC 2대에서 이미 활성화되어 있습니다. 쓰지 않는 PC를 해제하고 다시 활성화하세요.", "기기 목록"),
  AR002: info("시리얼 번호를 찾지 못했습니다. 메일의 시리얼을 그대로 붙여 넣었는지 확인하세요."),
  AR003: info("정지·환불·회수된 라이선스입니다. 계정의 라이선스 화면에서 상태를 확인하세요."),
  AR004: info("30일 동안 셀프 해제 3회를 모두 썼습니다. 고객지원에 문의하세요."),
  AR005: info("이메일 인증을 마친 계정만 구매할 수 있습니다.", "인증 메일 다시 보내기"),
  AR006: info("다른 조직의 시리얼입니다. 구매한 계정으로 로그인하세요."),
  AR010: info("업데이트 기간 밖의 버전입니다. 사용 가능한 마지막 버전을 설치하거나 업데이트를 연장하세요."),
  AR011: info("이 규칙 팩을 받을 자격이 없습니다. 지금 쓰는 규칙 팩으로 판정합니다."),
  AR012: info("업데이트가 만료되어 클라우드 법규 검토를 쓸 수 없습니다. 로컬 판정은 그대로 됩니다."),
  AR020: info("오늘 대지 조회 한도를 모두 썼습니다. 직접 그리기로 이어 가세요."),
  AR021: info("공공 데이터 서비스가 응답하지 않습니다. 잠시 뒤 다시 조회하거나 직접 그리세요."),
  // 지도·주소 검색 스위치 꺼짐(503, 서버 site/http.ts). 알려진 코드라 자동 재시도하지 않는다(api-error.ts isAutoRetryable).
  site_map_disabled: info("지도 기능이 꺼져 있습니다. 대지 가로·세로를 직접 넣거나 직접 그리세요."),
  AR030: info("렌더가 3건 진행 중입니다. 하나가 끝나면 시작하세요."),
  AR034: info("오늘 서비스 전체 AI 사용 한도에 도달했습니다. 크레딧은 차감되지 않았습니다. 내일 다시 시도하세요. 로컬 판정·도면은 그대로 됩니다."),
  AR031: info("보내는 파일이 너무 큽니다. 해상도를 낮추거나 시트 수를 줄이세요."),
  AR032: info("요구를 정리하지 못했습니다. 크레딧을 돌려드렸습니다. 문장을 나눠 다시 시도하세요."),
  AR033: info("근거를 확인하지 못한 검토 결과라 보여 드리지 않습니다. 크레딧 15를 돌려드렸습니다."),
  AR040: info("클라우드 사본 개수 한도에 도달했습니다. 오래된 사본을 지우세요."),
  AR041: info(
    "다른 곳에서 이 프로젝트가 먼저 저장되었습니다. 병합하지 않습니다. 내 변경을 사본으로 저장하거나 서버 최신 열기 중 고르세요. 서버 최신을 열면 저장하지 않은 변경은 사라집니다(먼저 파일로 내려받을 수 있습니다).",
    "내 변경을 사본으로 저장",
    "서버 최신 열기",
    "파일로 내려받기",
  ),
  AR042: info("표제란 설정은 조직 owner·admin만 저장합니다."),
  AR043: info("구매한 좌석을 모두 배정했습니다. 좌석을 추가로 구매하거나 다른 멤버의 배정을 해제하세요."),
  // 아래 둘은 03장 5.2절에 없음(제안값).
  AR044: info("편집 권한이 없어 저장하지 못했습니다. 열람·내보내기·프로젝트 내려받기는 보존 기한까지 가능합니다.", "프로젝트 내려받기"),
  AR045: info("좌석을 지금은 다시 배정할 수 없습니다. 회수 후 대기 기간이거나 재배정 한도를 넘었습니다."),
};

/** 402 `entitled=false` 사유별(03장 5.2절 표). no_product·fallback은 제안값. */
const ENTITLEMENT_BY_REASON: Record<string, ErrorInfo> = {
  expired: info("이용 기간이 끝나 편집과 저장은 되지 않습니다. 열람·내보내기·프로젝트 내려받기는 보존 기한까지 가능합니다.", "프로젝트 내려받기"),
  seat_unassigned: info("배정된 좌석이 없습니다. 조직 관리자에게 좌석 배정을 요청하세요. 열람·내보내기·프로젝트 내려받기는 보존 기한까지 가능합니다.", "프로젝트 내려받기"),
  seat_revoked: info("좌석 배정이 해제되었습니다. 열람·내보내기·프로젝트 내려받기는 보존 기한까지 가능합니다.", "프로젝트 내려받기"),
  no_product: info("이용 중인 상품이 없어 편집과 저장은 되지 않습니다. 열람·내보내기·프로젝트 내려받기는 보존 기한까지 가능합니다.", "프로젝트 내려받기"),
  fallback: info("현재 이용 상태에서는 이 기능을 쓸 수 없습니다. 로컬 판정·도면은 그대로 됩니다.", "프로젝트 내려받기"),
};
const ENTITLEMENT_GENERIC = ENTITLEMENT_BY_REASON["expired"] as ErrorInfo;

const AR045_BY_REASON: Record<string, ErrorInfo> = {
  cooldown: info("회수한 좌석은 7일 동안 다시 배정할 수 없습니다. 회수한 기기의 해제가 확인되면 바로 배정할 수 있습니다."),
  reassign_limit: info("좌석 재배정은 30일에 2회까지입니다. 한도를 넘어 지금은 배정할 수 없습니다."),
};

/** 코어·공통 코드(04장 7.2절). AI001만 03장 5.2절, 나머지는 제안값. */
const CORE: Record<string, ErrorInfo> = {
  CR001: info("크레딧이 부족합니다. 크레딧 화면에서 충전한 뒤 다시 시도하세요.", "크레딧 충전"),
  AI001: info("이 조직은 오픈소스 AI만 쓰도록 정해져 있어 바꿀 수 없습니다."),
  AI002: info("국외 이전 동의가 필요합니다. 동의 안내를 확인한 뒤 다시 시도하세요."),
  "42501": info("이 작업을 할 권한이 없습니다. 조직 관리자에게 문의하세요."),
  "22023": info("입력 값이 올바르지 않습니다. 내용을 확인하고 다시 시도하세요."),
  JB002: info("작업 상태가 맞지 않아 처리하지 못했습니다. 잠시 뒤 다시 시도하세요."),
  SB001: info("요청이 현재 상태와 맞지 않습니다. 화면을 새로 고친 뒤 다시 시도하세요."),
  PM410: info("요청이 현재 상태와 맞지 않습니다. 화면을 새로 고친 뒤 다시 시도하세요."),
  P0002: info("대상을 찾지 못했습니다. 삭제되었거나 접근할 수 없는 항목입니다."),
  PM404: info("대상을 찾지 못했습니다. 삭제되었거나 접근할 수 없는 항목입니다."),
  PM001: info("처리 중 충돌이 생겼습니다. 운영팀에 알렸습니다. 잠시 뒤 다시 시도하세요."),
  PM409: info("처리 중 충돌이 생겼습니다. 운영팀에 알렸습니다. 잠시 뒤 다시 시도하세요."),
  "23514": info("입력 값이 허용 범위를 벗어났습니다. 내용을 확인하고 다시 시도하세요."),
};

/** Route Handler 앱 코드(04장 7.2절 아래 단락). 문구는 제안값. */
const APP: Record<string, ErrorInfo> = {
  checkout_unavailable: info("지금은 결제를 진행할 수 없습니다. 잠시 뒤 다시 시도하세요."),
  license_required: info("라이선스가 필요한 기능입니다. 라이선스를 활성화한 뒤 다시 시도하세요."),
  recording_notice_required: info("녹음 안내 확인이 필요합니다. 안내를 확인하고 동의한 뒤 다시 시도하세요."),
  AI_DAILY_LIMIT: info("오늘 AI 사용 한도에 도달했습니다. 크레딧은 차감되지 않았습니다. 내일 다시 시도하세요. 로컬 판정·도면은 그대로 됩니다."),
  AI_UNAVAILABLE: info("AI 서비스가 일시적으로 응답하지 않습니다. 크레딧은 돌려드렸습니다. 잠시 뒤 다시 시도하세요."),
  VOICE_TOO_LONG: info("녹음이 너무 깁니다. 나눠서 다시 올려 주세요."),
  rate_limited: info("요청이 너무 많습니다. 잠시 뒤 다시 시도하세요."),
  // AR-06-056 렌더 실패 닫힘 스위치(503). 표에 있으면 자동 재시도하지 않는다(isAutoRetryable).
  ai_render_disabled: info("지금은 AI 렌더를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다. 로컬 모델·판정·도면은 그대로 됩니다."),
};

/** 로컬 앱 오류(04장 7.3절, 03장 5.3절). 서버가 내지 않지만 화면 문구 표는 한곳에 둔다. 060·061은 7.3절 UI 처리에서 만든 제안값. */
const LOCAL: Record<string, ErrorInfo> = {
  AR050: info("모델에 빠진 정보가 있어 시트를 만들 수 없습니다. 모델에서 고치세요.", "모델에서 고치기"),
  AR051: info("실이 다른 실과 겹치거나 층 외곽 밖에 있습니다. 고친 뒤 저장하세요."),
  AR052: info("파일을 저장하지 못했습니다. 디스크 공간과 폴더 쓰기 권한을 확인하세요.", "다른 위치 선택"),
  AR053: info("도면 단위를 판별하지 못했습니다. 이 도면의 단위를 골라 주세요.", "mm", "m"),
  AR054: info("지원하지 않는 요소를 건너뛰었습니다. 나머지로 계속합니다."),
  AR055: info("파일이 20MB를 넘습니다. 필요한 레이어만 남겨 다시 저장하세요."),
  AR056: info("PDF를 만들지 못했습니다. DXF·SVG는 따로 내보낼 수 있습니다."),
  AR057: info("선택한 글꼴을 찾지 못해 대체 글꼴로 표시합니다. CAD에서 한글이 깨지면 같은 이름의 글꼴을 설치하세요."),
  AR058: info("선택한 용지에 1/600으로도 들어가지 않습니다. 더 큰 용지를 고르세요."),
  AR059: info("이전 엔진으로 만든 시트입니다. 다시 만들면 현재 엔진 기준으로 바뀝니다. 주석 위치는 유지합니다.", "다시 만들기", "그대로 보기"),
  AR060: info("로컬 데이터를 열지 못했습니다. 마지막 백업 위치를 확인하고 고객지원에 문의하세요. 저장은 막혀 있습니다."),
  AR061: info("읽기 전용 모드입니다. 저장·삭제는 막혀 있고 열기·내보내기는 가능합니다. 앱을 다시 시작하고 디스크 공간을 확인하세요."),
  // 규칙 팩 공급 상태(AR-06-042, 04장 7.3절 추가 제안). 판정 화면 문구는 judgment/messages.ts judgeErrorText와 같은 뜻.
  AR063: info("설치된 규칙 팩이 없어 판정할 수 없습니다. 온라인에서 라이선스를 확인하면 규칙 팩을 받습니다."),
  AR064: info("규칙 팩이 손상됐거나 서명이 맞지 않아 쓰지 않았습니다. 규칙 팩을 다시 받으세요."),
  AR065: info("규칙 팩을 쓸 수 있는 기간이 아닙니다. 다시 연결해 라이선스를 확인하세요. 열람·내보내기는 계속됩니다."),
};

/** 클라이언트가 만드는 코드(서버 계약 아님). */
const CLIENT: Record<string, ErrorInfo> = {
  unauthenticated: info("로그인이 필요합니다. 다시 로그인하세요.", "로그인"),
  network_offline: info("서버에 연결하지 못했습니다. 연결이 돌아오면 자동으로 다시 시도합니다."),
  server_error: info("서버에 문제가 생겼습니다. 잠시 뒤 다시 시도하세요."),
  aborted: info("요청을 취소했습니다."),
  queue_full: info("대기 중인 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요."),
  queue_expired: info("연결이 오래 끊겨 요청을 보내지 못했습니다. 연결을 확인하고 다시 시도하세요."),
  invalid_response: info("서버 응답을 해석하지 못했습니다. 앱을 업데이트했는지 확인하고 다시 시도하세요."),
  forbidden_field: info("앱 내부 오류입니다. 요청에 보낼 수 없는 값이 들어 있어 보내지 않았습니다. 고객지원에 문의하세요."),
};

export const ERROR_INFO: Readonly<Record<string, ErrorInfo>> = Object.freeze({
  ...SERVER_AR,
  ...CORE,
  ...APP,
  ...LOCAL,
  ...CLIENT,
});

/** 코드가 매핑 표에 있는가(재시도 판단 등에 쓴다). */
export function isKnownCode(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(ERROR_INFO, code);
}

/**
 * 화면 문구와 버튼. 서버가 준 message 원문은 쓰지 않는다.
 * details.reason은 402 entitled=false(사유별)와 AR045(cooldown·reassign_limit)에서만 본다.
 */
export function errorInfoFor(code: string | null | undefined, details?: { readonly reason?: unknown } | null): ErrorInfo {
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  if (code === "AR044" || code === "entitled_false") {
    const byReason = reason !== undefined ? ENTITLEMENT_BY_REASON[reason] : undefined;
    return byReason ?? (code === "AR044" ? (ERROR_INFO["AR044"] as ErrorInfo) : ENTITLEMENT_GENERIC);
  }
  if (code === "AR045" && reason !== undefined) {
    const byReason = AR045_BY_REASON[reason];
    if (byReason) return byReason;
  }
  if (code && isKnownCode(code)) return ERROR_INFO[code] as ErrorInfo;
  return DEFAULT_ERROR_INFO;
}

export function errorMessageFor(code: string | null | undefined, details?: { readonly reason?: unknown } | null): string {
  return errorInfoFor(code, details).message;
}
