import { licenseDeps } from "../../../../server/licenses/deps.ts";
import { handleList } from "../../../../server/licenses/service.ts";

// GET /api/license/list (04_API.md 2.1절). 시리얼은 끝 5자만.
export async function GET(req: Request): Promise<Response> {
  return handleList(req, licenseDeps());
}
