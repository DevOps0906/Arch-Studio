// node scripts/measure.ts <mode...>
//   vite        : vite-shell/dist 정적 서빙 + 엄격 CSP
//   next-none   : next start + CSP 없음(기능 기준선)
//   next-strict : next start + 엄격 CSP(헤더 덮어씀)
//   next-nonce  : next start(SPIKE_NONCE=1 빌드·실행) + Next proxy.ts nonce CSP 통과
// 각 경우: 진입 HTML의 초기 JS(gzip) 합 · 인라인 스크립트 수, headless Edge 자동 점검(Link 클릭 → loader → navigate) 결과, CSP 위반 보고.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; report-uri /__csp";
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const NEXT_PORT = 3917; // 3100은 이 PC에서 Docker가 사용 중

type Collected = { result: unknown; csp: unknown[] };
let col: Collected = { result: null, csp: [] };
let resolveResult: (() => void) | null = null;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((r) => {
    const c: Buffer[] = [];
    req.on("data", (d: Buffer) => c.push(d));
    req.on("end", () => r(Buffer.concat(c)));
  });
}

async function handleSpike(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (process.env.DEBUG) console.error("REQ", req.method, req.url);
  const p = new URL(req.url!, "http://x").pathname;
  if (p === "/__result") {
    col.result = JSON.parse((await readBody(req)).toString());
    res.end("ok");
    resolveResult?.();
    return true;
  }
  if (p === "/__csp") {
    const b = JSON.parse((await readBody(req)).toString() || "{}");
    const r = b["csp-report"] ?? b;
    col.csp.push({ directive: r["violated-directive"] ?? r["effective-directive"], blocked: r["blocked-uri"], sample: r["script-sample"] });
    res.end();
    return true;
  }
  return false;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

function startVite(): Promise<number> {
  const dist = join(root, "vite-shell/dist");
  const srv = createServer(async (req, res) => {
    if (await handleSpike(req, res)) return;
    const p = new URL(req.url!, "http://x").pathname;
    let f = join(dist, p);
    if (!existsSync(f) || p === "/") f = join(dist, "index.html"); // SPA 폴백(정적 호스팅 rewrite와 같음)
    const ext = extname(f);
    res.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
    if (ext === ".html") res.setHeader("content-security-policy", STRICT);
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, () => r((srv.address() as { port: number }).port)));
}

function startNextProxy(mode: string): Promise<number> {
  const srv = createServer(async (req, res) => {
    if (await handleSpike(req, res)) return;
    const up = httpRequest({ host: "127.0.0.1", port: NEXT_PORT, path: req.url, method: req.method, headers: req.headers }, (ur) => {
      const h = { ...ur.headers };
      if (mode === "next-strict") h["content-security-policy"] = STRICT;
      if (mode === "next-none") delete h["content-security-policy"];
      res.writeHead(ur.statusCode ?? 500, h);
      ur.pipe(res);
    });
    req.pipe(up);
  });
  return new Promise((r) => srv.listen(0, () => r((srv.address() as { port: number }).port)));
}

async function waitHttp(url: string) {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("서버 시작 실패 " + url);
}

const gz = (b: Uint8Array) => gzipSync(b, { level: 9 }).length;

async function initialJs(base: string, path: string) {
  const html = await (await fetch(base + path)).text();
  const srcs = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) srcs.add(m[1]!);
  for (const m of html.matchAll(/<link[^>]*rel="(?:modulepreload|preload)"[^>]*href="([^"]+\.js[^"]*)"/g)) srcs.add(m[1]!);
  for (const m of html.matchAll(/<link[^>]*href="([^"]+\.js[^"]*)"[^>]*rel="(?:modulepreload|preload)"/g)) srcs.add(m[1]!);
  let raw = 0;
  let gzip = 0;
  for (const s of srcs) {
    const b = new Uint8Array(await (await fetch(new URL(s.replace(/&amp;/g, "&"), base + path))).arrayBuffer());
    raw += b.length;
    gzip += gz(b);
  }
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1]!.trim().length > 0);
  return { files: srcs.size, rawKB: +(raw / 1024).toFixed(2), gzipKB: +(gzip / 1024).toFixed(2), inlineScripts: inline.length, inlineBytes: inline.reduce((a, m) => a + m[1]!.length, 0) };
}

async function jsGzipOf(base: string, paths: string[]) {
  let g = 0;
  for (const p of paths) g += gz(new Uint8Array(await (await fetch(base + p)).arrayBuffer()));
  return +(g / 1024).toFixed(2);
}

async function runEdge(url: string): Promise<Collected> {
  col = { result: null, csp: [] };
  const prof = mkdtempSync(join(tmpdir(), "edge-spike-"));
  const p = spawn(EDGE, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${prof}`, url], { stdio: "ignore" });
  await Promise.race([new Promise<void>((r) => (resolveResult = r)), new Promise((r) => setTimeout(r, 20000))]);
  await new Promise((r) => setTimeout(r, 500)); // 늦은 CSP 보고 수집
  try {
    execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" });
  } catch {}
  resolveResult = null;
  return col;
}

type SmokeResult = { steps: { at: string; pathname: string; params: unknown; data: unknown; href: string }[]; scripts: { name: string; start: number }[]; fetches: string[]; domContentLoaded: number };

async function scenario(name: string, base: string, entry: string) {
  const init = await initialJs(base, entry);
  const r = await runEdge(base + entry + "?auto=1");
  const res = r.result as SmokeResult | null;
  let lazy: unknown = null;
  if (res) {
    const late = res.scripts.filter((s) => s.start > res.domContentLoaded).map((s) => s.name);
    lazy = { lateScriptCount: late.length, lateScripts: late, lateGzipKB: await jsGzipOf(base, late), rscFetches: res.fetches.filter((f) => f.includes("_rsc")).length, totalScriptsLoaded: res.scripts.length };
  }
  const steps = res?.steps.map((s) => `${s.at} path=${s.pathname} params=${JSON.stringify(s.params)} data=${JSON.stringify(s.data)}`);
  const cspSummary = [...new Set(r.csp.map((c) => JSON.stringify(c)))].slice(0, 5);
  return { name, entry, initial: init, smokePassed: !!res && res.steps.map((s) => s.at).join(">") === "projects>site>plans", steps, lazy, cspViolations: r.csp.length, cspSamples: cspSummary };
}

const modes = process.argv.slice(2);
const out: unknown[] = [];
let next: ChildProcess | null = null;
for (const mode of modes) {
  if (mode === "vite") {
    const port = await startVite();
    out.push({ mode, ...(await scenario("vite+rr", `http://127.0.0.1:${port}`, "/projects")) });
    continue;
  }
  if (!next) {
    next = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", join(root, "next-shell"), "-p", String(NEXT_PORT)], { stdio: "ignore", env: { ...process.env } });
    await waitHttp(`http://127.0.0.1:${NEXT_PORT}/c/projects`);
  }
  const port = await startNextProxy(mode);
  const base = `http://127.0.0.1:${port}`;
  for (const [n, e] of [["next-C-codegen", "/c/projects"], ["next-A-catchall", "/a/projects"], ["next-B-rr-in-next", "/b/projects"]] as const) {
    out.push({ mode, ...(await scenario(n, base, e)) });
  }
}
if (next) execSync(`taskkill /PID ${next.pid} /T /F`, { stdio: "ignore" });
const file = join(root, "out", `measure-${modes.join("_")}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
