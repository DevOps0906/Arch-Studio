// AI 토큰 서명기: 라운드트립·변조·도메인 분리·키 혼용 거부·클레임 경계(tasks/logs/AR-06-047.md P1·P2·P5·P13·P14).
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { test } from "node:test";
import { createLicenseSigner, verifyLicenseFile } from "../../licenses/signing.ts";
import { newEd25519Pem } from "../../licenses/test-helpers.ts";
import {
  AI_TOKEN_CONTEXT,
  AiSignerError,
  AiTokenClaimError,
  createAiTokenSigner,
  JOB_TOKEN_TTL_S,
  MAX_TOKEN_LIFETIME_S,
  verifyAiToken,
  type JobScope,
  type UserScope,
} from "./signer.ts";

const AI = newEd25519Pem();
const LIC = newEd25519Pem();
const NOW = 1_800_000_000;
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const signer = createAiTokenSigner({ privateKey: AI.pem, kid: "ai-1", licensePrivateKey: LIC.pem, licenseKid: "lic-1" });
const keys = { "ai-1": createPublicKey(AI.pem).export({ format: "der", type: "spki" }) };

function decode(token: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const [h, p] = token.split(".") as [string, string];
  return { header: JSON.parse(Buffer.from(h, "base64url").toString()), claims: JSON.parse(Buffer.from(p, "base64url").toString()) };
}

const jobInput = { jobId: JOB, runId: RUN, orgId: ORG, scope: "graph:arch.review" as JobScope, feat: "arch.review" as const, nowS: NOW };

test("잡 토큰: 라운드트립, 클레임 = iss/aud/app/sub/org/scope/feat/run/job/jti/iat/exp", () => {
  const t = signer.issueJobToken(jobInput);
  const v = verifyAiToken(t.token, keys, NOW + 1);
  assert.ok(v.ok);
  assert.deepEqual(v.header, { alg: "EdDSA", typ: "JWT", kid: "ai-1", ctx: AI_TOKEN_CONTEXT });
  const c = v.claims;
  assert.deepEqual(Object.keys(c).sort(), ["app", "aud", "exp", "feat", "iat", "iss", "job", "jti", "org", "run", "scope", "sub"]);
  assert.equal(c.sub, `job:${JOB}`);
  assert.equal(c.job, JOB);
  assert.equal(c.run, RUN);
  assert.equal(c.org, ORG);
  assert.equal(c.iss, "arch");
  assert.equal(c.aud, "platform-ai:arch");
  assert.equal(c.app, "arch");
  assert.equal(c.exp, NOW + JOB_TOKEN_TTL_S);
  assert.ok((c.exp as number) - (c.iat as number) <= MAX_TOKEN_LIFETIME_S);
});

test("jti는 매번 다르고 128비트", () => {
  const a = signer.issueJobToken(jobInput);
  const b = signer.issueJobToken(jobInput);
  assert.notEqual(a.jti, b.jti);
  assert.equal(Buffer.from(a.jti, "base64url").length, 16);
});

test("변조: payload·header·서명 바꾸면 검증 실패", () => {
  const { token } = signer.issueJobToken(jobInput);
  const [h, p, s] = token.split(".") as [string, string, string];
  const evil = Buffer.from(JSON.stringify({ ...decode(token).claims, org: USER })).toString("base64url");
  assert.deepEqual(verifyAiToken(`${h}.${evil}.${s}`, keys, NOW), { ok: false, reason: "signature" });
  const evilHeader = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "ai-1", ctx: AI_TOKEN_CONTEXT, x: 1 })).toString("base64url");
  assert.deepEqual(verifyAiToken(`${evilHeader}.${p}.${s}`, keys, NOW), { ok: false, reason: "signature" });
  const flipped = Buffer.from(s, "base64url");
  flipped[0] = (flipped[0] as number) ^ 1;
  assert.deepEqual(verifyAiToken(`${h}.${p}.${flipped.toString("base64url")}`, keys, NOW), { ok: false, reason: "signature" });
  assert.deepEqual(verifyAiToken(token, keys, NOW + JOB_TOKEN_TTL_S), { ok: false, reason: "expired" });
});

test("다른 키(같은 kid)로 서명한 토큰은 검증 실패", () => {
  const forger = createAiTokenSigner({ privateKey: newEd25519Pem().pem, kid: "ai-1", licensePrivateKey: undefined, licenseKid: undefined });
  assert.deepEqual(verifyAiToken(forger.issueJobToken(jobInput).token, keys, NOW), { ok: false, reason: "signature" });
});

test("도메인 분리: 라이선스 서명기 출력은 AI 토큰이 아니고, AI 토큰 서명은 라이선스 파일로 통하지 않는다", () => {
  const lic = createLicenseSigner({ privateKey: LIC.pem, kid: "lic-1", aiTokenPrivateKey: AI.pem, aiTokenKid: "ai-1" });
  const file = lic.signPayload({ kid: "lic-1" });
  // 라이선스 서명을 JWS 모양으로 붙여도 ctx 헤더가 없고 키가 달라 실패
  const fake = `${Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "ai-1", ctx: AI_TOKEN_CONTEXT })).toString("base64url")}.${file.payload}.${file.sig}`;
  assert.equal(verifyAiToken(fake, keys, NOW).ok, false);
  // AI 토큰 서명 바이트를 라이선스 파일 형식에 넣어도 실패(접두 "arch-license-v1\n" 불일치)
  const { token } = signer.issueJobToken(jobInput);
  const [, p, s] = token.split(".") as [string, string, string];
  const aiSpki = keys["ai-1"];
  assert.equal(verifyLicenseFile({ payload: p, sig: s, kid: "ai-1" }, { "ai-1": aiSpki }).ok, false);
});

test("ctx 헤더가 다르거나 없으면 참조 검증기는 거부", () => {
  const { token } = signer.issueJobToken(jobInput);
  const [, p, s] = token.split(".") as [string, string, string];
  const noCtx = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "ai-1" })).toString("base64url");
  assert.deepEqual(verifyAiToken(`${noCtx}.${p}.${s}`, keys, NOW), { ok: false, reason: "header" });
});

test("키 혼용 거부: 라이선스 키와 같은 키(PEM·DER 표기 달라도)·같은 kid", () => {
  const cases: [Parameters<typeof createAiTokenSigner>[0], string][] = [
    [{ privateKey: LIC.pem, kid: "ai-x", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "same_as_license_key"],
    [{ privateKey: LIC.der64, kid: "ai-x", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "same_as_license_key"],
    [{ privateKey: AI.pem, kid: "lic-1", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "same_kid_as_license"],
    [{ privateKey: undefined, kid: "ai-x", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "missing"],
    [{ privateKey: "not a key", kid: "ai-x", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "invalid_key"],
    [{ privateKey: AI.pem, kid: "bad kid!", licensePrivateKey: LIC.pem, licenseKid: "lic-1" }, "invalid_kid"],
  ];
  for (const [input, reason] of cases) {
    assert.throws(() => createAiTokenSigner(input), (e: unknown) => {
      assert.ok(e instanceof AiSignerError);
      assert.equal(e.reason, reason);
      assert.ok(!e.message.includes("BEGIN") && !e.message.includes(LIC.der64.slice(10, 30)));
      return true;
    });
  }
});

test("사용자 토큰은 graph scope·job sub·run/job 클레임을 가질 수 없다(P1·P2)", () => {
  const base = { userId: USER, orgId: ORG, scope: "chat" as UserScope, nowS: NOW };
  const ok = decode(signer.issueUserToken(base).token).claims;
  assert.equal(ok.sub, USER);
  assert.equal("run" in ok || "job" in ok, false);
  assert.throws(() => signer.issueUserToken({ ...base, scope: "graph:arch.review" as UserScope }), AiTokenClaimError);
  assert.throws(() => signer.issueUserToken({ ...base, userId: `job:${JOB}` }), AiTokenClaimError);
  assert.throws(() => signer.issueUserToken({ ...base, userId: "not-uuid" }), AiTokenClaimError);
});

test("잡 토큰 입력 검증: 허용 밖 scope·feat, UUID 아닌 id, 대문자 UUID 거부", () => {
  const bad: Partial<typeof jobInput>[] = [
    { scope: "graph:arch.layout" as JobScope },
    { scope: "chat" as JobScope },
    { feat: "arch.unknown" as "arch.review" },
    { jobId: "x" },
    { runId: RUN.toUpperCase() },
    { orgId: "../" },
    { nowS: 0 },
  ];
  for (const b of bad) assert.throws(() => signer.issueJobToken({ ...jobInput, ...b }), AiTokenClaimError, JSON.stringify(b));
});

test("publicJwk: OKP/Ed25519, 개인키 성분 d 없음", () => {
  const jwk = signer.publicJwk() as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(jwk).sort(), ["alg", "crv", "kid", "kty", "use", "x"]);
  assert.equal(jwk.kid, "ai-1");
});
