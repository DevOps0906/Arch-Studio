import { releaseDeps } from "../../../../../server/rule-packs/deps.ts";
import { handleRulePackDownload } from "../../../../../server/rule-packs/service.ts";

// GET /api/rule-packs/{version}/download (04_API.md 2.1절). 서명 URL(10분) + 미리 서명된 매니페스트. 자격 밖 AR011, 없음·철회 404.
export async function GET(req: Request, ctx: { params: Promise<{ version: string }> }): Promise<Response> {
  const { version } = await ctx.params;
  return handleRulePackDownload(req, version, releaseDeps());
}
