import { proposalDeps } from "../../../../server/ai/proposal/deps.ts";
import { handleProposal } from "../../../../server/ai/proposal/service.ts";

// POST /api/ai/proposal (04_API.md 2.1절). 스위치가 꺼져 있으면 503(차감 0). 본체는 server/ai/proposal/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleProposal(req, proposalDeps());
}
