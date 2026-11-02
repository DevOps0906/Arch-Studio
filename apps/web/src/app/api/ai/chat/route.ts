import { chatDeps } from "../../../../server/ai/chat/deps.ts";
import { handleChat } from "../../../../server/ai/chat/service.ts";

// POST /api/ai/chat (04_API.md 2.2절, AR-06-054). SSE 응답. 설정이 없으면 503(차감 0). 본체는 server/ai/chat/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleChat(req, chatDeps());
}
