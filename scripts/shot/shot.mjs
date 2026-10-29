#!/usr/bin/env node
// 데스크톱 화면 스크린샷(AR-06-004b). Vite 개발 서버를 데모 데이터 모드(VITE_DEMO_MODE=1)로 띄우고,
// 지정 경로를 너비 375/900/1400(모바일 ~767 · 768~1199 · 1200~)에서 playwright chromium으로 찍는다.
//   node scripts/shot/shot.mjs --out <폴더> [--routes "/login?demo-session=none,/projects"] [--widths 375,900,1400] [--port 3123] [--full]
// 출력 폴더는 저장소 밖(스크래치패드)을 쓴다. 이미지를 커밋하지 않는다. 가로 넘침(scrollWidth > 창 너비)과 콘솔 오류(CSP 위반 포함)를 출력한다.
// 데모 URL 옵션: ?demo-session=none(로그아웃 상태) · ?demo-onboarding=1 · ?demo-license=trial|fallback|expired · ?state=loading|error|empty(자리표시자)
// 종료 코드: 0 통과, 1 가로 넘침·페이지 오류·서버 실패.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DESKTOP = path.join(ROOT, "apps/desktop");
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const out = arg("out");
if (!out) {
  console.error("사용: node scripts/shot/shot.mjs --out <폴더> [--routes a,b] [--widths 375,900,1400] [--port 3123] [--full]");
  process.exit(1);
}
const port = Number(arg("port", "3123"));
if (port === 3000) {
  console.error("3000번 포트는 쓰지 않는다(Windows 예약, tasks/NOW.md).");
  process.exit(1);
}
const routes = arg("routes", "/login?demo-session=none,/projects,/projects/0192f0a0-1c00-7a01-8a01-000000000001/model").split(",").filter(Boolean);
const widths = arg("widths", "375,900,1400").split(",").map(Number);
const fullPage = process.argv.includes("--full");
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });

/** Vite 개발 서버(데모 모드). NODE_ENV=development라 import.meta.env.DEV=true. */
function startServer() {
  const viteBin = path.join(path.dirname(createRequire(path.join(DESKTOP, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: DESKTOP,
    env: { ...process.env, VITE_DEMO_MODE: "1", NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitFor(url, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // 아직 안 뜸
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`개발 서버가 ${ms}ms 안에 뜨지 않았다: ${url}`);
}

const slug = (route) => route.replace(/^\//, "").replace(/[^a-zA-Z0-9-]+/g, "_").slice(0, 80) || "root";

const server = startServer();
let failed = false;
try {
  await waitFor(base);
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    for (const route of routes) {
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: "light", locale: "ko-KR" });
        const page = await context.newPage();
        const errors = [];
        page.on("console", (m) => m.type() === "error" && !/websocket|\[vite\]/i.test(m.text()) && errors.push(m.text()));
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.goto(base + route, { waitUntil: "networkidle" });
        // 지연 로드 화면·세션 복구가 끝날 때까지 잠깐 기다린다.
        await page.waitForTimeout(400);
        const info = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const sw = document.documentElement.scrollWidth;
          const wide = [];
          for (const el of document.body.querySelectorAll("*")) {
            const r = el.getBoundingClientRect();
            if (r.right > vw + 1 && getComputedStyle(el).position !== "fixed") {
              const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
              wide.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""} (${Math.round(r.right)}px)`);
            }
            if (wide.length >= 5) break;
          }
          return { vw, sw, wide, path: location.pathname + location.search, title: document.querySelector("h1")?.textContent ?? "" };
        });
        const file = path.join(out, `${slug(route)}-${width}.png`);
        await page.screenshot({ path: file, fullPage });
        const overflow = info.sw > info.vw;
        if (overflow || errors.length) failed = true;
        console.log(
          `${overflow ? "넘침" : "정상"}  ${String(width).padStart(4)}px  ${route} → ${info.path}  h1="${info.title}"  scrollWidth=${info.sw}/${info.vw}  ${file}`,
        );
        if (overflow) for (const w of info.wide) console.log(`      넘친 요소: ${w}`);
        for (const e of errors) console.log(`      콘솔 오류: ${e.slice(0, 300)}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : e);
  console.error(server.log().slice(-2000));
} finally {
  server.child.kill("SIGTERM");
}
process.exit(failed ? 1 : 0);
