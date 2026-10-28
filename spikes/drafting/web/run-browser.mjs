// node web/run-browser.mjs : esbuild로 워커 번들 → 로컬 서버 → headless Edge로 실제 Web Worker 실행
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url);
const r = await build({ entryPoints: [new URL('worker-entry.ts', here).pathname.slice(1)], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'error' });
const js = r.outputFiles[0].text;
const font = readFileSync('C:/Windows/Fonts/NanumGothic-Regular.ttf');
let done;
const finished = new Promise((res) => (done = res));
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(readFileSync(new URL('index.html', here))); }
  else if (u.pathname === '/worker.js') { res.setHeader('content-type', 'text/javascript'); res.end(js); }
  else if (u.pathname === '/font') res.end(font);
  else if (u.pathname === '/result') {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (body.length) writeFileSync(new URL('../out/browser-site1.pdf', here), body);
      res.end('ok'); done({ meta: JSON.parse(u.searchParams.get('meta')), bytes: body.length, head: body.subarray(0, 5).toString() });
    });
  } else { res.statusCode = 404; res.end(); }
}).listen(0);
const port = srv.address().port;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const prof = mkdtempSync(join(tmpdir(), 'edge-'));
const p = spawn(edge, ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
const t = setTimeout(() => done({ error: 'timeout 60s' }), 60000);
const res = await finished;
clearTimeout(t); p.kill(); srv.close();
console.log(JSON.stringify(res));
process.exit(0);
