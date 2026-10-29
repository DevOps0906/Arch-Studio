import { licenseDeps } from "../../../../server/licenses/deps.ts";
import { handleDeactivate } from "../../../../server/licenses/service.ts";

// POST /api/license/deactivate (04_API.md 2.1절). 본체·검증·오류 매핑은 server/licenses/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleDeactivate(req, licenseDeps());
}
