// 입력 검증(로그 A1·A7)·HMAC 해시(A4).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { HASH_KEY_MIN_CHARS, pnuHash, SiteHashKeyError } from "./hash.ts";
import { normalizeQueryValue, parseLookupBody, validateQuery } from "./schema.ts";

const KEY = "k".repeat(HASH_KEY_MIN_CHARS);
const PNU = "4113510900100120004";

test("입력: 종류별 정상 값은 정규화(NFC·공백)되어 통과", () => {
  assert.deepEqual(parseLookupBody({ query: { kind: "pnu", value: ` ${PNU} ` } }), { kind: "pnu", value: PNU });
  assert.deepEqual(parseLookupBody({ query: { kind: "jibun", value: "운중동   12-4" } }), { kind: "jibun", value: "운중동 12-4" });
  assert.deepEqual(parseLookupBody({ query: { kind: "address", value: "경기도 성남시 분당구 운중로 135" } }), {
    kind: "address",
    value: "경기도 성남시 분당구 운중로 135",
  });
  // 자모 분리(NFD) 입력도 NFC로 합친다
  assert.equal(normalizeQueryValue("운중동".normalize("NFD")), "운중동");
});

test("입력: URL·마크업 의미 문자, 제어문자, 길이 초과·미만은 거부", () => {
  const bad = [
    "운중동 12&key=abc",
    "운중동 12?x=1",
    "운중동#12",
    "운중동 12%26key",
    "../req/data",
    "http://evil.example/12",
    "운중동\u000012",
    "운중동\n12",
    "<script>1</script>",
    "운중동 12'",
    "a",
    "가".repeat(201),
  ];
  for (const value of bad) {
    assert.equal(parseLookupBody({ query: { kind: "address", value } }), null, value);
    assert.equal(parseLookupBody({ query: { kind: "jibun", value } }), null, value);
  }
  assert.equal(validateQuery("jibun", "운중동"), null, "지번에는 번지 숫자가 필요");
  assert.equal(validateQuery("pnu", "411351090010012000"), null, "18자리");
  assert.equal(validateQuery("pnu", "4113510900300120004"), null, "필지구분 3");
});

test("입력: strict — 모르는 필드(org_id 등)·종류·타입이 틀리면 거부", () => {
  assert.equal(parseLookupBody({ query: { kind: "pnu", value: PNU }, org_id: "x" }), null);
  assert.equal(parseLookupBody({ query: { kind: "pnu", value: PNU, org_id: "x" } }), null);
  assert.equal(parseLookupBody({ query: { kind: "url", value: PNU } }), null);
  assert.equal(parseLookupBody({ query: { kind: "pnu", value: 4113510900100120004 } }), null);
  assert.equal(parseLookupBody(null), null);
  assert.equal(parseLookupBody({ query: { kind: "address", value: "가".repeat(401) } }), null);
});

test("해시: HMAC-SHA-256 64자 hex, 키 의존, 단순 SHA-256과 다름, 같은 입력은 같은 값", () => {
  const h = pnuHash(PNU, KEY);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(pnuHash(PNU, KEY), h);
  assert.notEqual(pnuHash(PNU, `${KEY}x`), h);
  assert.notEqual(createHash("sha256").update(PNU).digest("hex"), h);
  assert.ok(!h.includes(PNU));
});

test("해시: 짧은 키·PNU 형식이 아닌 입력은 거부(키 값은 오류 메시지에 없다)", () => {
  assert.throws(() => pnuHash(PNU, "short-key"), (e: unknown) => e instanceof SiteHashKeyError && !String((e as Error).message).includes("short-key"));
  assert.throws(() => pnuHash("운중동 12-4", KEY), RangeError);
});
