// `/projects/:id/plans` 평면 개략도 편집기(03장 3.7절, P1). 소유: AR-06-027. 검증은 useEngine()(017 layout 레인).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="평면"
      spec="03장 3.7절"
      owner="AR-06-027"
      empty={{ title: "이 층에 배치한 실이 없습니다", description: "왼쪽 실 목록에서 끌어 놓거나 [실 그리기 R]. 면적표가 비어 있으면 [프로그램에서 면적표 만들기]" }}
    />
  );
}
