import { renderDeps } from "../../../../server/ai/render/deps.ts";
import { handleRender } from "../../../../server/ai/render/service.ts";

// POST /api/ai/render (04_API.md 2.1절). 스위치가 꺼져 있으면 503(차감 0). 본체는 server/ai/render/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleRender(req, renderDeps());
}
