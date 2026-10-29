import { finishRouteDeps } from "../../../../lib/auth/deps.ts";
import { handleAuthFinish } from "../../../../lib/auth/finish-route.ts";

// POST /api/auth/finish (04_API.md: 데스크톱 Bearer, 교환 직후 1회). 본체는 lib/auth/finish-route.ts.
// 데스크톱 출처 CORS(DESKTOP_CORS_ORIGINS, 코어 요청 T-C2)는 공용 처리가 생길 때 붙인다(이 작업은 열지 않음). 그 밖의 메서드는 Next 기본 405.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleAuthFinish(req, finishRouteDeps());
}
