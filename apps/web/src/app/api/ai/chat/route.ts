import { chatDeps } from "../../../../server/ai/chat/deps.ts";
import { handleChat } from "../../../../server/ai/chat/service.ts";

// POST /api/ai/chat (04_API.md 2.1절). 스위치가 꺼져 있으면 503(차감 0). 본체는 server/ai/chat/service.ts.
// 상류 상한 CHAT_TIMEOUT_MS 60초 + 인증·원장·저장 DB 호출 여유 → 90초.
export const maxDuration = 90;

export async function POST(req: Request): Promise<Response> {
  return handleChat(req, chatDeps());
}
