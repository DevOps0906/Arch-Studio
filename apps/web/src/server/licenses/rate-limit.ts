// 활성화 API 레이트 리밋(PRD 4.4절·04_API.md 1장: IP당 10회/시간, activate·refresh 같은 버킷).
// 키: arch:license_activate:ip:<HMAC(RATE_LIMIT_IP_SALT, ip)> (IP 원문은 저장·로그 0).
// 심층 방어(제안): 같은 한도의 사용자 버킷 arch:license_activate:user:<user_id>(IP 회전 우회 차단).
// 저장소는 인터페이스. 기본 메모리 구현은 인스턴스별로 따로 센다 → 운영(다중 인스턴스) 전에
// core.rate_limit_hit(service_role) 또는 Redis 구현으로 교체한다(후속, tasks/logs/AR-06-040.md).
import { createHmac } from "node:crypto";

export const ACTIVATE_LIMIT = 10;
export const ACTIVATE_WINDOW_SECONDS = 3600;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowSeconds: number, nowMs: number): Promise<RateLimitResult> | RateLimitResult;
}

/** 고정 창 메모리 저장소. 항목 수 상한을 넘으면 만료 항목부터, 그래도 넘으면 가장 오래된 항목을 버린다. */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, { start: number; count: number; windowMs: number }>();
  readonly #maxEntries: number;

  constructor(maxEntries = 50_000) {
    this.#maxEntries = maxEntries;
  }

  hit(key: string, limit: number, windowSeconds: number, nowMs: number): RateLimitResult {
    const windowMs = windowSeconds * 1000;
    let bucket = this.#buckets.get(key);
    if (!bucket || bucket.start + bucket.windowMs <= nowMs) {
      this.#buckets.delete(key);
      if (this.#buckets.size >= this.#maxEntries) this.#evict(nowMs);
      bucket = { start: nowMs, count: 0, windowMs };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, remaining: Math.max(limit - bucket.count, 0), resetAtMs: bucket.start + bucket.windowMs };
  }

  #evict(nowMs: number) {
    for (const [k, b] of this.#buckets) if (b.start + b.windowMs <= nowMs) this.#buckets.delete(k);
    while (this.#buckets.size >= this.#maxEntries) {
      const oldest = this.#buckets.keys().next();
      if (oldest.done) break;
      this.#buckets.delete(oldest.value);
    }
  }
}

/**
 * 프록시 헤더 신뢰 범위.
 * - header: 클라이언트 IP를 담는 헤더(기본 x-forwarded-for). null이면 헤더를 쓰지 않는다.
 * - trustedHops: 신뢰하는 프록시 수. XFF는 오른쪽에서 trustedHops번째 값을 쓴다(그보다 왼쪽 값은 클라이언트가 위조 가능).
 *   0이면 헤더를 믿지 않는다 → 모든 요청이 공용 "unknown" 버킷(안전 쪽 실패).
 * Vercel은 XFF를 클라이언트 IP 하나로 덮어쓰므로 trustedHops=1(02_ARCHITECTURE.md 7장 web = Vercel).
 */
export interface TrustedProxyConfig {
  header: string | null;
  trustedHops: number;
}

export const UNKNOWN_IP = "unknown";

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;

function cleanIp(value: string): string | null {
  let v = value.trim();
  if (v.startsWith("[") && v.includes("]")) v = v.slice(1, v.indexOf("]")); // [v6]:port
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":")); // v4:port
  if (IPV4.test(v) && v.split(".").every((p) => Number(p) <= 255)) return v;
  if (v.includes(":") && IPV6.test(v)) return v.toLowerCase();
  return null;
}

export function clientIp(headers: Headers, config: TrustedProxyConfig): string {
  if (!config.header || !Number.isInteger(config.trustedHops) || config.trustedHops < 1) return UNKNOWN_IP;
  const raw = headers.get(config.header);
  if (!raw) return UNKNOWN_IP;
  const chain = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length < config.trustedHops) return UNKNOWN_IP;
  const candidate = chain[chain.length - config.trustedHops];
  return (candidate && cleanIp(candidate)) ?? UNKNOWN_IP;
}

export function ipHash(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(ip, "utf8").digest("hex").slice(0, 32);
}

export interface ActivateLimitInput {
  store: RateLimitStore;
  ipSalt: string;
  ip: string;
  userId: string;
  nowMs: number;
}

/** activate·refresh 공용 버킷. IP·사용자 둘 다 통과해야 허용. 둘 다 항상 센다(한쪽만 소모하는 우회 방지). */
export async function hitActivateLimit(input: ActivateLimitInput): Promise<RateLimitResult> {
  const ipKey = `arch:license_activate:ip:${ipHash(input.ip, input.ipSalt)}`;
  const userKey = `arch:license_activate:user:${input.userId}`;
  const [a, b] = await Promise.all([
    input.store.hit(ipKey, ACTIVATE_LIMIT, ACTIVATE_WINDOW_SECONDS, input.nowMs),
    input.store.hit(userKey, ACTIVATE_LIMIT, ACTIVATE_WINDOW_SECONDS, input.nowMs),
  ]);
  return { allowed: a.allowed && b.allowed, remaining: Math.min(a.remaining, b.remaining), resetAtMs: Math.max(a.resetAtMs, b.resetAtMs) };
}
