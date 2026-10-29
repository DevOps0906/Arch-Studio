import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, secretsOf } from "./config.ts";

const ENV = {
  SUPABASE_URL: "http://127.0.0.1:55321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-value",
  ARCH_WEB_URL: "http://localhost:3000",
  ARCH_WORKER_INTERNAL_KEY: "worker-key-value",
};

test("config: 필수 env 누락은 이름만 알리고 값은 넣지 않는다", () => {
  assert.throws(() => loadConfig({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" }, "w"), /missing env: SUPABASE_SERVICE_ROLE_KEY$/);
});

test("config: 기본값과 마스킹 대상", () => {
  const c = loadConfig(ENV, "host-1");
  assert.equal(c.workerId, "host-1");
  assert.equal(c.concurrency, 4);
  assert.deepEqual(secretsOf(c), ["service-role-value", "worker-key-value"]);
  assert.throws(() => loadConfig({ ...ENV, WORKER_CONCURRENCY: "0" }, "w"), /positive integer/);
});
