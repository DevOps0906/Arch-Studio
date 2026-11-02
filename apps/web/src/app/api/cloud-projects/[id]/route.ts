import { cloudDeps } from "../../../../server/cloud-projects/deps.ts";
import { handleDeleteCloudProject } from "../../../../server/cloud-projects/service.ts";

// DELETE /api/cloud-projects/{project_uuid}[?expected_version=n] (AR-06-073 결정 9). 본체는 server/cloud-projects/service.ts.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleDeleteCloudProject(req, id, cloudDeps());
}
