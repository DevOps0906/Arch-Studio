// 무로그인 거부 열거(AR-06-071 결정 10): 스튜디오가 부르는 모든 API 라우트가 Authorization 없이 401.
// 실제 Route Handler 모듈을 자식 프로세스(`--conditions=react-server` + `@/` 해석 훅)에서 불러 부른다. 실패 닫힘 스위치는 모두 켠 상태.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STUDIO_ROUTES } from "./studio-routes.ts";

const HERE = import.meta.dirname;
const APP_DIR = path.resolve(HERE, "../../app");
const ROOT = path.resolve(HERE, "../../../../..");

test("스튜디오 API 라우트: Bearer 없이 모두 401(실제 Route Handler)", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "./route-loader.mjs", "./studio-routes-unauth.run.ts"],
    { cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 },
  );
  const rows = JSON.parse(stdout.trim().split("\n").at(-1) ?? "[]") as { method: string; path: string; status: number }[];
  const expected = STUDIO_ROUTES.filter((r) => r.file).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(rows.map((r) => `${r.method} ${r.path}`), expected);
  const not401 = rows.filter((r) => r.status !== 401).map((r) => `${r.method} ${r.path} → ${r.status}`);
  assert.deepEqual(not401, []);
});

test("목록의 route.ts가 실제로 있고, 미구현 표시(file: null)는 정말 없다(생기면 401 열거로 옮긴다)", () => {
  for (const r of STUDIO_ROUTES) {
    if (r.file) assert.ok(existsSync(path.join(APP_DIR, r.file)), r.file);
  }
  const missing = STUDIO_ROUTES.filter((r) => !r.file).map((r) => r.path.split("?")[0] ?? "");
  for (const p of missing) {
    const dir = p.replace(/^\/api\//, "api/").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, "[id]");
    assert.ok(!existsSync(path.join(APP_DIR, dir, "route.ts")), `${p}: 라우트가 생겼다 — file을 채워 401 열거에 넣는다`);
  }
});

/** 스튜디오 클라이언트 코드(features·shell-bridge, 테스트·데모·테스트 더블 제외)의 `/api/...` 문자열 앞부분. */
function clientApiPrefixes(): string[] {
  const out = new Set<string>();
  const skip = /(\.test\.tsx?|\.check\.ts|[\\/]demo[\\/].*|[\\/]testing[\\/].*|[\\/]web[\\/]fakes\.ts)$/;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !skip.test(full)) {
        for (const m of readFileSync(full, "utf8").matchAll(/["'`](\/api\/[^"'`?$\s]*)/g)) out.add(m[1] ?? "");
      }
    }
  };
  walk(path.join(ROOT, "packages/features/src"));
  walk(path.join(ROOT, "packages/shell-bridge/src"));
  walk(path.join(ROOT, "apps/desktop/src"));
  return [...out].sort();
}

test("클라이언트가 부르는 /api 경로는 모두 열거 목록에 있다(새 호출 누락 방지)", () => {
  const prefixes = clientApiPrefixes();
  assert.ok(prefixes.includes("/api/cloud-projects"), "스캔 경로 확인");
  const uncovered = prefixes.filter((p) => !STUDIO_ROUTES.some((r) => r.path.startsWith(p)));
  assert.deepEqual(uncovered, []);
});
