import { handleAiToken } from "../../../../server/ai/gateway/ai-token.ts";
import { aiTokenDeps } from "../../../../server/ai/gateway/deps.ts";

// POST /api/internal/ai-token (04_API.md 6.3절). 워커 전용(Bearer ARCH_WORKER_INTERNAL_KEY). 본체는 server/ai/gateway/ai-token.ts.
export async function POST(req: Request): Promise<Response> {
  return handleAiToken(req, aiTokenDeps());
}
