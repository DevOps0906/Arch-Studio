// Next.js 16 proxy(구 middleware). 골격 단계: 통과만 한다. 세션 갱신·단계 분기는 인증 작업(lib/auth)이 붙인다.
import { NextResponse } from "next/server";

export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
