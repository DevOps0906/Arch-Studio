#!/usr/bin/env node
// 웹 스튜디오 빌드 산출물 검사(AR-06-071 결정 7·9). 웹 빌드(`pnpm build:web`) 뒤 실행한다. 새 의존성 없음.
//   node scripts/check-web-dist.mjs                     build/web + build/web-hosting.json 검사(env: VITE_API_BASE_URL·VITE_SUPABASE_URL)
//   node scripts/check-web-dist.mjs --expect-tauri dist  대조군: 설치형 dist에는 Tauri IPC 표식이 있어야 통과(검사 자체가 동작함)
// 항목: ① Tauri IPC 코드 0(@tauri-apps/api 고유 문자열) ② 릴리스 번들 검사(Mock·데모·개발용 규칙 팩 0, check-release-bundle.mjs)
//       ③ 비밀 0(scan-secrets dir) ④ index.html 인라인 script·style 0 ⑤ 호스트 설정 CSP(unsafe-eval·스크립트 unsafe-inline 없음,
//       connect-src ⊇ env 출처)·모든 경로 헤더·.wasm Content-Type·SPA 폴백.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { cspViolations, WEB_BUILD_MODE, WEB_HOSTING_CONFIG, WEB_OUT_DIR } from "../web-hosting.ts";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(APP, "../..");
// @tauri-apps/api/core IPC 구현 고유 문자열(축소 후에도 속성 접근으로 남는다). `__TAURI_INTERNALS__` 단독은 shell-bridge 판정(`in`)에도 있어 쓰지 않는다.
export const TAURI_MARKERS = ["__TAURI_INTERNALS__.invoke", "transformCallback", "__TAURI_TO_IPC_KEY__"];

function textFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|css|html|json|map)$/.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function tauriHits(dir) {
  const hits = [];
  for (const f of textFiles(dir)) {
    const text = readFileSync(f, "utf8");
    for (const m of TAURI_MARKERS) if (text.includes(m)) hits.push(`${path.relative(APP, f)}: ${m}`);
  }
  return hits;
}

/** 호스트 설정 검사. 위반 목록. */
export function hostingViolations(config, env) {
  const bad = [];
  const routes = Array.isArray(config?.routes) ? config.routes : [];
  if (config?.version !== 3) bad.push("Build Output API version 3 아님");
  const first = routes[0];
  if (!first || first.src !== "^/(.*)$" || first.continue !== true) bad.push("첫 라우트가 모든 경로 헤더(continue)가 아님");
  const headers = first?.headers ?? {};
  const csp = headers["Content-Security-Policy"];
  if (typeof csp !== "string") bad.push("CSP 헤더 없음");
  else bad.push(...cspViolations(csp, env));
  if (headers["X-Content-Type-Options"] !== "nosniff") bad.push("nosniff 없음");
  if ("Cross-Origin-Opener-Policy" in headers) bad.push("COOP가 있다(팝업 OAuth opener 끊김)");
  const fs = routes.findIndex((r) => r.handle === "filesystem");
  if (fs < 0) bad.push("filesystem 단계 없음");
  if (!routes.some((r, i) => i < fs && /wasm/.test(r.src ?? "") && r.headers?.["Content-Type"] === "application/wasm")) bad.push(".wasm Content-Type 없음");
  if (!routes.some((r, i) => i > fs && r.dest === "/index.html")) bad.push("SPA 폴백 없음");
  return bad;
}

function inlineViolations(html) {
  const bad = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(m[1] ?? "") || (m[2] ?? "").trim()) bad.push("인라인 <script>");
  }
  if (/<style\b/i.test(html)) bad.push("인라인 <style>");
  if (/\sstyle=/i.test(html)) bad.push("style 속성");
  if (/\son[a-z]+=/i.test(html)) bad.push("인라인 이벤트 처리기");
  return bad;
}

const args = process.argv.slice(2);
if (args[0] === "--expect-tauri") {
  const dir = path.resolve(process.cwd(), args[1] ?? "dist");
  if (tauriHits(dir).length === 0) {
    console.error(`대조군(설치형 dist)에 Tauri IPC 표식이 없다(검사 조건이 깨졌다): ${dir}`);
    process.exit(1);
  }
  console.log("대조군 Tauri IPC 표식 있음 — 통과");
  process.exit(0);
}

const dir = path.join(APP, WEB_OUT_DIR);
const failures = [];
if (!existsSync(path.join(dir, "index.html"))) {
  console.error(`웹 빌드 산출물이 없다: ${dir} (pnpm build:web 먼저)`);
  process.exit(1);
}
const hits = tauriHits(dir);
if (hits.length) failures.push(`Tauri IPC 코드:\n  ${hits.join("\n  ")}`);
for (const [label, cmd] of [
  ["릴리스 번들 검사", [path.join(APP, "scripts/check-release-bundle.mjs"), "--web", dir]],
  ["웹 전용 표식 대조군", [path.join(APP, "scripts/check-release-bundle.mjs"), "--expect-web", dir]],
  ["비밀 검사", [path.join(ROOT, "scripts/ci/scan-secrets.mjs"), "dir", dir]],
]) {
  try {
    execFileSync(process.execPath, cmd, { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    failures.push(`${label} 실패:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
  }
}
failures.push(...inlineViolations(readFileSync(path.join(dir, "index.html"), "utf8")).map((v) => `index.html ${v}`));
const configPath = path.join(APP, WEB_HOSTING_CONFIG);
if (!existsSync(configPath)) failures.push(`호스트 설정 없음: ${WEB_HOSTING_CONFIG}`);
else {
  // 빌드와 같은 env: .env 파일(mode web) 위에 프로세스 env를 덮어쓴다.
  const env = { ...loadEnv(WEB_BUILD_MODE, APP, "VITE_"), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("VITE_"))) };
  failures.push(...hostingViolations(JSON.parse(readFileSync(configPath, "utf8")), env).map((v) => `호스트 설정: ${v}`));
}

if (failures.length) {
  console.error(`웹 빌드 검사 실패:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`웹 빌드 검사 통과: Tauri IPC 0 · Mock·데모·규칙 팩 0 · 비밀 0 · 인라인 0 · CSP·호스트 헤더 (${path.relative(APP, dir)})`);
