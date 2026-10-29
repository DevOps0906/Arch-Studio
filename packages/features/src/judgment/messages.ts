// 판정 패널 고정 문구·이유 문구(03장 3.5·5.1절, PRD 6.1·9.7절 금지 문구 점검 대상). 문구는 한 곳에만 둔다.

/** 판정 패널 하단 고정 문구(03장 3.5절, PRD :225). 한 글자도 바꾸지 않는다. */
export const DISCLAIMER = "판정은 설계 검토를 돕는 참고 자료입니다. 최종 판단은 건축사와 허가권자가 합니다.";

/** 규칙 팩에 확정된 수치가 없을 때(현재 팩 2026.10.0 전부). PASS를 만들지 않는다. */
export const UNVERIFIED_TEXT = "미확인 — 규칙 팩에 확정된 수치가 없습니다";

/** 근거 칸이 원문 대조 전임을 나타내는 값(packages/rules UNVERIFIED와 같은 값, 규칙 팩 데이터가 쓴다). */
export const UNVERIFIED_BASIS = "미확인";

export const PANEL_TITLE = "법규 판정";
export const TARGET_SECTION_TITLE = "대상 여부";
export const TARGET_SECTION_NOTE = "내진설계·제로에너지건축물·허가권자 지정감리 대상인지만 판정합니다. 설계 내용은 검토하지 않습니다.";

export const EMPTY_TITLE = "매스가 없습니다";
export const EMPTY_DESCRIPTION = "엔벨로프 안에 매스를 그리면 판정이 시작됩니다.";

export const LOADING_LABEL = "판정 계산 중";
export const REFRESHING_LABEL = "판정 갱신 중";

/** 상태 배지 글자(색만으로 구분하지 않는다: 배지는 아이콘 + 글자). */
export const STATUS_LABEL = {
  pass: "통과",
  warn: "확인 필요",
  fail: "기준 초과",
  unverified: "미확인",
  na: "산정값",
  target: "대상",
  not_target: "대상 아님",
} as const;

/** 접근성 이름에 붙는 설명(스크린리더). */
export const STATUS_HINT = {
  pass: "판정 결과 통과",
  warn: "판정 결과 확인 필요",
  fail: "판정 결과 기준 초과",
  unverified: "판정 결과 미확인, 규칙 팩에 확정된 수치가 없음",
  na: "산정값만 표시",
  target: "대상 여부 대상",
  not_target: "대상 여부 대상 아님",
} as const;

/** 엔진 reason 코드 → 문구(packages/rules REASON_MESSAGES와 같은 문장. 코드가 늘면 이 표에 더한다). */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  UNVERIFIED_RULE: "확인 필요: 규칙 팩의 근거 조문·시행일이 미확인입니다(법규 원문 대조 전). 측정값만 참고로 표시합니다.",
  UNSUPPORTED_REGION: "미지원: 직접 확인 필요. 규칙 팩의 지원 지역이 아니어서 합격·불합격을 표시하지 않습니다.",
  ORDINANCE_UNVERIFIED: "조례 미확인: 국가 기준 참고값입니다. 조례 기준을 직접 확인하세요.",
  DISTRICT_NOT_IN_PACK: "확인 필요: 이 용도지역의 기준이 규칙 팩에 없습니다.",
  USE_NOT_IN_PACK: "확인 필요: 일부 용도의 주차 기준이 규칙 팩에 없습니다.",
  NOT_COMPUTED_HERE: "확인 필요: 일조사선은 법규 엔벨로프에서 판정합니다.",
  CALCULATION_ONLY: "산정값: 계획 주차대수 입력이 없어 필요 대수만 표시합니다.",
  TARGET: "대상: 해당 설계 기준을 확인하세요.",
  NOT_TARGET: "대상 아님(규칙 팩 기준).",
  MASS_OUTSIDE_SITE: "매스가 대지 경계 밖으로 나갑니다(이격 0으로 판정).",
  NO_MASS: "매스가 없어 측정하지 않았습니다.",
  FAR_EXCLUSIONS_UNVERIFIED: "산정 제외 항목 미확인: 용적률 연면적은 지하층만 뺀 참고값입니다.",
};

/** 판정 요청 오류 문구(03장 5.3절 AR05x 계열의 판정 맥락 문구, 원인 + 다음 행동). */
export function judgeErrorText(code: string | null): { title: string; description: string } {
  switch (code) {
    case "ENGINE_UNAVAILABLE":
      return { title: "판정 엔진을 쓸 수 없습니다", description: "이 환경에서는 판정 계산기를 시작하지 못했습니다. 앱을 다시 열어 보세요." };
    case "AR050":
      return { title: "모델에 빠진 정보가 있어 판정할 수 없습니다", description: "대지 경계와 매스, 층 정보를 확인한 뒤 다시 시도하세요." };
    case "INVALID_RESPONSE":
      return { title: "판정 결과를 읽지 못했습니다", description: "결과 형식이 맞지 않습니다. 다시 시도하세요." };
    default:
      return { title: "판정을 계산하지 못했습니다", description: "잠시 뒤 다시 시도하세요. 계속되면 규칙 팩과 모델을 확인하세요." };
  }
}
