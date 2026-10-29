import { releaseDeps } from "../../../../server/rule-packs/deps.ts";
import { handleLatestCostCatalog } from "../../../../server/rule-packs/service.ts";

// GET /api/cost-catalogs/latest (04_API.md 2.1절). arch.latest_cost_catalog 0행이면 204.
export async function GET(req: Request): Promise<Response> {
  return handleLatestCostCatalog(req, releaseDeps());
}
