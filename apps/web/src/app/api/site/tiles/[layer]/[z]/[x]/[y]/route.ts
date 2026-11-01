import { siteTileDeps } from "../../../../../../../../server/site/map-deps.ts";
import { handleSiteTile } from "../../../../../../../../server/site/tiles.ts";

// GET /api/site/tiles/{layer}/{z}/{x}/{y}(새 프로젝트 지도 배경, base·gray만). VWorld WMTS 중계. 본체는 server/site/tiles.ts.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ layer: string; z: string; x: string; y: string }> }): Promise<Response> {
  const params = await ctx.params;
  return handleSiteTile(req, params, siteTileDeps());
}
