import { reviewDeps } from "../../../../server/ai/review/deps.ts";
import { handleReview } from "../../../../server/ai/review/service.ts";

// POST /api/ai/review (04_API.md 2.1절). 스위치가 꺼져 있으면 503(차감 0). 본체는 server/ai/review/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleReview(req, reviewDeps());
}
