// 활성화 API 레이트 리밋(PRD 4.4절·04_API.md 1장: IP당 10회/시간, activate·refresh 같은 버킷).
// 키: arch:license_activate:ip:<HMAC(RATE_LIMIT_IP_SALT, 정규화 IP)> (IP 원문은 저장·로그 0).
// 심층 방어(제안): 같은 한도의 사용자 버킷 arch:license_activate:user:<user_id>(IP 회전 우회 차단). 사용자 버킷은 항상 센다.
// IP 버킷은 신뢰할 수 있는 클라이언트 IP가 있을 때만(TRUSTED_PROXY_HOPS ≥ 1이고 헤더가 유효). 없으면 IP 버킷을 끈다
// (공용 "unknown" 버킷은 모든 사용자를 한 버킷에 몰아 전역 DoS가 되므로 두지 않는다).
// 운영 차단: 기본 메모리 구현은 인스턴스별로 따로 센다 → 운영(다중 인스턴스) 전에
// core.rate_limit_hit(service_role) 또는 Redis 구현으로 교체한다(후속, tasks/logs/AR-06-040.md). 교체 전 운영 배포 금지.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

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

/**
 * 고정 창 메모리 저장소. 항목 수 상한을 넘으면 만료 항목부터, 그래도 넘으면 가장 오래된 항목을 버린다.
 * Map은 삽입 순서를 지키고 새 창은 항상 delete 후 set이라 맨 뒤로 간다 → 앞쪽이 가장 오래된 창.
 * 축출은 앞에서부터 만료 항목만 지우고 첫 생존 항목에서 멈춘다(삽입당 분할 상환 O(1)).
 * 창 길이가 키마다 다르면 앞쪽 생존 항목 뒤의 만료 항목은 다음 축출이나 상한 초과 때 정리된다(근사, 안전 쪽).
 */
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
    for (const [k, b] of this.#buckets) {
      if (b.start + b.windowMs > nowMs) break;
      this.#buckets.delete(k);
    }
    while (this.#buckets.size >= this.#maxEntries) {
      const oldest = this.#buckets.keys().next();
      if (oldest.done) break;
      this.#buckets.delete(oldest.value);
    }
  }
}

/**
 * 프록시 헤더 신뢰 범위.
 * - header: 클라이언트 IP를 담는 헤더(x-forwarded-for). null이면 헤더를 쓰지 않는다.
 * - trustedHops: 신뢰하는 프록시 수. XFF는 오른쪽에서 trustedHops번째 값을 쓴다(그보다 왼쪽 값은 클라이언트가 위조 가능).
 *   0이면 헤더를 믿지 않는다 → IP 버킷을 끄고 사용자 버킷만 쓴다.
 * 값은 serverEnv().TRUSTED_PROXY_HOPS(기본 0)에서 온다. Vercel은 XFF를 클라이언트 IP 하나로 덮어쓰므로 배포 환경에 1을 설정한다.
 */
export interface TrustedProxyConfig {
  header: string | null;
  trustedHops: number;
}

/** TRUSTED_PROXY_HOPS → 설정. 정수 1 이상만 헤더를 믿는다(그 밖은 0홉). 플랫폼 감지(VERCEL=1 등) 특례 없음: 명시 설정만. */
export function proxyConfigFromHops(hops: number): TrustedProxyConfig {
  return Number.isInteger(hops) && hops >= 1 ? { header: "x-forwarded-for", trustedHops: hops } : { header: null, trustedHops: 0 };
}

/** IPv6 문자열(net.isIP로 이미 검증) → 16비트 8칸. 끝의 점 표기 IPv4는 2칸으로. */
function ipv6Hextets(v: string): number[] | null {
  let text = v;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const o = last.split(".").map(Number);
    if (o.length !== 4) return null;
    tail.push(((o[0] as number) << 8) | (o[1] as number), ((o[2] as number) << 8) | (o[3] as number));
    text = text.slice(0, lastColon + 1) + "0"; // 자리 표시(아래에서 버림)
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":").map((h) => Number.parseInt(h, 16)));
  const head = parse(halves[0] as string);
  const rest = halves.length === 2 ? parse(halves[1] as string) : [];
  if (tail.length) (halves.length === 2 ? rest : head).pop();
  const fill = 8 - tail.length - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  const out = [...head, ...Array<number>(Math.max(fill, 0)).fill(0), ...rest, ...tail];
  return out.length === 8 && out.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? out : null;
}

/**
 * IP 정규화(버킷 키 입력). net.isIP로 검증하고:
 * - IPv4는 그대로(선행 0 등 비정상 표기는 isIP가 거부)
 * - IPv4-mapped IPv6(::ffff:a.b.c.d, ::ffff:XXXX:XXXX)는 IPv4로
 * - 그 밖 IPv6는 /64 접두로 묶는다("h0:h1:h2:h3::/64", 소문자·선행 0 없음). 한 회선이 하위 64비트를 돌려 새 버킷을 만들지 못하게.
 * 영역 ID(%eth0)·":::" 같은 비정상 문자열은 null.
 */
export function normalizeIp(value: string): string | null {
  const v = value.trim();
  if (v.includes("%")) return null;
  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind !== 6) return null;
  const h = ipv6Hextets(v.toLowerCase());
  if (!h) return null;
  if (h.slice(0, 5).every((n) => n === 0) && h[5] === 0xffff) {
    const a = h[6] as number;
    const b = h[7] as number;
    return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
  }
  return `${h.slice(0, 4).map((n) => n.toString(16)).join(":")}::/64`;
}

/** 헤더 값 하나 → 정규화 IP. [v6]:port·v4:port 형식의 포트를 벗긴다. */
function cleanIp(value: string): string | null {
  let v = value.trim();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end < 0) return null;
    v = v.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  return normalizeIp(v);
}

/** 신뢰할 수 있는 클라이언트 IP(정규화) 또는 null(= IP 버킷을 쓰지 않음). */
export function clientIp(headers: Headers, config: TrustedProxyConfig): string | null {
  if (!config.header || !Number.isInteger(config.trustedHops) || config.trustedHops < 1) return null;
  const raw = headers.get(config.header);
  if (!raw) return null;
  const chain = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length < config.trustedHops) return null;
  const candidate = chain[chain.length - config.trustedHops];
  return candidate ? cleanIp(candidate) : null;
}

/** HMAC(salt, 정규화 IP) 앞 128비트. 정규화할 수 없는 값은 그대로 해시한다(호출 측은 clientIp 결과만 넘긴다). */
export function ipHash(ip: string, salt: string): string {
  return createHmac("sha256", salt).update(normalizeIp(ip) ?? ip, "utf8").digest("hex").slice(0, 32);
}

export interface ActivateLimitInput {
  store: RateLimitStore;
  ipSalt: string;
  /** null이면 IP 버킷을 쓰지 않는다(신뢰 프록시 없음·헤더 없음). */
  ip: string | null;
  userId: string;
  nowMs: number;
}

/** activate·refresh 공용 버킷. 사용자 버킷은 항상, IP 버킷은 IP가 있을 때만 센다. 센 버킷을 모두 통과해야 허용. */
export async function hitActivateLimit(input: ActivateLimitInput): Promise<RateLimitResult> {
  const userKey = `arch:license_activate:user:${input.userId}`;
  const hits = [input.store.hit(userKey, ACTIVATE_LIMIT, ACTIVATE_WINDOW_SECONDS, input.nowMs)];
  if (input.ip !== null) {
    const ipKey = `arch:license_activate:ip:${ipHash(input.ip, input.ipSalt)}`;
    hits.push(input.store.hit(ipKey, ACTIVATE_LIMIT, ACTIVATE_WINDOW_SECONDS, input.nowMs));
  }
  const results = await Promise.all(hits);
  return {
    allowed: results.every((r) => r.allowed),
    remaining: Math.min(...results.map((r) => r.remaining)),
    resetAtMs: Math.max(...results.map((r) => r.resetAtMs)),
  };
}
