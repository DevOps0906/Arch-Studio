// Supabase 클라이언트: PKCE verifier·세션이 SecureStore(키체인 모킹)에만 가고, 재시작 복원·로그아웃 삭제·누출 0.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BridgeError,
  createArchSupabaseClient,
  createAuthStorage,
  createTauriBridge,
  MAX_PKCE_FLOWS,
  type NativeBridge,
} from "../index.ts";
import { createKeychainInvoke } from "../testing/index.ts";
import { errorSurface, spyConsole, spyWebStorage } from "../test-helpers.ts";

const URL_ = "https://example.supabase.co";
const ANON = "anon-public-key";

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** 서명 검증은 하지 않는 가짜 JWT(만료 1시간 뒤). */
function fakeSession() {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", exp, role: "authenticated", pad: "p".repeat(900) })}.SECRET-ACCESS-SIG`;
  return {
    access_token: access,
    refresh_token: "SECRET-REFRESH-TOKEN",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user: {
      id: "u1",
      aud: "authenticated",
      role: "authenticated",
      email: "owner@example.com",
      app_metadata: { provider: "email" },
      user_metadata: { name: "x".repeat(1500) },
      created_at: "2026-10-29T00:00:00Z",
    },
  };
}

interface FetchLog {
  urls: string[];
  fetch: typeof fetch;
}

function fakeFetch(): FetchLog {
  const urls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { urls, fetch: f };
}

function client(bridge: NativeBridge, f: FetchLog) {
  return createArchSupabaseClient({ url: URL_, anonKey: ANON, secrets: bridge.secrets, fetch: f.fetch });
}

test("PKCE 시작: verifier는 키체인에만, URL에 code_challenge(S256), 웹 스토리지 쓰기 0", async () => {
  const storage = spyWebStorage();
  const out = spyConsole();
  const kc = createKeychainInvoke();
  try {
    const sb = client(createTauriBridge(kc.invoke), fakeFetch());
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "archstudio://auth/callback", skipBrowserRedirect: true },
    });
    assert.equal(error, null);
    const url = new URL(data.url ?? "");
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("code_challenge_method")?.toLowerCase(), "s256");
    const bundle = JSON.parse(kc.keychain.get("auth.pkce") ?? "{}") as Record<string, string>;
    const verifier = bundle["auth.session-code-verifier"]?.replace(/^"|"$/g, "").split("/")[0] ?? "";
    assert.ok(verifier.length >= 43, JSON.stringify(Object.keys(bundle)));
    assert.ok(!data.url?.includes(verifier)); // verifier 자체는 URL에 없다(challenge만)
  } finally {
    storage.restore();
    out.restore();
  }
  assert.deepEqual(storage.writes, []);
  assert.deepEqual([...kc.keychain.keys()], ["auth.pkce"]);
});

test("PKCE 시도가 쌓여도 키체인 항목은 auth.pkce 하나, 시도별 verifier는 상한, 로그아웃 후 0", async () => {
  const kc = createKeychainInvoke();
  const bridge = createTauriBridge(kc.invoke);
  const sb = client(bridge, fakeFetch());
  for (let i = 0; i < MAX_PKCE_FLOWS + 4; i++) {
    await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: "archstudio://auth/callback", skipBrowserRedirect: true } });
  }
  assert.deepEqual([...kc.keychain.keys()], ["auth.pkce"]);
  const bundle = JSON.parse(kc.keychain.get("auth.pkce") ?? "{}") as Record<string, string>;
  const flows = Object.keys(bundle).filter((k) => k.includes("-flow-")).length;
  assert.ok(flows >= 1 && flows <= MAX_PKCE_FLOWS, String(flows));
  await sb.auth.signOut();
  assert.equal(kc.keychain.size, 0);
});

test("재시작 후 세션 유지 → 로그아웃 시 키체인 항목 삭제, 웹 스토리지·console에 토큰 0", async () => {
  const storage = spyWebStorage();
  const out = spyConsole();
  const keychain = new Map<string, string>();
  const session = fakeSession();
  try {
    // 1회차 실행: 로그인 결과 세션을 supabase-js가 저장소에 쓰는 것과 같은 경로로 쓴다.
    const first = createTauriBridge(createKeychainInvoke(keychain).invoke);
    await createAuthStorage(first.secrets).setItem("auth.session", JSON.stringify(session));
    assert.ok(JSON.stringify(session).length > 2560, "Windows 한 항목 한계를 넘는 세션으로 검증");

    // 재시작: 새 브리지·새 클라이언트, 같은 OS 키체인.
    const f = fakeFetch();
    const bridge = createTauriBridge(createKeychainInvoke(keychain).invoke);
    const sb = client(bridge, f);
    const { data } = await sb.auth.getSession();
    assert.equal(data.session?.access_token, session.access_token);
    assert.equal(data.session?.refresh_token, "SECRET-REFRESH-TOKEN");

    // 로그아웃.
    await sb.auth.signOut();
    await bridge.clearSecrets();
    assert.equal(keychain.size, 0);
    assert.equal((await sb.auth.getSession()).data.session, null);
    assert.ok(f.urls.some((u) => u.includes("/auth/v1/logout")));
  } finally {
    storage.restore();
    out.restore();
  }
  assert.deepEqual(storage.writes, []);
  const logged = out.text();
  for (const secret of ["SECRET-ACCESS-SIG", "SECRET-REFRESH-TOKEN"]) assert.ok(!logged.includes(secret), secret);
});

test("detectSessionInUrl: false — 주소에 code가 있어도 자동 교환하지 않음", async () => {
  const g = globalThis as Record<string, unknown>;
  const savedWindow = g.window;
  g.window = { location: { href: "archstudio://auth/callback?code=SECRET-AUTH-CODE", search: "?code=SECRET-AUTH-CODE", hash: "" } };
  const f = fakeFetch();
  try {
    const sb = client(createTauriBridge(createKeychainInvoke().invoke), f);
    await sb.auth.getSession();
  } finally {
    if (savedWindow === undefined) delete g.window;
    else g.window = savedWindow;
  }
  assert.ok(!f.urls.some((u) => u.includes("grant_type=pkce") || u.includes("SECRET-AUTH-CODE")), f.urls.join("\n"));
});

test("어댑터: supabase-js가 허용 밖 키를 쓰려 하면 거부(키 원문 미포함)", async () => {
  const adapter = createAuthStorage(createTauriBridge(createKeychainInvoke().invoke).secrets);
  const err = await adapter.setItem("SECRET-TOKEN-AS-KEY", "v").catch((e: unknown) => e);
  assert.ok(err instanceof BridgeError && err.code === "SECRET_KEY_NOT_ALLOWED");
  assert.ok(!errorSurface(err).includes("SECRET-TOKEN"));
});

test("어댑터: 시도별 verifier 상한(오래된 것부터), 손상된 묶음은 빈 값, user 키는 저장 안 함", async () => {
  const kc = createKeychainInvoke();
  const adapter = createAuthStorage(createTauriBridge(kc.invoke).secrets);
  const ids = Array.from({ length: MAX_PKCE_FLOWS + 3 }, (_, i) => i.toString(16).padStart(32, "0"));
  await Promise.all(ids.map((id) => adapter.setItem(`auth.session-flow-${id}-code-verifier`, `v-${id}`)));
  const bundle = JSON.parse(kc.keychain.get("auth.pkce") ?? "{}") as Record<string, string>;
  assert.deepEqual(
    Object.keys(bundle),
    ids.slice(3).map((id) => `auth.session-flow-${id}-code-verifier`),
  );
  assert.equal(await adapter.getItem(`auth.session-flow-${ids[0]}-code-verifier`), null);
  assert.equal(await adapter.getItem(`auth.session-flow-${ids.at(-1)}-code-verifier`), `v-${ids.at(-1)}`);

  kc.keychain.set("auth.pkce", "{not json");
  assert.equal(await adapter.getItem("auth.session-code-verifier"), null);

  assert.equal(await adapter.getItem("auth.session-user"), null);
  await adapter.removeItem("auth.session-user");
  await assert.rejects(adapter.setItem("auth.session-user", "{}"), BridgeError);
  for (const bad of ["auth.session-flow-XYZ-code-verifier", "auth.session-flow--code-verifier", "other"]) {
    await assert.rejects(adapter.getItem(bad), BridgeError);
  }
});
