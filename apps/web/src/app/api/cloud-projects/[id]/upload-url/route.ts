import { cloudDeps } from "../../../../../server/cloud-projects/deps.ts";
import { handleCloudUploadUrl } from "../../../../../server/cloud-projects/service.ts";

// POST /api/cloud-projects/{id}/upload-url (04_API.md 2.1절: uploads/sign project_snapshot 별칭 + 새 사본 상한 AR040).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleCloudUploadUrl(req, id, cloudDeps());
}
