// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVATE_LIMIT, clientIp, hitActivateLimit, ipHash, MemoryRateLimitStore, UNKNOWN_IP } from "./rate-limit.ts";

const H = (v: Record<string, string>) => new Headers(v);
const VERCEL = { header: "x-forwarded-for", trustedHops: 1 };

test("고정 창: 10회 허용, 11번째 거부, 창이 지나면 초기화", () => {
  const store = new MemoryRateLimitStore();
  const t0 = 1_000_000;
  for (let i = 1; i <= 10; i++) assert.equal(store.hit("k", 10, 3600, t0 + i).allowed, true, `${i}`);
  const eleventh = store.hit("k", 10, 3600, t0 + 11);
  assert.equal(eleventh.allowed, false);
  assert.equal(eleventh.remaining, 0);
  assert.equal(eleventh.resetAtMs, t0 + 1 + 3600_000);
  assert.equal(store.hit("k", 10, 3600, t0 + 1 + 3600_000).allowed, true);
});

test("항목 상한을 넘으면 오래된 항목을 버린다(메모리 고갈 방지)", () => {
  const store = new MemoryRateLimitStore(3);
  for (const k of ["a", "b", "c", "d"]) store.hit(k, 1, 3600, 0);
  assert.equal(store.hit("a", 1, 3600, 1).allowed, true, "a는 축출되어 새 창");
  assert.equal(store.hit("d", 1, 3600, 1).allowed, false);
});

test("XFF: 오른쪽 신뢰 홉 값만 쓴다(왼쪽 위조 무시)", () => {
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), VERCEL), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.1" }), { header: "x-forwarded-for", trustedHops: 2 }), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "203.0.113.7" }), { header: "x-forwarded-for", trustedHops: 2 }), UNKNOWN_IP, "체인이 짧으면 unknown");
  assert.equal(clientIp(H({ "x-forwarded-for": "[2001:DB8::1]:443" }), VERCEL), "2001:db8::1");
  assert.equal(clientIp(H({ "x-forwarded-for": "203.0.113.7:5555" }), VERCEL), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "not-an-ip" }), VERCEL), UNKNOWN_IP);
  assert.equal(clientIp(H({ "x-forwarded-for": "999.1.1.1" }), VERCEL), UNKNOWN_IP);
  assert.equal(clientIp(H({}), VERCEL), UNKNOWN_IP);
});

test("홉 0·헤더 null이면 헤더를 믿지 않는다", () => {
  const h = H({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" });
  assert.equal(clientIp(h, { header: null, trustedHops: 1 }), UNKNOWN_IP);
  assert.equal(clientIp(h, { header: "x-forwarded-for", trustedHops: 0 }), UNKNOWN_IP);
});

test("IP 해시: 솔트별로 다르고 원문을 포함하지 않는다", () => {
  const a = ipHash("203.0.113.7", "salt-a");
  assert.notEqual(a, ipHash("203.0.113.7", "salt-b"));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test("activate 버킷: XFF 왼쪽 값을 바꿔도 같은 버킷, 사용자 버킷이 IP 회전을 막는다", async () => {
  const store = new MemoryRateLimitStore();
  const base = { store, ipSalt: "s", nowMs: 0 };
  for (let i = 0; i < ACTIVATE_LIMIT; i++) {
    const ip = clientIp(H({ "x-forwarded-for": `1.1.1.${i}, 203.0.113.7` }), VERCEL);
    assert.equal((await hitActivateLimit({ ...base, ip, userId: `u${i}` })).allowed, true);
  }
  assert.equal((await hitActivateLimit({ ...base, ip: "203.0.113.7", userId: "fresh" })).allowed, false, "IP 버킷 소진");

  const store2 = new MemoryRateLimitStore();
  for (let i = 0; i < ACTIVATE_LIMIT; i++) {
    assert.equal((await hitActivateLimit({ store: store2, ipSalt: "s", nowMs: 0, ip: `198.51.100.${i}`, userId: "u" })).allowed, true);
  }
  assert.equal((await hitActivateLimit({ store: store2, ipSalt: "s", nowMs: 0, ip: "198.51.100.200", userId: "u" })).allowed, false, "사용자 버킷 소진");
});
