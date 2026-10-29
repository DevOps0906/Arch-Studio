// 실행: pnpm --filter ./apps/web test (Node 내장 테스트 러너, TS 타입 제거 실행)
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv, serverEnvSchema } from "./schema.ts";

const complete: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  NEXT_PUBLIC_TOSS_CLIENT_KEY: "toss-client",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_DB_SCHEMA: "public",
  APP_URL: "http://localhost:3000",
  TOSS_SECRET_KEY: "x",
  TOSS_WEBHOOK_SECRET: "x",
  LICENSE_SIGNING_PRIVATE_KEY: "x",
  LICENSE_SIGNING_KID: "k1",
  SITE_LOOKUP_HASH_KEY: "site-lookup-hash-key-for-tests-0123456789",
  AI_TOKEN_PRIVATE_KEY: "x",
  AI_TOKEN_KID: "k1",
  ARCH_WORKER_INTERNAL_KEY: "x",
  OSS_VOICE_BASE_URL: "http://localhost:9000",
  AI_CROSS_BORDER_NOTICE_VERSION: "1",
  VOICE_NOTICE_VERSION: "1",
  ARCH_RECORDING_NOTICE_VERSION: "1",
  RATE_LIMIT_IP_SALT: "x",
  AUTH_PROVIDERS: "google,email",
};

test("필수 변수가 모두 있으면 통과하고 기본값을 채운다", () => {
  const env = parseEnv(serverEnvSchema, complete);
  assert.equal(env.AUTH_MODE, "live");
  assert.deepEqual(env.AUTH_PROVIDERS, ["google", "email"]);
  assert.equal(env.NEXT_PUBLIC_HERO3D_ENABLED, true);
});

test("기동 실패 변수가 없으면 변수 이름만 담아 throw한다", () => {
  const missing = { ...complete };
  delete missing.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => parseEnv(serverEnvSchema, missing), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("빈 문자열도 누락으로 본다", () => {
  assert.throws(() => parseEnv(serverEnvSchema, { ...complete, RATE_LIMIT_IP_SALT: " " }), /RATE_LIMIT_IP_SALT/);
});

test("live 모드에서 AUTH_PROVIDERS가 0개면 실패", () => {
  assert.throws(() => parseEnv(serverEnvSchema, { ...complete, AUTH_PROVIDERS: "" }), /AUTH_PROVIDERS/);
});

test("mock 모드에서 DEV_SEED_PASSWORD가 없으면 실패", () => {
  assert.throws(() => parseEnv(serverEnvSchema, { ...complete, AUTH_MODE: "mock" }), /DEV_SEED_PASSWORD/);
});

test("SITE_LOOKUP_HASH_KEY는 32자 미만이면 기동 실패(변수 이름만)", () => {
  assert.throws(() => parseEnv(serverEnvSchema, { ...complete, SITE_LOOKUP_HASH_KEY: "x".repeat(31) }), /SITE_LOOKUP_HASH_KEY/);
  assert.doesNotThrow(() => parseEnv(serverEnvSchema, { ...complete, SITE_LOOKUP_HASH_KEY: "x".repeat(32) }));
});
