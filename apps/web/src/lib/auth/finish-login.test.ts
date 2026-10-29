// finishLogin 수용 기준(DB 없이 목): owner → entitled·trial·30, 재로그인 3회에도 가입 원장 1행(같은 멱등 키), 제공자·상태 분기.
import assert from "node:assert/strict";
import { test } from "node:test";
import { finishLogin } from "./finish-login.ts";
import { fakeDb, fakeFinishDeps, ORG_ID, spyConsole, TOKEN, USER_ID } from "./test-helpers.ts";

test("owner 로그인 → session_context('arch') entitled=true, plan trial, 잔액 30, 약관 전이면 온보딩", async () => {
  const db = fakeDb();
  const r = await finishLogin(fakeFinishDeps(db), { provider: "email", next: "/projects/x" });
  assert.equal(r.kind, "ok");
  if (r.kind !== "ok") return;
  assert.equal(r.session.entitled, true);
  assert.equal(r.session.plan_code, "trial");
  assert.equal(r.session.credit_balance, 30);
  assert.equal(r.session.org?.role, "owner");
  assert.equal(r.next, "/onboarding");
  assert.equal(r.needsOnboarding, true);
  assert.equal(db.bootstrapCalls, 0, "이미 entitled면 bootstrap 안 함");
  assert.equal(db.audits.length, 1);
  assert.deepEqual(db.audits[0]?.meta, { provider: "email", first_login: false });
  assert.ok(!("email" in r.session), "클라이언트 형태에 이메일 없음");
});

test("약관 동의가 있으면 검사한 next로", async () => {
  const db = fakeDb();
  const terms = { hasAcceptedCurrent: async () => true, record: async () => true };
  const ok = await finishLogin(fakeFinishDeps(db, { terms }), { provider: "email", next: "/projects/x" });
  const evil = await finishLogin(fakeFinishDeps(db, { terms }), { provider: "email", next: "//evil.com" });
  assert.equal(ok.kind === "ok" && ok.next, "/projects/x");
  assert.equal(evil.kind === "ok" && evil.next, "/projects");
});

test("entitled=false(첫 진입) → bootstrap 1회 후 재조회. 재로그인 3회에도 가입 크레딧 원장 1행(같은 키)", async () => {
  const db = fakeDb({ entitled: false, ledger: new Map() });
  const first = await finishLogin(fakeFinishDeps(db), { provider: "email" });
  assert.equal(first.kind === "ok" && first.firstLogin, true);
  assert.equal(first.kind === "ok" && first.session.credit_balance, 30);
  for (let i = 0; i < 3; i += 1) {
    db.entitled = false; // 최악 가정: 매번 entitled=false로 보여 bootstrap이 다시 불려도
    const again = await finishLogin(fakeFinishDeps(db), { provider: "email" });
    assert.equal(again.kind, "ok");
  }
  assert.equal(db.bootstrapCalls, 4);
  assert.deepEqual([...db.ledger.keys()], [`signup:${ORG_ID}:arch`]);
  assert.equal([...db.ledger.values()].reduce((a, b) => a + b, 0), 30);
});

test("제공자: 단계 허용 목록 밖, 또는 본문 주장과 토큰 사용자 제공자가 다르면 403 provider", async () => {
  const db = fakeDb();
  const google = await finishLogin(fakeFinishDeps(db), { provider: "google" });
  assert.deepEqual(google, { kind: "forbidden", reason: "provider" });
  const live = { mode: "live" as const, providers: ["google" as const, "email" as const] };
  const lie = await finishLogin(fakeFinishDeps(db, { config: live, user: { id: USER_ID, provider: "google" } }), { provider: "email" });
  assert.deepEqual(lie, { kind: "forbidden", reason: "provider" });
  assert.equal(db.audits.length, 0);
});

test("상태: suspended·pending은 403이고 bootstrap하지 않는다", async () => {
  for (const status of ["suspended", "pending"] as const) {
    const db = fakeDb({ status, entitled: false });
    const r = await finishLogin(fakeFinishDeps(db), { provider: "email" });
    assert.deepEqual(r, { kind: "forbidden", reason: status });
    assert.equal(db.bootstrapCalls, 0);
  }
});

test("프로필 없음 → no_profile, 사용자 없음·불일치 → unauthorized", async () => {
  assert.deepEqual(await finishLogin(fakeFinishDeps(fakeDb({ profile: false })), { provider: "email" }), { kind: "no_profile" });
  assert.deepEqual(await finishLogin(fakeFinishDeps(fakeDb(), { user: null }), { provider: "email" }), { kind: "unauthorized" });
  const other = { id: "33333333-3333-4333-8333-333333333333", provider: "email" };
  assert.deepEqual(await finishLogin(fakeFinishDeps(fakeDb(), { user: other }), { provider: "email" }), { kind: "unauthorized" });
});

test("감사 실패는 로그인을 막지 않고, 로그에는 코드만(토큰·이메일 없음)", async () => {
  const spy = spyConsole();
  try {
    const r = await finishLogin(fakeFinishDeps(fakeDb(), { auditThrows: true }), { provider: "email" });
    assert.equal(r.kind, "ok");
  } finally {
    spy.restore();
  }
  const out = spy.text();
  assert.match(out, /42501/);
  assert.ok(!out.includes(TOKEN) && !out.includes("@dev.test"));
});
