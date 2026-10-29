// 소스 검사: 테스트 밖 shell-bridge 코드에 영속 웹 스토리지·직접 로그·Tauri 직접 import 위반이 없다.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts") && e.name !== "test-helpers.ts" ? [p] : [];
  });
}

test("토큰 저장 경로: localStorage·sessionStorage·indexedDB 참조 0건", () => {
  const hits = sources(SRC).filter((f) => /localStorage|sessionStorage|indexedDB/.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits.map((f) => relative(SRC, f)), []);
});

test("console 호출 0건(값이 로그로 새는 경로 차단)", () => {
  const hits = sources(SRC).filter((f) => /\bconsole\./.test(readFileSync(f, "utf8")));
  assert.deepEqual(hits.map((f) => relative(SRC, f)), []);
});

test("@tauri-apps/api는 tauri/invoke.ts 한 곳에서만", () => {
  const hits = sources(SRC).filter((f) => readFileSync(f, "utf8").includes("@tauri-apps/"));
  assert.deepEqual(hits.map((f) => relative(SRC, f)), [join("tauri", "invoke.ts")]);
});

test("supabase 클라이언트 옵션 고정: pkce·detectSessionInUrl false·storage 지정", () => {
  const src = readFileSync(join(SRC, "supabase", "client.ts"), "utf8");
  assert.match(src, /flowType: "pkce"/);
  assert.match(src, /detectSessionInUrl: false/);
  assert.match(src, /storage: createAuthStorage\(/);
  assert.equal((src.match(/createClient\(/g) ?? []).length, 1);
});
