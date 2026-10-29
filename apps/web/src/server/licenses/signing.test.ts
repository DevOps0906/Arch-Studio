// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { test } from "node:test";
import { canonicalJson } from "./canonical.ts";
import { buildLicensePayload, type OrgFeaturesView } from "./payload.ts";
import { createLicenseSigner, LICENSE_SIGNING_CONTEXT, LicenseSignerError, verifyLicenseFile } from "./signing.ts";
import { newEd25519Pem } from "./test-helpers.ts";

const FEATURES: OrgFeaturesView = {
  state: "licensed",
  plan_code: null,
  trial_ends_at: null,
  updates_until: "2027-10-29",
  drafting_watermark: false,
  rule_pack_updates: true,
  cloud_review: true,
  ai_render: true,
};

function payload(kid: string) {
  return buildLicensePayload({
    source: "license",
    licenseId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    sku: "perpetual_early",
    updatesUntil: "2027-10-29",
    activationId: "33333333-3333-4333-8333-333333333333",
    deviceHash: "a".repeat(64),
    kid,
    nowMs: Date.UTC(2026, 9, 29, 1, 2, 3, 456),
    features: FEATURES,
  });
}

function signer(kid = "lic-2026-10") {
  const key = newEd25519Pem();
  const ai = newEd25519Pem();
  return { key, signer: createLicenseSigner({ privateKey: key.pem, kid, aiTokenPrivateKey: ai.pem, aiTokenKid: "ai-2026-10" }) };
}

const reencode = (obj: unknown) => Buffer.from(canonicalJson(obj), "utf8").toString("base64url");

test("라운드트립: 공개키로 검증, payload는 정준 JSON 바이트", () => {
  const { signer: s } = signer();
  const file = s.signPayload(payload(s.kid));
  assert.equal(file.kid, s.kid);
  const res = verifyLicenseFile(file, { [s.kid]: s.publicKeyDer });
  assert.equal(res.ok, true);
  assert.equal(Buffer.from(file.payload, "base64url").toString("utf8"), canonicalJson(payload(s.kid)));
  if (res.ok) assert.equal(res.payload.issued_at, "2026-10-29T01:02:03Z");
});

test("같은 입력 → 같은 바이트(Ed25519는 결정적 서명)", () => {
  const { signer: s } = signer();
  assert.deepEqual(s.signPayload(payload(s.kid)), s.signPayload(payload(s.kid)));
});

test("필드 하나 변조·kid 변조·sig 비트 변조·다른 키는 실패", () => {
  const { signer: s } = signer();
  const file = s.signPayload(payload(s.kid));
  const keys = { [s.kid]: s.publicKeyDer };
  const decoded = JSON.parse(Buffer.from(file.payload, "base64url").toString("utf8")) as Record<string, unknown>;
  for (const [field, value] of [
    ["offline_valid_until", "2099-01-01T00:00:00Z"],
    ["updates_until", "2099-12-31"],
    ["device_hash", "b".repeat(64)],
    ["features", { ...(decoded.features as object), drafting_watermark: false, cloud_review: true, ai_render: true, rule_pack_updates: false }],
    ["org_id", "44444444-4444-4444-8444-444444444444"],
  ] as const) {
    const tampered = { ...file, payload: reencode({ ...decoded, [field]: value }) };
    assert.deepEqual(verifyLicenseFile(tampered, keys), { ok: false, reason: "invalid_signature" }, field);
  }
  // 정준화만 다른 같은 내용(공백·키 순서)도 서명 바이트가 달라 실패 → 검증자는 재직렬화하지 않는다
  const pretty = Buffer.from(JSON.stringify(decoded, null, 1), "utf8").toString("base64url");
  assert.equal(verifyLicenseFile({ ...file, payload: pretty }, keys).ok, false);

  const sig = Buffer.from(file.sig, "base64url");
  sig[0] = (sig[0] as number) ^ 1;
  assert.equal(verifyLicenseFile({ ...file, sig: sig.toString("base64url") }, keys).ok, false);
  assert.deepEqual(verifyLicenseFile({ ...file, kid: "other" }, keys), { ok: false, reason: "unknown_kid" });
  const other = signer("lic-2026-10");
  assert.equal(verifyLicenseFile(file, { [s.kid]: other.signer.publicKeyDer }).ok, false);
  // 바깥 kid만 바꾸고 그 kid에 같은 공개키를 등록해도 payload.kid 불일치로 실패
  assert.deepEqual(verifyLicenseFile({ ...file, kid: "alias" }, { alias: s.publicKeyDer }), { ok: false, reason: "kid_mismatch" });
  assert.deepEqual(verifyLicenseFile(null, keys), { ok: false, reason: "malformed" });
  assert.deepEqual(verifyLicenseFile({ ...file, payload: "@@" }, keys), { ok: false, reason: "malformed" });
});

test("base64 DER 형식 키, PEM의 \\n 이스케이프도 받는다", () => {
  const key = newEd25519Pem();
  const a = createLicenseSigner({ privateKey: key.der64, kid: "k1", aiTokenPrivateKey: undefined, aiTokenKid: undefined });
  const b = createLicenseSigner({ privateKey: key.pem.replace(/\n/g, "\\n"), kid: "k1", aiTokenPrivateKey: undefined, aiTokenKid: undefined });
  assert.ok(a.publicKeyDer.equals(b.publicKeyDer));
});

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof LicenseSignerError);
    return error.reason;
  }
  return "no-error";
}

test("키 없음·깨짐·비 Ed25519·AI 토큰 키와 같은 키/kid는 거부, 오류 메시지에 키 값 없음", () => {
  const key = newEd25519Pem();
  const base = { privateKey: key.pem, kid: "lic-1", aiTokenPrivateKey: undefined as string | undefined, aiTokenKid: undefined as string | undefined };
  assert.equal(reason(() => createLicenseSigner({ ...base, privateKey: undefined })), "missing");
  assert.equal(reason(() => createLicenseSigner({ ...base, kid: " " })), "missing");
  assert.equal(reason(() => createLicenseSigner({ ...base, kid: "bad kid!" })), "invalid_kid");
  assert.equal(reason(() => createLicenseSigner({ ...base, privateKey: "not-a-key" })), "invalid_key");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  assert.equal(reason(() => createLicenseSigner({ ...base, privateKey: rsa })), "not_ed25519");
  assert.equal(reason(() => createLicenseSigner({ ...base, aiTokenPrivateKey: key.pem })), "same_as_ai_token_key");
  // 형식만 다른 같은 키(PEM vs base64 DER)도 잡는다
  assert.equal(reason(() => createLicenseSigner({ ...base, aiTokenPrivateKey: key.der64 })), "same_as_ai_token_key");
  assert.equal(reason(() => createLicenseSigner({ ...base, aiTokenKid: "lic-1" })), "same_kid_as_ai_token");

  const broken = key.pem.slice(0, 60) + "AAAA" + key.pem.slice(64);
  try {
    createLicenseSigner({ ...base, privateKey: broken });
    assert.fail("거부되어야 함");
  } catch (error) {
    const text = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
    assert.ok(!text.includes(key.pem.slice(30, 60)), "키 조각이 메시지에 없음");
  }
});

test("회귀 🟡 도메인 분리: 서명 입력 = LICENSE_SIGNING_CONTEXT + payload 바이트, 접두 없이 서명한 바이트는 거부", () => {
  assert.equal(LICENSE_SIGNING_CONTEXT, "arch-license-v1\n");
  const key = newEd25519Pem();
  const s = createLicenseSigner({ privateKey: key.pem, kid: "lic-ctx", aiTokenPrivateKey: undefined, aiTokenKid: undefined });
  const file = s.signPayload(payload(s.kid));
  const keys = { [s.kid]: s.publicKeyDer };
  const pub = createPublicKey({ key: s.publicKeyDer, format: "der", type: "spki" });
  const bytes = Buffer.from(file.payload, "base64url");
  const sig = Buffer.from(file.sig, "base64url");
  assert.equal(verify(null, Buffer.concat([Buffer.from(LICENSE_SIGNING_CONTEXT, "utf8"), bytes]), pub, sig), true, "접두 + 바이트에 대한 서명");
  assert.equal(verify(null, bytes, pub, sig), false, "payload 바이트만으로는 검증되지 않는다");
  assert.equal(bytes.toString("utf8"), canonicalJson(payload(s.kid)), "payload 필드에는 접두가 없다");

  // 같은 키로 다른 용도(예: 규칙 팩 매니페스트)에서 접두 없이·다른 접두로 서명한 바이트를 라이선스 파일로 재사용할 수 없다
  const raw = sign(null, bytes, createPrivateKey(key.pem));
  assert.deepEqual(verifyLicenseFile({ ...file, sig: raw.toString("base64url") }, keys), { ok: false, reason: "invalid_signature" });
  const other = sign(null, Buffer.concat([Buffer.from("arch-rulepack-v1\n", "utf8"), bytes]), createPrivateKey(key.pem));
  assert.deepEqual(verifyLicenseFile({ ...file, sig: other.toString("base64url") }, keys), { ok: false, reason: "invalid_signature" });
});

test("payload kid가 서명기 kid와 다르면 서명하지 않는다", () => {
  const { signer: s } = signer();
  assert.throws(() => s.signPayload(payload("other")));
});
