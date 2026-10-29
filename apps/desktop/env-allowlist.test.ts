// 실행: pnpm --filter ./apps/desktop test (Node 내장 테스트 러너, TS 타입 제거 실행)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { checkDesktopEnv, isReleaseBuild } from "./env-allowlist.ts";

const allowed = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "anon",
  VITE_API_BASE_URL: "http://127.0.0.1:3000",
  VITE_AUTH_MODE: "live",
};

test("허용 목록 4개와 VITE_ 아닌 변수는 통과한다", () => {
  assert.doesNotThrow(() => checkDesktopEnv({ ...allowed, PATH: "x", SUPABASE_SERVICE_ROLE_KEY: "s" }, true));
});

test("허용 목록 밖 VITE_ 변수는 이름을 담아 실패한다", () => {
  assert.throws(() => checkDesktopEnv({ ...allowed, VITE_SERVICE_ROLE_KEY: "s" }, false), /VITE_SERVICE_ROLE_KEY/);
});

test("VITE_AUTH_MODE=mock은 개발 빌드만 허용한다", () => {
  assert.doesNotThrow(() => checkDesktopEnv({ VITE_AUTH_MODE: "mock" }, false));
  assert.throws(() => checkDesktopEnv({ VITE_AUTH_MODE: "mock" }, true), /mock/);
});

test("VITE_DEMO_MODE(데모 데이터)는 개발 빌드만 허용한다(AR-06-004b)", () => {
  assert.doesNotThrow(() => checkDesktopEnv({ VITE_DEMO_MODE: "1" }, false));
  assert.throws(() => checkDesktopEnv({ VITE_DEMO_MODE: "1" }, true), /VITE_DEMO_MODE/);
  assert.throws(() => checkDesktopEnv({ VITE_DEMO_MODE: "0" }, true), /VITE_DEMO_MODE/);
  assert.doesNotThrow(() => checkDesktopEnv({ VITE_DEMO_MODE: "" }, true));
});

test("vite build가 허용 목록 밖 변수로 실패한다", () => {
  const vitePkg = createRequire(import.meta.url).resolve("vite/package.json");
  const viteBin = path.join(path.dirname(vitePkg), "bin", "vite.js");
  const result = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: import.meta.dirname,
    env: { ...process.env, VITE_LEAKED_SECRET: "x" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /VITE_LEAKED_SECRET/);
});

test("production 외 mode의 빌드도 mock 차단 대상이다(development 빌드만 제외)", () => {
  assert.equal(isReleaseBuild("build", "production"), true);
  assert.equal(isReleaseBuild("build", "staging"), true);
  assert.equal(isReleaseBuild("build", "development"), false);
  assert.equal(isReleaseBuild("serve", "staging"), false);
});
