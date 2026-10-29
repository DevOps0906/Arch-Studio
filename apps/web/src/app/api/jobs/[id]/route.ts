import { jobsDeps } from "../../../../server/jobs/deps.ts";
import { handleGetJob } from "../../../../server/jobs/service.ts";

// GET /api/jobs/{id} (04_API.md 2.1절). 같은 조직 잡만(다른 조직·없는 잡은 같은 404). 본체는 server/jobs/service.ts.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleGetJob(req, id, jobsDeps());
}
