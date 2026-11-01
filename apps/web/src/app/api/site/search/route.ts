import { siteSearchDeps } from "../../../../server/site/map-deps.ts";
import { handleSiteSearch } from "../../../../server/site/search.ts";

// POST /api/site/search(새 프로젝트 지도: 지번·도로명 후보, 좌표 없음). 주소는 본문으로만 — GET은 405. 본체는 server/site/search.ts.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSiteSearch(req, siteSearchDeps());
}

export async function GET(req: Request): Promise<Response> {
  return handleSiteSearch(req, siteSearchDeps());
}
