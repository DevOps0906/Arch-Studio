// `/projects/:id/program` 체크리스트·면적표·개략 공사비(03장 3.6절, 2.3절). 소유: AR-06-038(program/**, intake/ 제외).
// 대화형 입력 패널은 program/intake/**(AR-06-052). 면적 계산은 packages/program 결정적 함수만(LLM 좌표·수치 금지).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="프로그램"
      spec="03장 3.6절"
      owner="AR-06-038 (대화형 입력 AR-06-052)"
      empty={{ title: "면적표가 비어 있습니다", description: "체크리스트에 답하면 실 목록과 목표 면적표를 만듭니다." }}
    />
  );
}
