// 화면 페르소나 목록 = 시드 정본(scripts/dev/personas.arch.json) 키·라벨. 세션 파서·로그 허용 목록도 함께 검사.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sanitizeAuthLog } from "./log.ts";
import { isMockPersonaKey, MOCK_PERSONAS, mockPersonaEmail } from "./personas.ts";
import { parseSessionContext } from "./session.ts";

const seed = JSON.parse(readFileSync(new URL("../../../../../scripts/dev/personas.arch.json", import.meta.url), "utf8")) as {
  emailDomain: string;
  personas: { key: string; label: string }[];
};

test("페르소나 키·라벨·이메일 도메인이 시드 정본과 같다", () => {
  assert.deepEqual(
    MOCK_PERSONAS.map((p) => ({ key: p.key, label: p.label })),
    seed.personas.map((p) => ({ key: p.key, label: p.label })),
  );
  assert.equal(mockPersonaEmail("owner"), `owner@${seed.emailDomain}`);
  assert.equal(isMockPersonaKey("owner"), true);
  assert.equal(isMockPersonaKey("owner@dev.test"), false);
  assert.equal(isMockPersonaKey("__proto__"), false);
});

const CTX = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "a@b.c",
  display_name: "x",
  platform_role: "user",
  status: "active",
  org: { id: "22222222-2222-4222-8222-222222222222", name: "n", slug: "s", role: "owner" },
  app_id: "arch",
  plan_code: "trial",
  entitled: true,
  credit_balance: 30,
};

test("session_context 파서: 정상·이상 모양", () => {
  assert.equal(parseSessionContext(CTX)?.credit_balance, 30);
  assert.equal(parseSessionContext(null), null);
  assert.equal(parseSessionContext({ ...CTX, user_id: "x" }), null);
  assert.equal(parseSessionContext({ ...CTX, credit_balance: 1.5 }), null);
  assert.equal(parseSessionContext({ ...CTX, org: { ...CTX.org, role: "superuser" } }), null);
  assert.equal(parseSessionContext({ ...CTX, entitled: true, plan_code: null }), null);
  assert.equal(parseSessionContext({ ...CTX, org: null })?.org, null);
});

test("인증 로그 허용 목록: 이메일·토큰·임의 페르소나 문자열은 빠진다", () => {
  const out = sanitizeAuthLog({
    route: "dev_login",
    code: "eyJ.abc.def",
    persona: "owner@dev.test",
    provider: "evil",
    status: 401,
    first_login: true,
  });
  assert.deepEqual(out, { route: "dev_login", status: 401, first_login: true });
  assert.deepEqual(sanitizeAuthLog({ route: "auth_finish", persona: "owner", code: "42501", provider: "email" }), {
    route: "auth_finish",
    persona: "owner",
    code: "42501",
    provider: "email",
  });
});
