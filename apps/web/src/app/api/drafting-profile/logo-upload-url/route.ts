import { draftingProfileDeps } from "../../../../server/drafting-profile/deps.ts";
import { handleLogoUploadUrl } from "../../../../server/drafting-profile/service.ts";

// POST /api/drafting-profile/logo-upload-url (04_API.md `:59`). 경로는 서버가 만든다. 본체는 server/drafting-profile/service.ts.
export async function POST(req: Request): Promise<Response> {
  return handleLogoUploadUrl(req, draftingProfileDeps());
}
