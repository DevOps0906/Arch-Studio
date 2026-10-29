import { releaseDeps } from "../../../server/rule-packs/deps.ts";
import { handleListRulePacks } from "../../../server/rule-packs/service.ts";

// GET /api/rule-packs?after=<version> (04_API.md 2.1절). 자격 판정은 arch.eligible_rule_packs(서버 DB).
export async function GET(req: Request): Promise<Response> {
  return handleListRulePacks(req, releaseDeps());
}
