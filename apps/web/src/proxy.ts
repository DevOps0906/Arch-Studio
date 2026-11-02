// Next.js 16 proxy(구 middleware). /api/*에 공용 CORS(AR-06-071 결정 8, lib/cors/cors.ts)를 건다:
// preflight는 여기서 바로 응답하고, 나머지는 라우트 응답(오류 상태 포함)에 ACAO·Vary 헤더를 얹는다. 그 밖의 경로는 통과.
// 세션 갱신·단계 분기는 인증 작업(lib/auth)이 붙인다.
import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, applyCorsHeaders, isCorsPath, isPreflight, preflightResponse } from "./lib/cors/cors.ts";

export function proxy(req: NextRequest) {
  if (!isCorsPath(req.nextUrl.pathname)) return NextResponse.next();
  const allowed = allowedOrigins(process.env);
  const origin = req.headers.get("origin");
  if (isPreflight(req)) return preflightResponse(origin, allowed);
  const res = NextResponse.next();
  applyCorsHeaders(res.headers, origin, allowed);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
