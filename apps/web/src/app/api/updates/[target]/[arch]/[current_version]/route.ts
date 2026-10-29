import { releaseDeps } from "../../../../../../server/rule-packs/deps.ts";
import { handleUpdateManifest } from "../../../../../../server/rule-packs/service.ts";

// GET /api/updates/{target}/{arch}/{current_version} (04_API.md 2.3절). Tauri 2 동적 업데이트 형식 또는 204, 자격 밖 빌드 AR010.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string; arch: string; current_version: string }> },
): Promise<Response> {
  const p = await ctx.params;
  return handleUpdateManifest(req, { target: p.target, arch: p.arch, current: p.current_version }, releaseDeps());
}
