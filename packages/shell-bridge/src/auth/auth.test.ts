// 데스크톱 인증(Stage A): 릴리스 판정 기본 live, 개발 Mock 로그인 → 세션은 키체인에만, 로그아웃은 signOut 실패에도 키체인 0.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createArchSupabaseClient, createTauriBridge } from "../index.ts";
import { createKeychainInvoke } from "../testing/index.ts";
import { errorSurface, spyConsole, spyWebStorage } from "../test-helpers.ts";
import { createDevMockAuth, DEV_PERSONAS } from "./dev-mock.ts";
import { createDesktopAuthSession, desktopAuthMode, loadDevMockAuth } from "./index.ts";

const LOCAL_URL = "http://127.0.0.1:54321";
const PASSWORD = "DEV-SEED-PASSWORD-VALUE";

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", exp, role: "authenticated" })}.SECRET-ACCESS-SIG`,
    refresh_token: "SECRET-REFRESH-TOKEN",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: { id: "u1", aud: "authenticated", role: "authenticated", email: "owner@dev.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-29T00:00:00Z" },
  };
}

/** GoTrue 흉내: password grant는 비밀번호가 맞을 때만, logout은 failLogout이면 네트워크 오류. */
function gotrue(opts: { failLogout?: boolean } = {}) {
  const bodies: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? init.body : "";
    bodies.push(body);
    if (url.includes("/token?grant_type=password")) {
      const { password } = JSON.parse(body) as { password: string };
      if (password !== PASSWORD) return new Response(JSON.stringify({ error: "invalid_grant", error_description: `bad ${password}` }), { status: 400 });
      return new Response(JSON.stringify(session()), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/logout")) {
      if (opts.failLogout) throw new TypeError("network down");
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { fetch: f, bodies };
}

test("Node(=릴리스와 같은 조건): 인증 단계는 live, Mock 모듈은 열리지 않는다", async () => {
  assert.equal(desktopAuthMode(), "live");
  const { invoke } = createKeychainInvoke();
  const bridge = createTauriBridge(invoke);
  const supabase = createArchSupabaseClient({ url: LOCAL_URL, anonKey: "anon", secrets: bridge.secrets, fetch: gotrue().fetch });
  assert.equal(await loadDevMockAuth({ supabase, supabaseUrl: LOCAL_URL }), null);
});

test("개발 Mock: 시드 계정 signInWithPassword → 세션은 키체인에만, 웹 스토리지 0, 로그·오류에 비밀번호·토큰 없음", async () => {
  const storage = spyWebStorage();
  const out = spyConsole();
  try {
    const { invoke, keychain } = createKeychainInvoke();
    const bridge = createTauriBridge(invoke);
    const net = gotrue();
    const supabase = createArchSupabaseClient({ url: LOCAL_URL, anonKey: "anon", secrets: bridge.secrets, fetch: net.fetch });
    const mock = createDevMockAuth({ supabase, supabaseUrl: LOCAL_URL });
    const bad = await mock.signInPersona("owner", "wrong");
    assert.deepEqual(bad, { ok: false, code: "login_failed" });
    const ok = await mock.signInPersona("owner", PASSWORD);
    assert.deepEqual(ok, { ok: true, userId: "u1" });
    assert.ok(keychain.get("auth.session")?.includes("SECRET-REFRESH-TOKEN"));
    const auth = createDesktopAuthSession({ bridge, supabase });
    assert.match((await auth.getAccessToken()) ?? "", /SECRET-ACCESS-SIG$/);
    assert.deepEqual(storage.writes, []);
    const surface = out.text() + errorSurface(bad);
    assert.ok(!surface.includes(PASSWORD) && !surface.includes("SECRET-") && !surface.includes("wrong"));
  } finally {
    out.restore();
    storage.restore();
  }
});

test("개발 Mock 거부: 원격 URL·모르는 페르소나·빈 비밀번호는 네트워크 호출 0", async () => {
  const { invoke } = createKeychainInvoke();
  const bridge = createTauriBridge(invoke);
  const net = gotrue();
  const remote = "https://abc.supabase.co";
  const supabase = createArchSupabaseClient({ url: remote, anonKey: "anon", secrets: bridge.secrets, fetch: net.fetch });
  assert.deepEqual(await createDevMockAuth({ supabase, supabaseUrl: remote }).signInPersona("owner", PASSWORD), { ok: false, code: "not_local" });
  const local = createDevMockAuth({ supabase, supabaseUrl: LOCAL_URL });
  assert.deepEqual(await local.signInPersona("root", PASSWORD), { ok: false, code: "invalid_persona" });
  assert.deepEqual(await local.signInPersona("owner", ""), { ok: false, code: "no_password" });
  assert.equal(net.bodies.length, 0);
});

test("로그아웃: signOut 네트워크 실패에도 clearSecrets → 키체인 0개, 토큰 null", async () => {
  for (const failLogout of [false, true]) {
    const { invoke, keychain } = createKeychainInvoke();
    const bridge = createTauriBridge(invoke);
    const supabase = createArchSupabaseClient({ url: LOCAL_URL, anonKey: "anon", secrets: bridge.secrets, fetch: gotrue({ failLogout }).fetch });
    await createDevMockAuth({ supabase, supabaseUrl: LOCAL_URL }).signInPersona("owner", PASSWORD);
    await bridge.secrets.set("auth.pkce", JSON.stringify({ "auth.session-code-verifier": "VERIFIER" }));
    assert.ok(keychain.size > 0);
    const auth = createDesktopAuthSession({ bridge, supabase });
    await auth.signOut();
    assert.equal(keychain.size, 0, `failLogout=${failLogout}`);
    assert.equal(await auth.getAccessToken(), null);
  }
});

test("로그아웃: supabase.signOut이 throw해도 clearSecrets는 불린다", async () => {
  let cleared = 0;
  const bridge = { capabilities: {} as never, secrets: {} as never, clearSecrets: async () => void (cleared += 1) };
  const supabase = { auth: { signOut: async () => Promise.reject(new Error("boom")), getSession: async () => ({ data: { session: null } }) } };
  await createDesktopAuthSession({ bridge, supabase: supabase as never }).signOut();
  assert.equal(cleared, 1);
});

test("데스크톱 페르소나 목록 = 시드 정본(scripts/dev/personas.arch.json)", () => {
  const seed = JSON.parse(readFileSync(new URL("../../../../scripts/dev/personas.arch.json", import.meta.url), "utf8")) as {
    personas: { key: string; label: string }[];
  };
  assert.deepEqual(
    DEV_PERSONAS.map((p) => ({ key: p.key, label: p.label })),
    seed.personas.map((p) => ({ key: p.key, label: p.label })),
  );
});

test("auth/index는 dev-mock을 정적으로 내보내지 않는다(릴리스 번들 제거 조건)", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  // 타입 전용 export(빌드 때 지워짐)와 주석은 제외하고 값 import·export에 dev-mock이 없어야 한다.
  assert.doesNotMatch(src.replace(/^\s*(export type .*|\/\/.*)$/gm, ""), /dev-mock/);
  const mode = readFileSync(new URL("./mode.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mode, /^import \{[^}]*\} from "\.\/dev-mock\.ts"/m);
});
