// 화면 문구(03장 3.14절, PRD 9.1·9.7절). 고정 고지는 도면 엔진 표제란 상수(packages/drafting titleblock DISCLAIMER)와 같은 글자 —
// 화면은 보여 주기만 하고 엔진이 모든 시트에 넣는다(texts.test.ts가 정본과 대조).
import { errorMessageFor } from "../../api-client/index.ts";

export const DISCLAIMER_TEXT = "기획설계 검토용 자료이며 인허가 설계도서가 아닙니다";

/** 저장 실패 문구: 007 오류 표(AR042 = "표제란 설정은 조직 owner·admin만 저장합니다.")를 그대로 쓴다. 서버 message 원문은 쓰지 않는다. */
export function saveErrorText(code: string | null, userMessage: string | null): string {
  if (code === "invalid_input" || code === "22023") return "입력 값을 확인하세요. 줄바꿈·제어 문자와 너무 긴 값은 저장할 수 없습니다.";
  if (code === "23514") return "로고 파일을 확인하지 못했습니다. 로고를 다시 올리세요.";
  if (code === "unsupported_media_type") return "PNG 로고만 쓸 수 있습니다. 위치·작성자 정보가 없는 PNG로 다시 올리세요.";
  if (code) return errorMessageFor(code);
  return userMessage ?? errorMessageFor(null);
}
