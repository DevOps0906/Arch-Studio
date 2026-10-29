// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVATE_LIMIT, clientIp, hitActivateLimit, ipHash, MemoryRateLimitStore, normalizeIp, proxyConfigFromHops } from "./rate-limit.ts";

const H = (v: Record<string, string>) => new Headers(v);
const ONE_HOP = { header: "x-forwarded-for", trustedHops: 1 };

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

test("축출: 만료 항목을 앞에서부터 버린다(살아 있는 항목은 유지)", () => {
  const store = new MemoryRateLimitStore(3);
  store.hit("old", 1, 10, 0); // 10초 뒤 만료
  store.hit("b", 1, 3600, 5_000);
  store.hit("c", 1, 3600, 6_000);
  store.hit("d", 1, 3600, 20_000); // 상한 도달 → 만료된 old만 버린다
  assert.equal(store.hit("b", 1, 3600, 21_000).allowed, false, "b는 남아 있다");
  assert.equal(store.hit("c", 1, 3600, 21_000).allowed, false, "c는 남아 있다");
});

test("성능(회귀 ⚪): 상한에 꽉 찬 저장소에 새 키 10만 개를 넣어도 삽입당 O(1)", () => {
  const store = new MemoryRateLimitStore(5_000);
  for (let i = 0; i < 5_000; i++) store.hit(`warm${i}`, 10, 3600, 0);
  const started = performance.now();
  for (let i = 0; i < 100_000; i++) store.hit(`k${i}`, 10, 3600, 1);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 3_000, `${Math.round(elapsed)}ms (옛 구현은 삽입마다 전체 순회: 약 5억 회)`);
});

test("프록시 설정: TRUSTED_PROXY_HOPS 0 → 헤더 불신, 1 이상 → XFF 오른쪽 N번째", () => {
  assert.deepEqual(proxyConfigFromHops(0), { header: null, trustedHops: 0 });
  assert.deepEqual(proxyConfigFromHops(1), { header: "x-forwarded-for", trustedHops: 1 });
  assert.deepEqual(proxyConfigFromHops(2), { header: "x-forwarded-for", trustedHops: 2 });
  for (const bad of [-1, 1.5, Number.NaN]) assert.deepEqual(proxyConfigFromHops(bad), { header: null, trustedHops: 0 }, String(bad));
});

test("XFF(1홉): 오른쪽 신뢰 홉 값만 쓴다(왼쪽 위조 무시)", () => {
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), ONE_HOP), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.1" }), proxyConfigFromHops(2)), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "203.0.113.7" }), proxyConfigFromHops(2)), null, "체인이 짧으면 IP 버킷 없음");
  assert.equal(clientIp(H({ "x-forwarded-for": "[2001:DB8::1]:443" }), ONE_HOP), "2001:db8:0:0::/64");
  assert.equal(clientIp(H({ "x-forwarded-for": "203.0.113.7:5555" }), ONE_HOP), "203.0.113.7");
  assert.equal(clientIp(H({ "x-forwarded-for": "not-an-ip" }), ONE_HOP), null);
  assert.equal(clientIp(H({ "x-forwarded-for": "999.1.1.1" }), ONE_HOP), null);
  assert.equal(clientIp(H({}), ONE_HOP), null);
});

test("홉 0·헤더 null이면 헤더를 믿지 않고 IP를 쓰지 않는다(null)", () => {
  const h = H({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" });
  assert.equal(clientIp(h, { header: null, trustedHops: 1 }), null);
  assert.equal(clientIp(h, { header: "x-forwarded-for", trustedHops: 0 }), null);
  assert.equal(clientIp(h, proxyConfigFromHops(0)), null);
});

test("회귀 🟠3: 0홉이면 공용 unknown 버킷이 없다(서로 다른 사용자 15명이 서로를 막지 않는다)", async () => {
  const store = new MemoryRateLimitStore();
  const cfg = proxyConfigFromHops(0);
  for (let i = 0; i < ACTIVATE_LIMIT + 5; i++) {
    const ip = clientIp(H({ "x-forwarded-for": `198.51.100.${i}` }), cfg);
    assert.equal((await hitActivateLimit({ store, ipSalt: "s", nowMs: 0, ip, userId: `user-${i}` })).allowed, true, `${i + 1}번째 사용자`);
  }
  // 사용자 버킷은 그대로 적용된다
  for (let i = 0; i < ACTIVATE_LIMIT - 1; i++) await hitActivateLimit({ store, ipSalt: "s", nowMs: 0, ip: null, userId: "user-0" });
  assert.equal((await hitActivateLimit({ store, ipSalt: "s", nowMs: 0, ip: null, userId: "user-0" })).allowed, false);
});

test("IP 정규화(회귀 🟡): net.isIP 검증, IPv4-mapped → IPv4, IPv6 → /64, 비정상 거부", () => {
  assert.equal(normalizeIp("203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(normalizeIp("::FFFF:cb00:7107"), "203.0.113.7", "16진 mapped 표기");
  assert.equal(normalizeIp("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(normalizeIp("2001:0DB8:0001:0002:ffff::1"), "2001:db8:1:2::/64", "같은 /64는 같은 값");
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
  for (const bad of [":::", "::::", "1.2.3", "01.2.3.4", "2001:db8::1::2", "fe80::1%eth0", "gggg::1", "", "1.2.3.4.5", "::ffff:999.1.1.1"]) {
    assert.equal(normalizeIp(bad), null, bad);
  }
  const h = (v: string) => clientIp(H({ "x-forwarded-for": v }), ONE_HOP);
  assert.equal(h(":::"), null);
  assert.equal(h("::ffff:203.0.113.7"), h("203.0.113.7"), "mapped 표기로 새 버킷을 만들 수 없다");
  assert.equal(h("2001:db8:1:2::a"), h("2001:db8:1:2::b"), "IPv6 하위 64비트 회전으로 새 버킷을 만들 수 없다");
});

test("IP 해시: 솔트별로 다르고 원문을 포함하지 않는다", () => {
  const a = ipHash("203.0.113.7", "salt-a");
  assert.notEqual(a, ipHash("203.0.113.7", "salt-b"));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(ipHash("::ffff:203.0.113.7", "s"), ipHash("203.0.113.7", "s"), "해시 전에 정규화");
});

test("activate 버킷: XFF 왼쪽 값을 바꿔도 같은 버킷, 사용자 버킷이 IP 회전을 막는다", async () => {
  const store = new MemoryRateLimitStore();
  const base = { store, ipSalt: "s", nowMs: 0 };
  for (let i = 0; i < ACTIVATE_LIMIT; i++) {
    const ip = clientIp(H({ "x-forwarded-for": `1.1.1.${i}, 203.0.113.7` }), ONE_HOP);
    assert.equal((await hitActivateLimit({ ...base, ip, userId: `u${i}` })).allowed, true);
  }
  assert.equal((await hitActivateLimit({ ...base, ip: "203.0.113.7", userId: "fresh" })).allowed, false, "IP 버킷 소진");

  const store2 = new MemoryRateLimitStore();
  for (let i = 0; i < ACTIVATE_LIMIT; i++) {
    assert.equal((await hitActivateLimit({ store: store2, ipSalt: "s", nowMs: 0, ip: `198.51.100.${i}`, userId: "u" })).allowed, true);
  }
  assert.equal((await hitActivateLimit({ store: store2, ipSalt: "s", nowMs: 0, ip: "198.51.100.200", userId: "u" })).allowed, false, "사용자 버킷 소진");
});
