import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuthConfig, isLoopbackUrl, isMockAuthAllowed } from "./config.ts";

const LOCAL = {
  AUTH_MODE: "mock",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  DEV_SEED_PASSWORD: "x",
};

test("로컬 + mock + 비밀번호면 허용", () => {
  assert.equal(isMockAuthAllowed(LOCAL), true);
  assert.equal(isMockAuthAllowed({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", APP_URL: "http://127.0.0.1:3123" }), true);
});

test("하나라도 어긋나면 거짓(기본 닫힘)", () => {
  const cases: Record<string, Record<string, string | undefined>> = {
    "AUTH_MODE 없음": { ...LOCAL, AUTH_MODE: undefined },
    "AUTH_MODE live": { ...LOCAL, AUTH_MODE: "live" },
    "AUTH_MODE 대문자": { ...LOCAL, AUTH_MODE: "MOCK" },
    "원격 Supabase": { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" },
    "loopback 흉내 호스트": { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1.nip.io:54321" },
    "localhost 접미 도메인": { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "http://localhost.evil.com" },
    "URL 파싱 실패": { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "not a url" },
    "URL 없음": { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: undefined },
    "SUPABASE_URL 원격": { ...LOCAL, SUPABASE_URL: "https://abc.supabase.co" },
    "APP_URL 원격": { ...LOCAL, APP_URL: "https://arch.example.com" },
    Vercel: { ...LOCAL, VERCEL: "1" },
    "Vercel preview": { ...LOCAL, VERCEL_ENV: "preview" },
    "Vercel production": { ...LOCAL, VERCEL_ENV: "production" },
    Railway: { ...LOCAL, RAILWAY_ENVIRONMENT: "production" },
    "Railway project": { ...LOCAL, RAILWAY_PROJECT_ID: "p" },
    "비밀번호 없음": { ...LOCAL, DEV_SEED_PASSWORD: undefined },
    "비밀번호 빈 값": { ...LOCAL, DEV_SEED_PASSWORD: "" },
  };
  for (const [name, env] of Object.entries(cases)) assert.equal(isMockAuthAllowed(env), false, name);
});

test("빌드에 박힌 Supabase URL이 원격이면 실행 env가 로컬이어도 거짓", () => {
  assert.equal(isMockAuthAllowed(LOCAL, "https://abc.supabase.co"), false);
  assert.equal(isMockAuthAllowed(LOCAL, "http://127.0.0.1:54321"), true);
});

test("isLoopbackUrl은 호스트를 정확히 비교한다", () => {
  assert.equal(isLoopbackUrl("http://[::1]:54321"), true);
  assert.equal(isLoopbackUrl("http://user@127.0.0.1@evil.com"), false);
});

test("getAuthConfig: mock인데 원격이면 조용히 live로 바꾸지 않고 throw", () => {
  assert.deepEqual(getAuthConfig(LOCAL), { mode: "mock", providers: ["email"] });
  assert.throws(() => getAuthConfig({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }), /mock/);
  assert.throws(() => getAuthConfig({ ...LOCAL, VERCEL_ENV: "production" }), /mock/);
});

test("getAuthConfig: 기본 live, 제공자 목록 검사", () => {
  assert.deepEqual(getAuthConfig({ AUTH_PROVIDERS: "google, email,google" }), { mode: "live", providers: ["google", "email"] });
  assert.throws(() => getAuthConfig({}), /AUTH_PROVIDERS/);
  assert.throws(() => getAuthConfig({ AUTH_PROVIDERS: "google,facebook" }), /알 수 없는/);
  assert.throws(() => getAuthConfig({ AUTH_MODE: "dev" }), /AUTH_MODE/);
});
