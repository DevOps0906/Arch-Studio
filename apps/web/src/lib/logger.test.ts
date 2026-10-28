// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { logger, redact } from "./logger.ts";

test("중첩 객체·배열의 비밀 키를 대소문자 무시로 가린다", () => {
  const out = redact({
    user: "u1",
    API_KEY: "a",
    nested: { Authorization: "b", list: [{ refreshToken: "c", ok: 1 }], deep: { Password: "d" } },
  });
  assert.deepEqual(out, {
    user: "u1",
    API_KEY: "[REDACTED]",
    nested: { Authorization: "[REDACTED]", list: [{ refreshToken: "[REDACTED]", ok: 1 }], deep: { Password: "[REDACTED]" } },
  });
});

test("순환 참조에서 멈추지 않는다", () => {
  const loop: Record<string, unknown> = { a: 1 };
  loop.self = loop;
  assert.deepEqual(redact(loop), { a: 1, self: "[Circular]" });
});

test("로그 한 줄에 비밀 값이 남지 않는다", (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  logger.info("요청", { req: { headers: { Cookie: "s=1" } }, secretValue: "zzz" });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes("s=1") && !lines[0]!.includes("zzz"));
});
