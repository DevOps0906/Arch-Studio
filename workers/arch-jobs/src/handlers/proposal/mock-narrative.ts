// 개발·테스트 전용 모의 서술: 외부 호출 없이 요약(열거값)에서 고정 문장을 만든다(결정적, 숫자 없음).
// 선택은 src/config.ts가 development·test에서만 허용한다.
import type { NarrativeClient } from "./narrative.ts";

export function mockNarrativeClient(): NarrativeClient {
  return {
    crossBorder: false, // 외부 호출 없음
    async narrate(req) {
      if (req.signal.aborted) throw req.signal.reason;
      const { verdicts, has_cost, sheet_count_label } = req.summary;
      const fail = verdicts.some((v) => v.verdict === "FAIL");
      const warn = verdicts.some((v) => v.verdict === "WARN");
      const judgment = fail
        ? "일부 판정 항목이 기준을 충족하지 못해 계획 조정이 필요합니다."
        : warn
          ? "판정 항목은 대체로 기준 안에 있으며, 확인이 필요한 항목이 있습니다."
          : "검토한 판정 항목이 모두 기준 안에 있습니다.";
      return {
        model: "mock-narrative-v1",
        sections: [
          { heading: "계획 개요", body: "대지 조건과 법규 엔벨로프 안에서 계획안을 정리했습니다. 세부 수치는 아래 표를 기준으로 합니다." },
          { heading: "법규 검토 요약", body: judgment },
          {
            heading: "다음 단계",
            body: `${has_cost ? "개략 공사비는 참고용입니다. " : ""}${sheet_count_label === "some" ? "첨부 도면은 검토용 개략도입니다. " : ""}인허가 전에 건축사의 최종 검토가 필요합니다.`,
          },
        ],
      };
    },
  };
}
