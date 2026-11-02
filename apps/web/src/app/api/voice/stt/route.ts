import { voiceDeps } from "../../../../server/voice/deps.ts";
import { handleVoiceStt } from "../../../../server/voice/service.ts";

// POST /api/voice/stt (04_API.md 14·87행). 스위치가 꺼져 있으면 503(차감 0). 본체는 server/voice/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleVoiceStt(req, voiceDeps());
}
