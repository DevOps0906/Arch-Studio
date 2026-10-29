// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { normalizeSerial, serialHash, serialLast5 } from "./serial.ts";

const BODY = "0123456789ABCDEFGHJK";

test("정규화: 대소문자·하이픈·공백 무시, I·L → 1, O → 0", () => {
  assert.equal(normalizeSerial("ARCH-01234-56789-ABCDE-FGHJK"), BODY);
  assert.equal(normalizeSerial(" arch 01234-56789-abcde-fghjk "), BODY);
  assert.equal(normalizeSerial("ARCH-O1234-56789-ABCDE-FGHJK"), BODY);
  assert.equal(normalizeSerial("ARCH-0I234-56789-ABCDE-FGHJK"), BODY);
  assert.equal(normalizeSerial("ARCH-0L234-56789-ABCDE-FGHJK"), BODY);
});

test("형식 오류는 null", () => {
  for (const bad of ["", "ARCH", "ARCH-01234-56789-ABCDE-FGHJ", "ARCH-01234-56789-ABCDE-FGHJKX", "XXXX-01234-56789-ABCDE-FGHJK", "ARCH-01234-56789-ABCDE-FGHJU", "01234-56789-ABCDE-FGHJK"]) {
    assert.equal(normalizeSerial(bad), null, bad);
  }
});

test("해시는 20자 본문의 SHA-256(DB issue_license와 같은 값), 끝 5자", () => {
  assert.equal(serialHash(BODY), createHash("sha256").update(BODY).digest("hex"));
  assert.match(serialHash(BODY), /^[0-9a-f]{64}$/);
  assert.equal(serialLast5(BODY), "FGHJK");
});
