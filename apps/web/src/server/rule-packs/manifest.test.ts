// 실행: pnpm --filter ./apps/web test. 키는 테스트 안에서 생성(저장소에 키 0, 계획 공격 P3).
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { newEd25519Pem } from "../licenses/test-helpers.ts";
import {
  checkSignedManifest,
  compareVersions,
  manifestStoragePath,
  packStoragePath,
  RULEPACK_SIGNING_CONTEXT,
  sha256Hex,
  signRulePackManifest,
  type RulePackRowFacts,
} from "./manifest.ts";

const PACK = Buffer.from('{"version":"2026.10.0","rules":[]}', "utf8");

function signed(kid = "pack-a") {
  const key = newEd25519Pem();
  const text = signRulePackManifest({ privateKeyPem: key.pem, kid, version: "2026.10.0", publishedAt: "2026-10-20T00:00:00Z", basisDate: "2026-10-14", pack: PACK });
  return { key, text, outer: JSON.parse(text) as { manifest: string; sig: string; kid: string } };
}

function rowOf(outer: { sig: string; kid: string }): RulePackRowFacts {
  return {
    version: "2026.10.0",
    sha256: sha256Hex(PACK),
    bytes: PACK.byteLength,
    kid: outer.kid,
    signature: outer.sig,
    published_at: "2026-10-20T00:00:00+00:00",
    basis_date: "2026-10-14",
  };
}

test("서명: 접두 ‖ manifest 바이트 그대로, Ed25519 공개키로 검증된다(Rust verify_rule_pack 규약)", () => {
  const { key, outer } = signed();
  const pub = createPublicKey(key.pem);
  const body = Buffer.from(outer.manifest, "base64url");
  assert.equal(RULEPACK_SIGNING_CONTEXT, "arch-rulepack-v1\n");
  assert.ok(verify(null, Buffer.concat([Buffer.from(RULEPACK_SIGNING_CONTEXT), body]), pub, Buffer.from(outer.sig, "base64url")));
  // 접두 없이는 검증되지 않는다(도메인 분리).
  assert.equal(verify(null, body, pub, Buffer.from(outer.sig, "base64url")), false);
  assert.equal(verify(null, Buffer.concat([Buffer.from("arch-license-v1\n"), body]), pub, Buffer.from(outer.sig, "base64url")), false);
  const m = JSON.parse(body.toString("utf8"));
  assert.deepEqual(Object.keys(m), ["app_id", "basis_date", "bytes", "kid", "published_at", "sha256", "v", "version"]);
  assert.equal(m.sha256, sha256Hex(PACK));
  assert.equal(m.bytes, PACK.byteLength);
});

test("서명 도구는 형식이 틀린 입력·Ed25519 아닌 키를 거부한다", () => {
  const key = newEd25519Pem();
  const base = { privateKeyPem: key.pem, kid: "pack-a", version: "2026.10.0", publishedAt: "2026-10-20T00:00:00Z", basisDate: "2026-10-14", pack: PACK };
  for (const bad of [{ version: "../x" }, { version: "2026.1.0" }, { kid: "a.b" }, { publishedAt: "2026-10-20" }, { pack: new Uint8Array(0) }]) {
    assert.throws(() => signRulePackManifest({ ...base, ...bad }));
  }
});

test("저장된 매니페스트를 DB 행과 대조한다: 하나라도 다르면 거부(실패 닫힘)", () => {
  const { text, outer } = signed();
  const row = rowOf(outer);
  const r = checkSignedManifest(text, row);
  assert.ok(r.ok);
  assert.equal(r.ok && r.text, text, "문자열을 그대로 내준다(재직렬화 없음)");
  for (const [field, value] of [
    ["signature", outer.sig.replace(/^./, outer.sig[0] === "A" ? "B" : "A")],
    ["kid", "pack-b"],
    ["sha256", "0".repeat(64)],
    ["bytes", PACK.byteLength + 1],
    ["version", "2026.10.1"],
  ] as const) {
    assert.equal(checkSignedManifest(text, { ...row, [field]: value }).ok, false, field);
  }
  assert.equal(checkSignedManifest("{", row).ok, false);
  assert.equal(checkSignedManifest(JSON.stringify({ ...outer, extra: 1 }), row).ok, false, "모르는 바깥 키");
  assert.equal(checkSignedManifest("x".repeat(9000), row).ok, false, "크기 상한");
});

test("게시 시각·기준일이 DB 행과 다르면 거부한다(같은 시각의 다른 표기는 통과)", () => {
  const { text, outer } = signed();
  const row = rowOf(outer);
  // 같은 시각, 다른 표기(서명은 Z, DB는 +00:00·+09:00·소수 초·PostgREST 공백 표기).
  for (const same of ["2026-10-20T00:00:00Z", "2026-10-20T09:00:00+09:00", "2026-10-20T00:00:00.000+00:00", "2026-10-20 00:00:00+00"]) {
    assert.ok(checkSignedManifest(text, { ...row, published_at: same }).ok, same);
  }
  const reasons = (over: Partial<RulePackRowFacts>) => {
    const r = checkSignedManifest(text, { ...row, ...over });
    return r.ok ? "ok" : r.reason;
  };
  for (const other of ["2026-10-20T00:00:01Z", "2026-10-19T00:00:00Z", "2026-10-20T00:00:00+09:00", "2026-10-20", "", "not-a-date", "2026-13-40T00:00:00Z"]) {
    assert.equal(reasons({ published_at: other }), "published_at_mismatch", other);
  }
  for (const other of ["2026-10-15", "2026-10-14T00:00:00Z", " 2026-10-14", ""]) {
    assert.equal(reasons({ basis_date: other }), "basis_date_mismatch", other);
  }
  // manifest 쪽 published_at이 해석 불가면(형식만 맞음) 거부.
  const key = newEd25519Pem();
  const bad = signRulePackManifest({ privateKeyPem: key.pem, kid: "pack-a", version: "2026.10.0", publishedAt: "2026-02-31T00:00:00Z", basisDate: "2026-10-14", pack: PACK });
  const badOuter = JSON.parse(bad) as { sig: string; kid: string };
  assert.equal(checkSignedManifest(bad, { ...rowOf(badOuter), published_at: "2026-03-03T00:00:00Z" }).ok, false);
});

test("버전 정준형: 월 01~12, n은 0 또는 앞자리 0 없는 1~3자리", () => {
  for (const ok of ["2026.01.0", "2026.12.999", "2026.10.1", "2026.10.10"]) assert.doesNotThrow(() => packStoragePath(ok), ok);
  for (const bad of ["2026.00.0", "2026.13.0", "2026.10.00", "2026.10.01", "2026.10.0001", "2026.10.1000", "2026.1.0"]) {
    assert.throws(() => packStoragePath(bad), bad);
  }
});

test("041 교차 벡터(Node 서명)의 매니페스트 형식을 그대로 받는다", () => {
  const v = JSON.parse(readFileSync(new URL("../../../../desktop/src-tauri/tests/fixtures/license/vectors.json", import.meta.url), "utf8"));
  const valid = v.rulepack.valid as { manifest: string; sig: string; kid: string };
  const m = JSON.parse(Buffer.from(valid.manifest, "base64url").toString("utf8"));
  // 벡터 kid(test-pack-r)는 DB kid 형식에도 맞는다.
  const r = checkSignedManifest(JSON.stringify(valid), {
    version: m.version,
    sha256: m.sha256,
    bytes: m.bytes,
    kid: valid.kid,
    signature: valid.sig,
    published_at: m.published_at,
    basis_date: m.basis_date,
  });
  assert.ok(r.ok);
  const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(v.rulepack_keys[valid.kid], "hex")]), format: "der", type: "spki" });
  assert.ok(verify(null, Buffer.concat([Buffer.from(RULEPACK_SIGNING_CONTEXT), Buffer.from(valid.manifest, "base64url")]), pub, Buffer.from(valid.sig, "base64url")));
});

test("저장소 경로는 버전 형식만 받는다(경로 조작 P7)", () => {
  assert.equal(packStoragePath("2026.10.0"), "rule-packs/2026.10.0/pack.json");
  assert.equal(manifestStoragePath("2026.10.0"), "rule-packs/2026.10.0/manifest.json");
  for (const bad of ["../2026.10.0", "2026.10.0/..", "2026.10", "2026.10.0 ", "２026.10.0"]) {
    assert.throws(() => packStoragePath(bad), bad);
  }
  assert.equal(compareVersions("2026.10.10", "2026.10.9"), 1);
  assert.equal(compareVersions("2026.09.0", "2026.10.0"), -1);
});
