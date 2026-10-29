import { devLoginDeps } from "../../../../lib/auth/deps.ts";
import { handleDevLogin, handleDevLoginOtherMethod } from "../../../../lib/auth/dev-login-route.ts";

// POST /api/dev/login (Stage A 로컬 전용, 04_API.md). isMockAuthAllowed()가 거짓이면 모든 메서드 404.
// 본체·판정·출처 검사는 lib/auth/dev-login-route.ts.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleDevLogin(req, devLoginDeps());
}

function other(): Response {
  return handleDevLoginOtherMethod(devLoginDeps());
}

export const GET = other;
export const PUT = other;
export const PATCH = other;
export const DELETE = other;
export const OPTIONS = other;
export const HEAD = other;
