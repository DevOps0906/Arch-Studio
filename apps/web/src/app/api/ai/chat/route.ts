import { chatDeps } from "../../../../server/ai/chat/deps.ts";
import { handleChat } from "../../../../server/ai/chat/service.ts";

// POST /api/ai/chat (04_API.md 2.2절, AR-06-054). SSE 응답. 설정이 없으면 503(차감 0). 본체는 server/ai/chat/service.ts.
// 상류 상한: Dify 45초 + answer-direct 25초 = 70초(upstream.ts) + DB 호출 여유 → 120초.
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  return handleChat(req, chatDeps());
}
