// 자식 프로세스 본체(studio-routes-unauth.test.ts가 `--conditions=react-server --import route-loader.mjs`로 띄운다).
// 실제 Route Handler를 Authorization 없이 부르고 [method path status] JSON 한 줄을 출력한다. 네트워크는 닿지 않는 주소만 쓴다.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STUDIO_ROUTES } from "./studio-routes.ts";

// 서버 env 검증을 통과시키는 자리표시자(실제 값 아님). 외부 주소는 닫힌 포트라 요청이 나가도 즉시 실패한다.
const CLOSED = "http://127.0.0.1:9";
Object.assign(process.env, {
  NEXT_PUBLIC_SUPABASE_URL: CLOSED,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon",
  NEXT_PUBLIC_TOSS_CLIENT_KEY: "placeholder-toss-client",
  SUPABASE_SERVICE_ROLE_KEY: "placeholder-service",
  SUPABASE_DB_SCHEMA: "core",
  APP_URL: "http://127.0.0.1:3000",
  TOSS_SECRET_KEY: "placeholder-toss",
  TOSS_WEBHOOK_SECRET: "placeholder-webhook",
  LICENSE_SIGNING_PRIVATE_KEY: "placeholder-license-key",
  LICENSE_SIGNING_KID: "placeholder-kid",
  SITE_LOOKUP_HASH_KEY: "placeholder-site-lookup-hash-key-0000000000",
  AI_TOKEN_PRIVATE_KEY: "placeholder-ai-token-key",
  AI_TOKEN_KID: "placeholder-ai-kid",
  ARCH_WORKER_INTERNAL_KEY: "placeholder-worker",
  OSS_VOICE_BASE_URL: CLOSED,
  AI_CROSS_BORDER_NOTICE_VERSION: "placeholder-v1",
  VOICE_NOTICE_VERSION: "placeholder-v1",
  ARCH_RECORDING_NOTICE_VERSION: "placeholder-v1",
  RATE_LIMIT_IP_SALT: "placeholder-salt",
  VWORLD_API_KEY: "placeholder-vworld",
  AI_SERVICE_URL: CLOSED,
  AUTH_PROVIDERS: "google,email",
  // 실패 닫힘 스위치를 모두 켠다(꺼져 있으면 503으로 먼저 막혀 인증 검사를 증명하지 못한다).
  ARCH_AI_CHAT_ENABLED: "true",
  ARCH_AI_RENDER_ENABLED: "true",
  ARCH_RENDER_PROVIDER: "mock",
  NODE_ENV: "test",
  ARCH_AI_REVIEW_ENABLED: "true",
  ARCH_SITE_MAP_ENABLED: "true",
  ARCH_VOICE_STT_ENABLED: "true",
  ARCH_API_URL: CLOSED,
});

const APP_DIR = path.resolve(import.meta.dirname, "../../app");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const out: { method: string; path: string; status: number }[] = [];
for (const r of STUDIO_ROUTES) {
  if (!r.file) continue;
  const mod = (await import(pathToFileURL(path.join(APP_DIR, r.file)).href)) as Record<string, Handler | undefined>;
  const handler = mod[r.method];
  if (!handler) {
    out.push({ method: r.method, path: r.path, status: -1 });
    continue;
  }
  const hasBody = r.method !== "GET" && r.method !== "DELETE";
  const req = new Request(`http://127.0.0.1:3000${r.path}`, {
    method: r.method,
    headers: { origin: "https://app.example.test", ...(hasBody ? { "content-type": "application/json" } : {}) },
    ...(hasBody ? { body: "{}" } : {}),
  });
  let status: number;
  try {
    status = (await handler(req, { params: Promise.resolve({ ...r.params }) })).status;
  } catch {
    status = -2;
  }
  out.push({ method: r.method, path: r.path, status });
}
process.stdout.write(`${JSON.stringify(out)}\n`);
