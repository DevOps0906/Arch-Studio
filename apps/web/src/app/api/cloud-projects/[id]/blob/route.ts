import { handleGetCloudBlob } from "../../../../../server/cloud-projects/blob.ts";
import { cloudBlobDeps } from "../../../../../server/cloud-projects/deps.ts";

// GET /api/cloud-projects/{project_uuid}/blob (04_API.md 2.1절, AR-06-072): 서명 다운로드 URL + version·bytes·sha256.
// entitled=false여도 허용(데이터 회수 경로). 본체·검증·오류 매핑은 server/cloud-projects/blob.ts.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleGetCloudBlob(req, id, cloudBlobDeps());
}
