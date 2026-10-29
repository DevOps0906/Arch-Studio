#!/usr/bin/env node
// Mock 잔존 검사(02_ARCHITECTURE.md 위험 #8·#14, AR-06-008 수용 기준 "릴리스 번들에 Mock 패널·시드 이메일 0").
//   node scripts/dev/check-bundle-mock.mjs dir <디렉터리>...   빌드 산출물(예: apps/desktop/dist, apps/web/.next/static)을 검사
//   node scripts/dev/check-bundle-mock.mjs desktop-auth         shell-bridge auth를 Vite로 릴리스·개발 두 번 빌드해
//                                                              릴리스에는 Mock 0, 개발에는 Mock 있음(검사 자체가 동작함)을 확인
// 종료 코드: 0 통과, 1 Mock 문자열 발견·실패.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const MOCK_MARKERS = ["@dev.test", "dev.test", "signInPersona", "DEV_SEED_PASSWORD", "MOCK AUTH", "개발용 로그인", "DEV_PERSONAS"];
const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt|rsc|body)$/;

export function scanDir(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (TEXT.test(name)) {
        const text = readFileSync(full, "utf8");
        for (const m of MOCK_MARKERS) if (text.includes(m)) hits.push(`${path.relative(ROOT, full)}: ${m}`);
      }
    }
  };
  walk(dir);
  return hits;
}

async function buildAuthBundle(mode) {
  const req = createRequire(path.join(ROOT, "apps/desktop/package.json"));
  const vite = await import(pathToFileURL(req.resolve("vite")).href);
  const work = mkdtempSync(path.join(tmpdir(), "arch-auth-bundle-"));
  const entry = path.join(work, "entry.js");
  const authIndex = path.join(ROOT, "packages/shell-bridge/src/auth/index.ts");
  writeFileSync(
    entry,
    `import { desktopAuthMode, loadDevMockAuth } from ${JSON.stringify(authIndex)};\n` +
      `export async function run(s) { return [desktopAuthMode(), await loadDevMockAuth({ supabase: s, supabaseUrl: "x" })]; }\n`,
  );
  const prev = { VITE_AUTH_MODE: process.env.VITE_AUTH_MODE, NODE_ENV: process.env.NODE_ENV };
  process.env.VITE_AUTH_MODE = "mock"; // 최악 가정: 릴리스 빌드에 mock이 섞여도 DEV=false라 제거돼야 한다
  // Vite의 import.meta.env.DEV는 NODE_ENV를 따른다. 릴리스는 production, 대조군은 development로 고정한다.
  process.env.NODE_ENV = mode;
  try {
    await vite.build({
      configFile: false,
      root: work,
      mode,
      logLevel: "silent",
      envPrefix: "VITE_",
      build: {
        outDir: path.join(work, "out"),
        emptyOutDir: true,
        minify: mode === "production",
        lib: { entry, formats: ["es"], fileName: "auth" },
        rollupOptions: { external: [/^@supabase\//] },
      },
    });
    return { work, hits: scanDir(path.join(work, "out")) };
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "dir") {
    if (rest.length === 0) throw new Error("검사할 디렉터리를 주세요");
    const hits = rest.flatMap((d) => scanDir(path.resolve(d)));
    if (hits.length) throw new Error(`Mock 문자열 발견:\n${hits.join("\n")}`);
    console.log(`Mock 문자열 0건: ${rest.join(", ")}`);
    return;
  }
  if (cmd === "desktop-auth") {
    const release = await buildAuthBundle("production");
    const dev = await buildAuthBundle("development");
    try {
      if (release.hits.length) throw new Error(`릴리스 빌드에 Mock 문자열:\n${release.hits.join("\n")}`);
      if (!dev.hits.some((h) => h.endsWith("dev.test"))) throw new Error("개발 빌드에 Mock 모듈이 없다(검사 조건이 깨졌다)");
      console.log("릴리스 빌드 Mock 0건, 개발 빌드 Mock 있음(대조군) — 통과");
    } finally {
      rmSync(release.work, { recursive: true, force: true });
      rmSync(dev.work, { recursive: true, force: true });
    }
    return;
  }
  throw new Error("사용: check-bundle-mock.mjs dir <경로>... | desktop-auth");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
