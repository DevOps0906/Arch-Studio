// 웹 스튜디오 호스트 설정(AR-06-071 결정 7): CSP 생성·검사, Vercel Build Output 라우트.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cspViolations, parseCsp, remoteOrigin, vercelOutputConfig, webCsp, webSecurityHeaders } from "./web-hosting.ts";

const ENV = { VITE_API_BASE_URL: "https://api.example.test/base", VITE_SUPABASE_URL: "https://abc.supabase.example.test" };

test("CSP: 스크립트는 'self' 'wasm-unsafe-eval'만, unsafe-eval·unsafe-inline 0, object/base/frame-ancestors 고정", () => {
  const csp = webCsp(ENV);
  const d = parseCsp(csp);
  assert.deepEqual(d.get("script-src"), ["'self'", "'wasm-unsafe-eval'"]);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
  assert.deepEqual(d.get("base-uri"), ["'self'"]);
  assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(d.get("worker-src"), ["'self'"]);
  assert.deepEqual(cspViolations(csp, ENV), []);
});

test("CSP connect-src ⊇ VITE_API_BASE_URL·VITE_SUPABASE_URL 출처(경로 제거), 같은 env → 같은 문자열", () => {
  const d = parseCsp(webCsp(ENV));
  assert.deepEqual(d.get("connect-src"), ["'self'", "https://api.example.test", "https://abc.supabase.example.test"]);
  assert.equal(webCsp(ENV), webCsp({ ...ENV }));
});

test("검사기가 위반을 잡는다(대조군): unsafe-eval·unsafe-inline·connect-src 누락·넓은 script-src", () => {
  const ok = webCsp(ENV);
  assert.ok(cspViolations(ok.replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'"), ENV).some((v) => v.includes("unsafe-eval")));
  assert.ok(cspViolations(ok.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), ENV).length > 0);
  assert.ok(cspViolations(ok.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"), ENV).length > 0);
  assert.ok(cspViolations(ok.replace("script-src 'self'", "script-src 'self' https:"), ENV).length > 0);
  assert.ok(cspViolations(ok, { ...ENV, VITE_API_BASE_URL: "https://other.example.test" }).some((v) => v.includes("VITE_API_BASE_URL")));
  assert.ok(cspViolations(ok.replace("object-src 'none'", "object-src 'self'"), ENV).length > 0);
});

test("출처: https만(개발용 localhost만 http), 없거나 깨지면 빌드 실패", () => {
  assert.equal(remoteOrigin("X", "http://127.0.0.1:3000/x"), "http://127.0.0.1:3000");
  assert.throws(() => remoteOrigin("X", "http://api.example.test"));
  assert.throws(() => remoteOrigin("X", undefined));
  assert.throws(() => remoteOrigin("X", "not a url"));
  assert.throws(() => webCsp({ VITE_SUPABASE_URL: ENV.VITE_SUPABASE_URL }));
});

test("Vercel 라우트: 모든 경로 헤더(continue) → .wasm Content-Type → filesystem → SPA 폴백(assets 제외), COOP 없음", () => {
  const { version, routes } = vercelOutputConfig(ENV);
  assert.equal(version, 3);
  assert.deepEqual(routes[0], { src: "^/(.*)$", headers: webSecurityHeaders(ENV), continue: true });
  const fs = routes.findIndex((r) => r.handle === "filesystem");
  const wasm = routes.findIndex((r) => (r.headers as Record<string, string> | undefined)?.["Content-Type"] === "application/wasm");
  assert.ok(wasm > 0 && wasm < fs);
  const fallback = routes.at(-1) as { src: string; dest: string };
  assert.equal(fallback.dest, "/index.html");
  const re = new RegExp(fallback.src);
  assert.ok(re.test("/projects/abc") && re.test("/auth/callback") && !re.test("/assets/engine.worker-x.js"));
  assert.ok(!("Cross-Origin-Opener-Policy" in webSecurityHeaders(ENV)));
  assert.equal(JSON.stringify(vercelOutputConfig(ENV)), JSON.stringify(vercelOutputConfig(ENV)));
});
