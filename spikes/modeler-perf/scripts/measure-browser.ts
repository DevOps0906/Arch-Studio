// 스파이크(버리는 코드): 헤드리스 chromium(playwright)으로 하니스를 자동 측정한다. 소프트웨어 GL(SwiftShader)이므로 fps는 실제 GPU 성능이 아니다.
// 실행: pnpm build && pnpm measure [secs] [shotPath]   (playwright는 전역 설치본을 require — 이 패키지 의존성에 넣지 않는다)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const secs = process.argv[2] ?? "4";
const shot = process.argv[3];
const geom = process.argv[4] ?? "1";
const globalRoot = execSync("npm root -g").toString().trim();
const require = createRequire(`${globalRoot}/`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 전역 playwright(타입 없음)
const { chromium } = require("playwright") as { chromium: any };

const server = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" });
await new Promise<void>((resolve, reject) => {
  server.stdout.on("data", (d: Buffer) => {
    if (d.toString().includes("4173")) resolve();
  });
  server.on("exit", (c) => reject(new Error(`preview exit ${c}`)));
});

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1100 } });
  const logs: string[] = [];
  page.on("console", (m: { type(): string; text(): string }) => {
    if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e: Error) => logs.push(`pageerror: ${e.message}`));
  const resp = await page.goto(`http://localhost:4173/?auto=1&secs=${secs}&geom=${geom}`);
  const csp = resp?.headers()["content-security-policy"];
  await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, { timeout: 40 * 60 * 1000, polling: 2000 });
  const result = (await page.evaluate(() => (window as unknown as { __result: unknown }).__result)) as Record<string, unknown>;
  result.harness = { mode: "headless chromium (playwright)", browser_version: browser.version(), csp_header: csp, console: logs };
  if (shot) await page.screenshot({ path: shot, fullPage: true });
  mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
  const file = new URL(`../out/browser-${Date.now()}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`→ ${file.pathname}`);
} finally {
  await browser.close();
  server.kill();
}
