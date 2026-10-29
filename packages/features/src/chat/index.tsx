// `/chat` 법규 질의 채팅 전체 화면(03장 3.12절). 소유: AR-06-055(셸 오른쪽 패널과 같은 대화). 권리 ai_chat(폴백·만료 잠금).
import { PlaceholderScreen } from "../shell/index.ts";

export function Screen() {
  return (
    <PlaceholderScreen
      title="법규 채팅"
      spec="03장 3.12절"
      owner="AR-06-055"
      feature="ai_chat"
      lockTitle="법규 채팅을 쓸 수 없습니다"
      empty={{ title: "대화가 없습니다", description: "조문 이름이나 지자체를 넣어 법규를 물어보세요. 답변마다 근거 조항을 함께 보여 줍니다." }}
    />
  );
}
