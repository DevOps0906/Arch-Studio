import { handleAiSettle } from "../../../../server/ai/gateway/ai-token.ts";
import { aiTokenDeps } from "../../../../server/ai/gateway/deps.ts";

// POST /api/internal/ai-settle: workers/arch-jobs 정산 크론이 부른다. 규약이 04_API.md에 없어 워커 키 확인 후 501(tasks/logs/AR-06-047.md).
export async function POST(req: Request): Promise<Response> {
  return handleAiSettle(req, aiTokenDeps());
}
