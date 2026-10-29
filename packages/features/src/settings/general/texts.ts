// 일반 설정 고지 문구(PRD 6장 표 "국외 이전"·"녹음 고지"·"오픈소스 고지", 03장 3.2절 2단계 범위). 문구 정본은 PRD 6장이다.

/** PRD 6장 "녹음 고지" 문구 그대로. */
export const RECORDING_NOTICE =
  "이 녹음에는 상담 참석자의 목소리와 발언이 담깁니다. 녹음 전에 참석자에게 알리고 동의를 받는 책임은 사용자에게 있습니다. 녹음은 요구사항 정리에만 쓰고 처리 후 24시간 안에 삭제합니다.";

/** PRD 6장 "국외 이전" + 9.7절(대화형 입력 문장 추가). */
export const CROSS_BORDER_SENT = ["렌더 입력 이미지(뷰포트 깊이·윤곽)", "법규 질의와 근거 조각", "제안서 서술 섹션 입력", "대화형 설계 입력 문장"] as const;
export const CROSS_BORDER_NOT_SENT = ["도면·3D 원본", "건축주 연락처", "상담 녹음(오픈소스 경로 강제)"] as const;
export const CROSS_BORDER_NOTE = "동의 전에는 오픈소스 경로만 씁니다. 가격은 같습니다.";

/** PRD 6장 "오픈소스 고지" 요약(전문은 THIRD_PARTY_NOTICES). */
export const OSS_SUMMARY = "Manifold(Apache-2.0), Noto Sans KR(SIL OFL 1.1), jsPDF(MIT), zod(MIT) 등. GPL 구성요소는 앱에 넣지 않습니다.";

export const SIGN_OUT_CONFIRM = {
  title: "로그아웃할까요?",
  body: "이 PC의 자격 증명 저장소에서 세션을 지웁니다. 이 PC에 저장된 프로젝트는 지우지 않습니다.",
} as const;
