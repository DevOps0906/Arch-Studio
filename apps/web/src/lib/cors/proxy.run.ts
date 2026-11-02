// 자식 프로세스 본체(cors.test.ts가 `--import route-loader.mjs`로 띄운다): 실제 proxy()를 NextRequest로 불러 헤더를 JSON으로 출력.
// next/server는 exports 맵이 없어 일반 node --test에서 바로 불러오지 못한다.
import { NextRequest } from "next/server";
import { proxy } from "../../proxy.ts";

Object.assign(process.env, {
  STUDIO_ORIGIN: "https://app.example.test",
  DESKTOP_CORS_ORIGINS: "http://tauri.localhost, https://tauri.localhost",
});

const cases: { name: string; method: string; path: string; headers: Record<string, string> }[] = [
  { name: "preflight-allowed", method: "OPTIONS", path: "/api/cloud-projects", headers: { origin: "https://app.example.test", "access-control-request-method": "POST" } },
  { name: "preflight-desktop", method: "OPTIONS", path: "/api/site/lookup", headers: { origin: "http://tauri.localhost", "access-control-request-method": "POST" } },
  { name: "preflight-denied", method: "OPTIONS", path: "/api/cloud-projects", headers: { origin: "https://evil.example.test", "access-control-request-method": "POST" } },
  { name: "get-allowed", method: "GET", path: "/api/cloud-projects", headers: { origin: "https://app.example.test" } },
  { name: "get-denied", method: "GET", path: "/api/cloud-projects", headers: { origin: "https://evil.example.test" } },
  { name: "page", method: "GET", path: "/login", headers: { origin: "https://app.example.test" } },
];

const out: Record<string, { status: number; headers: Record<string, string> }> = {};
for (const c of cases) {
  const res = proxy(new NextRequest(`http://127.0.0.1:3000${c.path}`, { method: c.method, headers: c.headers }));
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  out[c.name] = { status: res.status, headers };
}
process.stdout.write(`${JSON.stringify(out)}\n`);
