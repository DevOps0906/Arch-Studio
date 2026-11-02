// `/chat` 법규 질의 채팅 전체 화면(03장 3.12절). 소유: AR-06-055. 권리 ai_chat(폴백·만료 잠금).
// 셸 오른쪽 패널은 같은 ChatPanel(variant="side")을 쓴다(셸 연결은 셸 작업 소유).
import { PageHeader } from "../shell/index.ts";
import { ChatPanel } from "./ChatPanel.tsx";

export { ChatPanel } from "./ChatPanel.tsx";

export function Screen() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-gap">
      <PageHeader title="법규 채팅" description="법령·조례·해설 근거와 함께 답합니다. 답변마다 출처 조항과 시행일을 확인하세요." />
      <ChatPanel variant="page" />
    </div>
  );
}
