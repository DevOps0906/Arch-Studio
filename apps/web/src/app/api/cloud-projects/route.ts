import { cloudDeps } from "../../../server/cloud-projects/deps.ts";
import { handleListCloudProjects, handleSaveCloudProject } from "../../../server/cloud-projects/service.ts";

// GET|POST /api/cloud-projects (04_API.md 2.1절). 본체·검증·오류 매핑은 server/cloud-projects/service.ts.
// DB 연결: deps.ts → supabase-repo.ts.
export async function GET(req: Request): Promise<Response> {
  return handleListCloudProjects(req, cloudDeps());
}

export async function POST(req: Request): Promise<Response> {
  return handleSaveCloudProject(req, cloudDeps());
}
