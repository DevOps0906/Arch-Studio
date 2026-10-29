// features/auth: finish 호출 계약(Bearer 주입·본문 최소·멱등 키 동일 재전송)과 로그인·온보딩 상태기계.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient, type FetchInit, type FetchLike } from "../api-client/index.ts";
import {
  aiCallsAllowed,
  aiRouteHint,
  authReducer,
  INITIAL_AUTH_STATE,
  loginErrorFromApi,
  parseFinishData,
  requestFinishLogin,
  type AuthState,
  type FinishResult,
} from "./index.ts";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.SECRET-ACCESS.sig";
const DATA = {
  next: "/onboarding",
  needs_onboarding: true,
  session: {
    user_id: "11111111-1111-4111-8111-111111111111",
    display_name: "소유자(체험 중)",
    platform_role: "user",
    status: "active",
    org: { id: "22222222-2222-4222-8222-222222222222", name: "n", slug: "s", role: "owner" },
    plan_code: "trial",
    entitled: true,
    credit_balance: 30,
  },
};

function harness(status = 200, body: unknown = { ok: true, data: DATA }) {
  const calls: { url: string; init: FetchInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  const api = createApiClient({ baseUrl: "http://127.0.0.1:3123", getAccessToken: async () => TOKEN, fetch, sleep: async () => {} });
  return { api, calls };
}

test("owner finish: Bearer는 주입된 토큰, 본문은 provider만, 응답은 entitled·trial·30", async () => {
  const { api, calls } = harness();
  const r = await requestFinishLogin(api, "email", "key-1");
  assert.equal(r.session.entitled, true);
  assert.equal(r.session.plan_code, "trial");
  assert.equal(r.session.credit_balance, 30);
  assert.equal(r.needsOnboarding, true);
  assert.equal(calls[0]?.url, "http://127.0.0.1:3123/api/auth/finish");
  assert.equal(calls[0]?.init.headers.Authorization ?? calls[0]?.init.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0]?.init.body ?? "{}"), { provider: "email" });
});

test("재로그인 3회: 같은 시도 안 재전송은 같은 멱등 키(서버 bootstrap은 DB 멱등 → 원장 1행은 통합 시나리오)", async () => {
  const { api, calls } = harness();
  for (let i = 0; i < 3; i += 1) await requestFinishLogin(api, "email", "same-key");
  const keys = calls.map((c) => c.init.headers["Idempotency-Key"]);
  assert.deepEqual(keys, ["same-key", "same-key", "same-key"]);
});

test("응답 모양 검사: 외부 next·잔액 소수·역할 이상은 invalid_response", async () => {
  for (const bad of [
    { ...DATA, next: "//evil.com" },
    { ...DATA, next: "https://evil.com" },
    { ...DATA, session: { ...DATA.session, credit_balance: 1.5 } },
    { ...DATA, session: { ...DATA.session, org: { id: "x", role: "root" } } },
  ]) {
    assert.throws(() => parseFinishData(bad));
    const { api } = harness(200, { ok: true, data: bad });
    await assert.rejects(requestFinishLogin(api, "email", "k"), (e: { code?: string }) => e.code === "invalid_response");
  }
});

const session = parseFinishData(DATA).session;
const asRole = (role: "owner" | "admin" | "member" | "viewer"): FinishResult => ({
  next: "/onboarding",
  needsOnboarding: true,
  session: { ...session, org: { id: session.org!.id, role } },
});

function run(events: Parameters<typeof authReducer>[1][], start: AuthState = INITIAL_AUTH_STATE): AuthState {
  return events.reduce(authReducer, start);
}

test("상태기계: 로그인 → finish → 약관 → AI(owner) → 시작 → ready", () => {
  const s = run([
    { type: "SIGN_IN_START" },
    { type: "SIGN_IN_OK" },
    { type: "FINISH_OK", result: asRole("owner") },
    { type: "ACCEPT_TERMS", allChecked: true },
    { type: "SET_CROSS_BORDER", ack: false },
  ]);
  assert.equal(s.kind === "onboarding" && s.progress.step, "start");
  assert.equal(s.kind === "onboarding" && aiRouteHint(s.progress), "open_source_only");
  assert.equal(aiCallsAllowed(s), false);
  const done = authReducer(s, { type: "START" });
  assert.equal(done.kind, "ready");
  assert.equal(aiCallsAllowed(done), true);
});

test("온보딩 우회 차단: 약관 미동의로 AI·시작 단계 불가, 체크 누락은 진행 안 함, member는 국외 이전 설정 불가", () => {
  const onb = run([{ type: "SIGN_IN_START" }, { type: "SIGN_IN_OK" }, { type: "FINISH_OK", result: asRole("owner") }]);
  assert.equal(aiCallsAllowed(onb), false);
  for (const ev of [{ type: "START" }, { type: "SET_CROSS_BORDER", ack: true }, { type: "SKIP_CROSS_BORDER" }, { type: "ACCEPT_TERMS", allChecked: false }] as const) {
    assert.equal(authReducer(onb, ev), onb, ev.type);
  }
  const member = run([{ type: "SIGN_IN_START" }, { type: "SIGN_IN_OK" }, { type: "FINISH_OK", result: asRole("member") }, { type: "ACCEPT_TERMS", allChecked: true }]);
  assert.equal(member.kind === "onboarding" && member.progress.step, "start", "member는 AI 단계를 건너뜀");
  assert.equal(member.kind === "onboarding" && member.progress.crossBorderAck, null);
});

test("finish 실패·로그아웃: signed_out으로, 오류 코드 매핑", () => {
  const failed = run([{ type: "SIGN_IN_START" }, { type: "SIGN_IN_OK" }, { type: "FINISH_FAILED", code: loginErrorFromApi("no_profile") }]);
  assert.deepEqual(failed, { kind: "signed_out", error: "no_profile" });
  const ready = run([{ type: "SIGN_IN_START" }, { type: "SIGN_IN_OK" }, { type: "FINISH_OK", result: { ...asRole("owner"), needsOnboarding: false, next: "/projects" } }]);
  assert.equal(ready.kind, "ready");
  const out = run([{ type: "SIGN_OUT" }, { type: "SIGNED_OUT" }], ready);
  assert.deepEqual(out, INITIAL_AUTH_STATE);
  assert.equal(loginErrorFromApi("pending"), "suspended");
  assert.equal(loginErrorFromApi("network_offline"), "network");
  assert.equal(loginErrorFromApi("whatever"), "login_failed");
});
