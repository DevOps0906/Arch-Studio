import { uploadDeps } from "../../../../server/uploads/deps.ts";
import { handleUploadSign } from "../../../../server/uploads/service.ts";

// POST /api/uploads/sign (04_API.md 2.1절). 경로는 서버가 만든다. 본체는 server/uploads/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleUploadSign(req, uploadDeps());
}
