// SPIKE_NONCE=1 일 때만 요청별 nonce CSP를 건다(Next 공식 nonce 방식). 아니면 통과.
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest) {
  if (process.env.SPIKE_NONCE !== "1") return NextResponse.next();
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; report-uri /__csp`;
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = { matcher: ["/((?!_next/static|__result|__csp).*)"] };
