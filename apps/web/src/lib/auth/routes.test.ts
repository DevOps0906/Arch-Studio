// /api/dev/login·/api/auth/finish 본체(목 의존성): 원격·배포 404, CSRF, 입력 검사, 응답·로그에 토큰·이메일·비밀번호 0.
import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthConfig, isMockAuthAllowed } from "./config.ts";
import { handleDevLogin, handleDevLoginOtherMethod, type DevLoginDeps } from "./dev-login-route.ts";
import { handleAuthFinish } from "./finish-route.ts";
import { fakeDb, fakeFinishDeps, MOCK_CONFIG, PASSWORD, spyConsole, TOKEN, type FakeDb } from "./test-helpers.ts";

const ORIGIN = "http://127.0.0.1:3123";
const LOCAL_ENV = { AUTH_MODE: "mock", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", DEV_SEED_PASSWORD: PASSWORD };

function devDeps(env: Record<string, string | undefined>, db: FakeDb = fakeDb(), signInOk = true) {
  const calls: { email: string; password: string }[] = [];
  let signedOut = 0;
  const deps: DevLoginDeps = {
    mockAllowed: () => isMockAuthAllowed(env),
    config: () => getAuthConfig(env),
    seedPassword: () => env.DEV_SEED_PASSWORD ?? "",
    async signIn(email, password) {
      calls.push({ email, password });
      return signInOk;
    },
    async signOut() {
      signedOut += 1;
    },
    finishDeps: (config) => fakeFinishDeps(db, { config }),
  };
  return { deps, calls, signedOut: () => signedOut };
}

function post(body: string, headers: Record<string, string> = {}, url = `${ORIGIN}/api/dev/login`): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body,
  });
}

async function text(res: Response): Promise<string> {
  return res.body ? await res.text() : "";
}

test("원격·배포 환경: /api/dev/login 모든 메서드 404(본문 없음), 로그인 시도 0", async () => {
  const envs = [
    {},
    { ...LOCAL_ENV, AUTH_MODE: "live" },
    { ...LOCAL_ENV, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" },
    { ...LOCAL_ENV, VERCEL_ENV: "production" },
    { ...LOCAL_ENV, VERCEL: "1" },
    { ...LOCAL_ENV, RAILWAY_ENVIRONMENT: "production" },
    { ...LOCAL_ENV, DEV_SEED_PASSWORD: undefined },
  ];
  for (const env of envs) {
    const { deps, calls } = devDeps(env);
    const res = await handleDevLogin(post(JSON.stringify({ persona: "owner" })), deps);
    assert.equal(res.status, 404, JSON.stringify(env));
    assert.equal(await text(res), "");
    assert.equal(handleDevLoginOtherMethod(deps).status, 404);
    for (const method of ["GET", "PUT", "DELETE"]) {
      const r = await handleDevLogin(new Request(`${ORIGIN}/api/dev/login`, { method }), deps);
      assert.equal(r.status, 404);
    }
    assert.equal(calls.length, 0);
  }
});

test("로컬이어도 프록시 전달 헤더(x-forwarded-for·x-forwarded-host·forwarded)가 있으면 모든 메서드 404, 로그인 시도 0", async () => {
  const proxied: Record<string, string>[] = [
    { "x-forwarded-for": "203.0.113.7" },
    { "x-forwarded-host": "127.0.0.1:3123" },
    { forwarded: "for=203.0.113.7;host=127.0.0.1:3123" },
    { "X-Forwarded-For": "127.0.0.1" },
  ];
  for (const headers of proxied) {
    const { deps, calls } = devDeps(LOCAL_ENV);
    const res = await handleDevLogin(post(JSON.stringify({ persona: "owner" }), headers), deps);
    assert.equal(res.status, 404, JSON.stringify(headers));
    assert.equal(await text(res), "");
    const get = new Request(`${ORIGIN}/api/dev/login`, { method: "GET", headers });
    assert.equal(handleDevLoginOtherMethod(deps, get).status, 404, JSON.stringify(headers));
    assert.equal((await handleDevLogin(get, deps)).status, 404);
    assert.equal(calls.length, 0);
  }
});

test("Host·Origin을 loopback으로 꾸민 비브라우저 요청: 판정이 NODE_ENV=production이면 404", async () => {
  // 재현: req.url=http://192.168.0.5:3000, Origin·Host=localhost → isSameOriginRequest는 참(헤더는 요청자가 정한다).
  // 그래서 헤더 검사만 믿지 않고 판정(프로덕션 거부)·바인딩(dev -H 127.0.0.1)·전달 헤더 404를 겹친다.
  const { deps, calls } = devDeps({ ...LOCAL_ENV, NODE_ENV: "production" });
  const req = post(JSON.stringify({ persona: "owner" }), { origin: "http://localhost:3000", host: "localhost:3000" }, "http://192.168.0.5:3000/api/dev/login");
  assert.equal((await handleDevLogin(req, deps)).status, 404);
  assert.equal(calls.length, 0);
});

test("로컬: GET은 405, JSON 로그인은 finishLogin 결과를 준다(entitled·trial·30)", async () => {
  const { deps, calls } = devDeps(LOCAL_ENV);
  assert.equal(handleDevLoginOtherMethod(deps).status, 405);
  const res = await handleDevLogin(post(JSON.stringify({ persona: "owner" })), deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; data: { next: string; session: { entitled: boolean; plan_code: string; credit_balance: number } } };
  assert.equal(body.ok, true);
  assert.deepEqual(
    { e: body.data.session.entitled, p: body.data.session.plan_code, b: body.data.session.credit_balance },
    { e: true, p: "trial", b: 30 },
  );
  assert.deepEqual(calls, [{ email: "owner@dev.test", password: PASSWORD }]);
});

test("CSRF: Origin 없음·다른 출처·cross-site → 403, 로그인 시도 0", async () => {
  const { deps, calls } = devDeps(LOCAL_ENV);
  const body = JSON.stringify({ persona: "owner" });
  const noOrigin = new Request(`${ORIGIN}/api/dev/login`, { method: "POST", headers: { "content-type": "application/json" }, body });
  assert.equal((await handleDevLogin(noOrigin, deps)).status, 403);
  assert.equal((await handleDevLogin(post(body, { origin: "http://evil.test" }), deps)).status, 403);
  assert.equal((await handleDevLogin(post(body, { "sec-fetch-site": "cross-site" }), deps)).status, 403);
  assert.equal((await handleDevLogin(post(body, { origin: "http://localhost:3123" }), deps)).status, 403);
  // Host 헤더 기준 비교 + DNS 리바인딩(loopback 아닌 출처 호스트) 차단
  assert.equal((await handleDevLogin(post(body, { host: "127.0.0.1:9999" }), deps)).status, 403);
  const rebind = post(body, { origin: "http://evil.test:3123", host: "evil.test:3123" }, "http://evil.test:3123/api/dev/login");
  assert.equal((await handleDevLogin(rebind, deps)).status, 403);
  assert.equal(calls.length, 0);
  const viaHost = post(body, { host: "127.0.0.1:3123" }, "http://localhost:3123/api/dev/login");
  assert.equal((await handleDevLogin(viaHost, deps)).status, 200);
});

test("입력: 모르는 페르소나·추가 필드·이메일 직접 지정·큰 본문·잘못된 형식", async () => {
  const { deps, calls } = devDeps(LOCAL_ENV);
  assert.equal((await handleDevLogin(post(JSON.stringify({ persona: "root" })), deps)).status, 422);
  assert.equal((await handleDevLogin(post(JSON.stringify({ persona: "owner", email: "x@y.z" })), deps)).status, 422);
  assert.equal((await handleDevLogin(post(JSON.stringify({ persona: "owner", pad: "x".repeat(3000) })), deps)).status, 413);
  assert.equal((await handleDevLogin(post("{"), deps)).status, 400);
  assert.equal((await handleDevLogin(post("a", { "content-type": "text/plain" }), deps)).status, 415);
  assert.equal(calls.length, 0);
});

test("폼(로그인 화면): 303 + 상대 경로만, open redirect 차단", async () => {
  const { deps } = devDeps(LOCAL_ENV, fakeDb());
  const form = (body: string) => post(body, { "content-type": "application/x-www-form-urlencoded" });
  const ok = await handleDevLogin(form("persona=owner&next=%2Fprojects"), deps);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/onboarding"); // 약관 동의 저장소가 없어 항상 온보딩
  const bad = await handleDevLogin(form("persona=nobody"), deps);
  assert.equal(bad.headers.get("location"), "/login?error=request");
  const dup = await handleDevLogin(form("persona=owner&persona=ops"), deps);
  assert.equal(dup.headers.get("location"), "/login?error=request");
});

test("로그인 실패·정지 계정: 고정 문구, 이메일·비밀번호가 응답·로그에 없음, 실패 시 쿠키 세션 정리", async () => {
  const spy = spyConsole();
  try {
    const fail = devDeps(LOCAL_ENV, fakeDb(), false);
    const r1 = await handleDevLogin(post(JSON.stringify({ persona: "owner" })), fail.deps);
    assert.equal(r1.status, 401);
    const t1 = await r1.text();
    assert.match(t1, /로그인하지 못했습니다/);
    const susp = devDeps(LOCAL_ENV, fakeDb({ status: "suspended" }));
    const r2 = await handleDevLogin(post(JSON.stringify({ persona: "suspended" })), susp.deps);
    assert.equal(r2.status, 403);
    assert.equal(susp.signedOut(), 1);
    for (const s of [t1, await r2.text(), spy.text()]) {
      assert.ok(!s.includes(PASSWORD) && !s.includes("@dev.test") && !s.includes(TOKEN), s);
    }
  } finally {
    spy.restore();
  }
  assert.match(spy.text(), /"persona":"owner"/); // 페르소나 키(허용 목록)만 로그
});

function finishReq(body: unknown, auth: string | null = `Bearer ${TOKEN}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("http://127.0.0.1:3123/api/auth/finish", { method: "POST", headers, body: JSON.stringify(body) });
}

test("/api/auth/finish: Bearer 필수, 본문 strict(org_id 등 거부), 성공 응답 형태", async () => {
  const db = fakeDb();
  let token: string | null = null;
  const deps = {
    config: () => MOCK_CONFIG,
    forToken: (t: string) => {
      token = t;
      return fakeFinishDeps(db);
    },
  };
  assert.equal((await handleAuthFinish(finishReq({ provider: "email" }, null), deps)).status, 401);
  assert.equal((await handleAuthFinish(finishReq({ provider: "email" }, "Basic abc"), deps)).status, 401);
  assert.equal((await handleAuthFinish(finishReq({ provider: "email", org_id: "x" }), deps)).status, 422);
  assert.equal((await handleAuthFinish(finishReq({ provider: "email", code: "abc" }), deps)).status, 422);
  assert.equal((await handleAuthFinish(finishReq({ provider: "github" }), deps)).status, 422);
  const res = await handleAuthFinish(finishReq({ provider: "email", first_login_hint: true }), deps);
  assert.equal(res.status, 200);
  assert.equal(token, TOKEN);
  const body = (await res.json()) as { data: { next: string; needs_onboarding: boolean; session: Record<string, unknown> } };
  assert.equal(body.data.next, "/onboarding");
  assert.equal(body.data.needs_onboarding, true);
  assert.equal(body.data.session.entitled, true);
  assert.equal(body.data.session.plan_code, "trial");
  assert.equal(body.data.session.credit_balance, 30);
});

test("/api/auth/finish: 제공자 불일치 403, 프로필 없음 401 + next /login, 설정 오류 500(원문 없음)", async () => {
  const spy = spyConsole();
  try {
    const db = fakeDb();
    const deps = { config: () => MOCK_CONFIG, forToken: () => fakeFinishDeps(db) };
    const r1 = await handleAuthFinish(finishReq({ provider: "google" }), deps);
    assert.equal(r1.status, 403);
    assert.equal(((await r1.json()) as { error: { code: string } }).error.code, "provider");
    const np = { config: () => MOCK_CONFIG, forToken: () => fakeFinishDeps(fakeDb({ profile: false })) };
    const r2 = await handleAuthFinish(finishReq({ provider: "email" }), np);
    assert.equal(r2.status, 401);
    assert.equal(((await r2.json()) as { data: { next: string } }).data.next, "/login");
    const broken = {
      config: () => {
        throw new Error(`bad ${TOKEN}`);
      },
      forToken: () => fakeFinishDeps(db),
    };
    const r3 = await handleAuthFinish(finishReq({ provider: "email" }), broken);
    assert.equal(r3.status, 500);
    assert.ok(!(await r3.text()).includes(TOKEN));
  } finally {
    spy.restore();
  }
  assert.ok(!spy.text().includes(TOKEN));
});
