// API 공용 CORS(AR-06-071 결정 8): 허용 출처만 ACAO, credentials 없음, 오류 응답에도 ACAO·Vary, preflight, proxy 연결.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  allowedOrigins,
  applyCorsHeaders,
  CORS_ALLOW_HEADERS,
  isCorsPath,
  isPreflight,
  normalizeOrigin,
  preflightResponse,
} from "./cors.ts";

const STUDIO = "https://app.example.test";
const ENV = { STUDIO_ORIGIN: STUDIO, DESKTOP_CORS_ORIGINS: "http://tauri.localhost, https://tauri.localhost" };
const ALLOWED = allowedOrigins(ENV);

test("허용 출처 = 스튜디오 1 + 설치형 목록, 잘못된 항목은 버린다(넓히지 않음)", () => {
  assert.deepEqual([...ALLOWED].sort(), ["http://tauri.localhost", "https://app.example.test", "https://tauri.localhost"]);
  assert.deepEqual([...allowedOrigins({})], []);
  const bad = allowedOrigins({ STUDIO_ORIGIN: "*", DESKTOP_CORS_ORIGINS: "null,https://*.example.test,http://evil.test,https://a.test/path,https://u:p@a.test,,not a url" });
  assert.deepEqual([...bad], []);
  assert.equal(normalizeOrigin("https://app.example.test/"), STUDIO);
  assert.equal(normalizeOrigin("http://localhost:1420"), "http://localhost:1420");
});

test("허용 출처: 모든 상태(200·401·402·429·500·404·405)에 ACAO·Vary·Expose, credentials 없음", () => {
  for (const status of [200, 401, 402, 429, 500, 404, 405]) {
    const res = new Response(null, { status, headers: { "access-control-allow-credentials": "true" } });
    applyCorsHeaders(res.headers, STUDIO, ALLOWED);
    assert.equal(res.headers.get("access-control-allow-origin"), STUDIO, String(status));
    assert.match(res.headers.get("vary") ?? "", /Origin/);
    assert.equal(res.headers.get("access-control-expose-headers"), "retry-after");
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  }
});

test("허용 밖 출처·출처 없음: ACAO 없음, Vary: Origin은 있다(캐시 분리)", () => {
  for (const origin of ["https://evil.example.test", "null", null, "https://app.example.test.evil.test"]) {
    const h = new Headers();
    applyCorsHeaders(h, origin, ALLOWED);
    assert.equal(h.get("access-control-allow-origin"), null, String(origin));
    assert.equal(h.get("vary"), "Origin");
  }
});

test("preflight: 허용 출처 204(메서드·헤더·max-age), 아니면 403(ACAO 없음), 둘 다 credentials 없음", () => {
  const ok = preflightResponse(STUDIO, ALLOWED);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), STUDIO);
  assert.match(ok.headers.get("access-control-allow-methods") ?? "", /DELETE/);
  assert.equal(ok.headers.get("access-control-allow-headers"), CORS_ALLOW_HEADERS);
  assert.match(ok.headers.get("vary") ?? "", /Origin/);
  assert.equal(ok.headers.get("access-control-allow-credentials"), null);
  const denied = preflightResponse("https://evil.example.test", ALLOWED);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal(denied.headers.get("vary"), "Origin");
  assert.ok(isPreflight(new Request("http://x/api/a", { method: "OPTIONS", headers: { "access-control-request-method": "GET" } })));
  assert.ok(!isPreflight(new Request("http://x/api/a", { method: "OPTIONS" })));
  assert.ok(isCorsPath("/api/cloud-projects") && !isCorsPath("/apis") && !isCorsPath("/login"));
});

test("proxy(): /api preflight·일반 요청에 CORS, 화면 경로는 손대지 않는다(실제 proxy 모듈)", () => {
  const child = spawnSync(process.execPath, ["--import", "./route-loader.mjs", "./proxy.run.ts"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(child.status, 0, `proxy 자식 프로세스 실패:\n${child.stderr}\n${child.error?.message ?? ""}`);
  const stdout = child.stdout;
  const r = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, { status: number; headers: Record<string, string> }>;
  const h = (name: string) => r[name]?.headers ?? {};
  assert.equal(r["preflight-allowed"]?.status, 204);
  assert.equal(h("preflight-allowed")["access-control-allow-origin"], STUDIO);
  assert.equal(h("preflight-desktop")["access-control-allow-origin"], "http://tauri.localhost");
  assert.equal(r["preflight-denied"]?.status, 403);
  assert.equal(h("preflight-denied")["access-control-allow-origin"], undefined);
  assert.equal(h("get-allowed")["access-control-allow-origin"], STUDIO);
  assert.equal(h("get-allowed")["vary"], "Origin");
  assert.equal(h("get-denied")["access-control-allow-origin"], undefined);
  assert.equal(h("get-denied")["vary"], "Origin");
  assert.equal(h("page")["access-control-allow-origin"], undefined);
  for (const v of Object.values(r)) assert.equal(v.headers["access-control-allow-credentials"], undefined);
});

test("CORS 헤더를 직접 쓰는 라우트·서버 코드 0(공용 처리 한 곳)", () => {
  const src = path.resolve(import.meta.dirname, "../..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && /access-control-allow-(origin|credentials)/i.test(readFileSync(full, "utf8")))
        offenders.push(path.relative(src, full));
    }
  };
  walk(path.join(src, "app"));
  walk(path.join(src, "server"));
  assert.deepEqual(offenders, []);
});
