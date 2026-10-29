import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger } from "./log.ts";
import { maskSecrets } from "./mask.ts";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";

test("maskSecrets: 알려진 값·JWT·Bearer·sb_ 키를 가린다", () => {
  const out = maskSecrets(`key=${JWT} auth=Bearer abc.def-123 k=sb_secret_XYZ123 w=my-worker-key-1234`, ["my-worker-key-1234"]);
  assert.equal(out, "key=*** auth=Bearer *** k=*** w=***");
});

test("maskSecrets: 짧은 값은 비밀 목록에서 무시(오탐 방지)", () => {
  assert.equal(maskSecrets("a b c", ["a"]), "a b c");
});

test("logger: 필드·오류 메시지 안의 비밀도 가린다", () => {
  const lines: string[] = [];
  const log = createLogger(["super-secret-value"], (l) => lines.push(l));
  log.error("fail", { err: new Error(`token ${JWT}`), extra: "super-secret-value" });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]?.includes(JWT));
  assert.ok(!lines[0]?.includes("super-secret-value"));
  assert.ok(lines[0]?.includes('"level":"error"'));
});

test("logger: 따옴표·역슬래시·개행이 든 비밀도 직렬화 전에 가린다", () => {
  const secret = 'ab"cd\ef\ngh-1234';
  const lines: string[] = [];
  const log = createLogger([secret], (l) => lines.push(l));
  log.error("fail", { raw: secret, nested: { list: [`x ${secret} y`] } });
  const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.ok(!JSON.stringify(parsed).includes("cd\\ef"));
  assert.ok(!(lines[0] ?? "").includes("ab\\\"cd"));
  assert.equal(parsed["raw"], "***");
  assert.deepEqual(parsed["nested"], { list: ["x *** y"] });
});

test("logger: 중첩 Error.cause의 message·stack까지 가린다", () => {
  const secret = 'q"uote\key-5678';
  const lines: string[] = [];
  const log = createLogger([secret], (l) => lines.push(l));
  const inner = new Error(`inner ${secret}`);
  log.error("fail", { err: new Error("outer", { cause: new Error(`mid ${JWT}`, { cause: inner }) }) });
  const err = (JSON.parse(lines[0] ?? "{}") as { err: { cause: { message: string; cause: { message: string; stack: string } } } }).err;
  assert.equal(err.cause.message, "mid ***");
  assert.equal(err.cause.cause.message, "inner ***");
  assert.ok(err.cause.cause.stack.startsWith("Error: inner ***"));
  assert.ok(!(lines[0] ?? "").includes("uote"));
});
