// 시드 정의 구조 테스트 + 가짜 Supabase(fetch)로 실행 계약(로컬 전용·멱등·비밀 미노출). 실행: node --test scripts/dev/
import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalTarget, formatReport, loadPersonaData, personaEmail, runSeed, validatePersonaData } from "./seed-lib.mjs";

const data = loadPersonaData();
const PASSWORD = "SEED-PASSWORD-SHOULD-NOT-LEAK";
const SERVICE = "SERVICE-ROLE-SHOULD-NOT-LEAK";
const ENV = { SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: SERVICE, DEV_SEED_PASSWORD: PASSWORD };

test("페르소나 데이터가 구조 검사를 통과한다", () => {
  assert.deepEqual(validatePersonaData(data), []);
});

test("AUTH_ROADMAP 2.2 공통 페르소나(open 앱: pending 제외)와 PRD 4.3 상태 행이 모두 있다", () => {
  const keys = data.personas.map((p) => p.key);
  for (const k of ["owner", "admin", "member", "viewer", "outsider", "no_app", "suspended", "ops"]) assert.ok(keys.includes(k), k);
  const states = new Set(data.personas.map((p) => p.expect.features_state));
  // PRD 4.3 표 8행 중 기간제 2행은 스키마에 없어 unsupported로 명시.
  for (const s of ["trial", "trial_expired", "licensed", "licensed_fallback", "subscribed", "subscription_expired"]) assert.ok(states.has(s), s);
  assert.deepEqual(data.unsupported.map((u) => u.key).sort(), ["devices_2", "pending", "term_active", "term_expired"]);
});

test("owner 기대값 = entitled·trial·잔액 30(AR-06-008 수용 기준)", () => {
  const owner = data.personas.find((p) => p.key === "owner");
  assert.deepEqual(
    { entitled: owner.expect.entitled, plan: owner.expect.plan_code, balance: owner.expect.credit_balance },
    { entitled: true, plan: "trial", balance: 30 },
  );
});

test("이메일은 예약 TLD .test, 데이터에 비밀번호 없음", () => {
  for (const p of data.personas) assert.match(personaEmail(data, p.key), /@dev\.test$/);
  assert.doesNotMatch(JSON.stringify(data), /password"\s*:/i);
});

test("구조 검사가 잘못된 정의를 잡는다", () => {
  const bad = structuredClone(data);
  bad.personas[1].steps.push({ op: "drop_table" });
  bad.personas[2].steps[1].of = "nobody";
  bad.personas.push({ ...bad.personas[0] });
  const errs = validatePersonaData(bad).join("\n");
  assert.match(errs, /알 수 없는 단계/);
  assert.match(errs, /join_org 대상 nobody/);
  assert.match(errs, /key 중복/);
});

test("원격 대상이면 요청 0건으로 중단", async () => {
  let calls = 0;
  const fetchSpy = async () => {
    calls += 1;
    return new Response("{}");
  };
  for (const url of ["https://abc.supabase.co", "http://10.0.0.5:54321", "http://localhost.evil.com"]) {
    await assert.rejects(runSeed({ env: { ...ENV, SUPABASE_URL: url }, fetch: fetchSpy }), /로컬/);
  }
  assert.equal(calls, 0);
  assert.doesNotThrow(() => assertLocalTarget("http://localhost:54321"));
});

test("env 누락은 이름만 알린다(값 없음)", async () => {
  await assert.rejects(runSeed({ env: { SUPABASE_URL: "http://127.0.0.1:54321" } }), (e) => {
    assert.match(e.message, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(e.message, /DEV_SEED_PASSWORD/);
    return true;
  });
});

/** 가짜 로컬 Supabase: auth admin·token·REST·RPC 최소 흉내. 가입 크레딧 원장은 멱등 키로 1행. */
function fakeSupabase() {
  const users = new Map(); // email → {id, meta}
  const orgs = new Map(); // userId → orgId
  const members = []; // {org_id,user_id,role,status}
  const ledger = new Map(); // idempotency_key → amount
  const plans = { trial: "p-trial", sub_monthly: "p-sub" };
  const ents = new Map(); // orgId → {plan, status, ageDays}
  const licenses = new Map();
  const profiles = new Map();
  let n = 0;
  const requests = [];
  const tokenOf = (id) => `tok-${id}`;
  const userOfToken = (auth) => [...users.values()].find((u) => auth === `Bearer ${tokenOf(u.id)}`);
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status });

  async function fetchImpl(url, init) {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    requests.push({ path: u.pathname + u.search, method: init.method, body: init.body ?? "", headers: JSON.stringify(init.headers) });
    const p = u.pathname;
    if (p === "/auth/v1/admin/users" && init.method === "GET") return json({ users: [...users.entries()].map(([email, x]) => ({ email, id: x.id })) });
    if (p === "/auth/v1/admin/users" && init.method === "POST") {
      n += 1;
      const id = `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
      users.set(body.email, { id, meta: body.user_metadata, password: body.password });
      const org = `org-${n}`;
      orgs.set(id, org);
      members.push({ org_id: org, user_id: id, role: "owner", status: "active" });
      profiles.set(id, { status: "active", platform_role: "user" });
      // 가입 트리거 + 모놀리스 자동 부트스트랩(signup_app 없어도 apps 1행)
      ents.set(org, { plan: "trial", status: "active", ageDays: 0 });
      if (!ledger.has(`signup:${org}:arch`)) ledger.set(`signup:${org}:arch`, 30);
      return json({ id });
    }
    if (p === "/auth/v1/token") {
      const x = users.get(body.email);
      if (!x || x.password !== body.password) return json({ error: "invalid" }, 400);
      return json({ access_token: tokenOf(x.id) });
    }
    if (p === "/rest/v1/organizations") {
      const owner = u.searchParams.get("owner_id").slice(3);
      return json([{ id: orgs.get(owner) }]);
    }
    if (p === "/rest/v1/plans") return json([{ id: plans[u.searchParams.get("code").slice(3)] }]);
    if (p === "/rest/v1/org_members") {
      const org = u.searchParams.get("org_id").slice(3);
      const uid = u.searchParams.get("user_id").slice(3);
      return json(members.filter((m) => m.org_id === org && m.user_id === uid));
    }
    if (p === "/rest/v1/rpc/invite_member") {
      members.push({ org_id: body.p_org_id, user_id: body.p_user_id, role: body.p_role, status: "invited" });
      return json(null);
    }
    if (p === "/rest/v1/rpc/accept_invite") {
      const me = userOfToken(init.headers.Authorization);
      const m = members.find((x) => x.org_id === body.p_org_id && x.user_id === me.id);
      m.status = "active";
      return json(null);
    }
    if (p === "/rest/v1/profiles") {
      Object.assign(profiles.get(u.searchParams.get("id").slice(3)), body);
      return json(null);
    }
    if (p === "/rest/v1/app_entitlements") {
      const e = ents.get(u.searchParams.get("org_id").slice(3));
      if (body.created_at) e.ageDays = 15;
      if (body.plan_id) Object.assign(e, { plan: body.plan_id === "p-sub" ? "sub_monthly" : "trial", status: body.status });
      return json(null);
    }
    if (p === "/rest/v1/subscriptions") return json(null);
    if (p === "/rest/v1/licenses") {
      licenses.set(body.serial_hash, body);
      return json(null);
    }
    if (p === "/rest/v1/rpc/session_context" || p === "/rest/v1/rpc/org_features") {
      const me = userOfToken(init.headers.Authorization);
      const org = body.p_org ?? orgs.get(me.id);
      const m = members.find((x) => x.org_id === org && x.user_id === me.id && x.status === "active");
      const e = ents.get(org);
      const entitled = e.status === "active";
      if (p.endsWith("org_features")) {
        const lic = [...licenses.values()].find((l) => l.org_id === org);
        const today = new Date().toISOString().slice(0, 10);
        let state;
        if (lic && lic.updates_until >= today) state = "licensed";
        else if (entitled && e.plan === "sub_monthly") state = "subscribed";
        else if (lic) state = "licensed_fallback";
        else if (entitled && e.plan === "trial" && e.ageDays < 14) state = "trial";
        else if (e.plan === "sub_monthly") state = "subscription_expired";
        else state = "trial_expired";
        return json({ state });
      }
      const pr = profiles.get(me.id);
      return json({
        user_id: me.id, status: pr.status, platform_role: pr.platform_role,
        org: { id: org, role: m.role }, plan_code: entitled ? e.plan : null, entitled,
        credit_balance: [...ledger.entries()].filter(([k]) => k === `signup:${org}:arch`).reduce((s, [, v]) => s + v, 0),
      });
    }
    return json({ error: "unmocked" }, 500);
  }
  return { fetchImpl, ledger, users, requests };
}

test("가짜 로컬 Supabase: 모든 페르소나가 기대값과 일치하고, 두 번 실행해도 가입 원장은 조직당 1행", async () => {
  const fake = fakeSupabase();
  const logs = [];
  const r1 = await runSeed({ env: ENV, fetch: fake.fetchImpl, log: (l) => logs.push(l) });
  assert.deepEqual(r1.filter((r) => !r.ok).map((r) => `${r.persona}:${r.mismatch}`), []);
  const ledgerRows = fake.ledger.size;
  const r2 = await runSeed({ env: ENV, fetch: fake.fetchImpl, log: (l) => logs.push(l) });
  assert.ok(r2.every((r) => r.ok));
  assert.equal(fake.ledger.size, ledgerRows);
  assert.equal(fake.users.size, data.personas.length);
  assert.ok(logs.some((l) => l.startsWith("건너뜀")));
  const out = formatReport(r2) + logs.join("\n");
  assert.ok(!out.includes(PASSWORD) && !out.includes(SERVICE));
  // admin·member·viewer는 실제 RPC(invite_member → accept_invite)로 들어간다(service_role 직접 쓰기 아님).
  assert.equal(fake.requests.filter((q) => q.path === "/rest/v1/rpc/invite_member").length, 3);
  assert.equal(fake.requests.filter((q) => q.path.startsWith("/rest/v1/org_members") && q.method !== "GET").length, 0);
});

test("실패 응답 본문(토큰·이메일이 섞일 수 있음)을 오류에 싣지 않는다", async () => {
  const leaky = async () => new Response(JSON.stringify({ msg: "owner@dev.test tok-secret" }), { status: 500 });
  await assert.rejects(runSeed({ env: ENV, fetch: leaky }), (e) => {
    assert.doesNotMatch(e.message, /dev\.test|tok-secret/);
    assert.match(e.message, /HTTP 500/);
    return true;
  });
});
