import { voiceDeps } from "../../../../server/voice/deps.ts";
import { handleStt } from "../../../../server/voice/service.ts";

// POST /api/voice/stt (04_API.md 2.2절). 제공자가 없으면 503(차감 0). 본체는 server/voice/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleStt(req, voiceDeps());
}
