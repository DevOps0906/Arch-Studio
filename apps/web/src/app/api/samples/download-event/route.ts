import { handleDownloadEvent } from "../../../../server/samples/download-event.ts";

// POST /api/samples/download-event — 익명 샘플 다운로드 측정. 본문 { sample_id, format }만 받는다.
export async function POST(req: Request): Promise<Response> {
  return handleDownloadEvent(req);
}
