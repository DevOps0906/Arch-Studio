import { draftingProfileDeps } from "../../../server/drafting-profile/deps.ts";
import { handleGetProfile, handlePutProfile } from "../../../server/drafting-profile/service.ts";

// GET|PUT /api/drafting-profile (04_API.md `:57-58`). 본체는 server/drafting-profile/service.ts.
export async function GET(req: Request): Promise<Response> {
  return handleGetProfile(req, draftingProfileDeps());
}

export async function PUT(req: Request): Promise<Response> {
  return handlePutProfile(req, draftingProfileDeps());
}
