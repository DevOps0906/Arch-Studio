import { siteLookupDeps } from "../../../../server/site/deps.ts";
import { handleSiteLookup } from "../../../../server/site/service.ts";

// POST /api/site/lookup (04_API.md 2.1절). VWorld 중계·일일 상한(arch.record_site_lookup). 본체는 server/site/service.ts.
// 데스크톱 출처 CORS(DESKTOP_CORS_ORIGINS, T-C2)는 공용 처리가 생길 때 붙인다(다른 Bearer 라우트와 같음).
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleSiteLookup(req, siteLookupDeps());
}
