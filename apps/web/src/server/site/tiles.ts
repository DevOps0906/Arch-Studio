// GET /api/site/tiles/{layer}/{z}/{x}/{y}(새 프로젝트 지도 배경 타일) 본체와 VWorld WMTS 어댑터.
// 순서: 스위치(503) → 경로 값 검사(layer enum·z 6~19·z별 대한민국 범위 x·y, 밖이면 404) → Bearer 세션(401/403, 60초 메모리 캐시) → member+(403)·엔타이틀먼트(402, 캐시된 세션 값)
// → 키 없음 AR021 not_configured → 타일 전용 리밋(조직 1200/분, 429) → 상위 1회 → 이미지만 통과.
// VWorld WMTS는 키가 **경로**에 들어간다: URL 원문은 오류·로그·응답 어디에도 남기지 않는다(fetch 예외는 버리고 사유 코드만).
// 지적(연속지적도) 레이어는 열지 않는다(base·gray만). 타일 x·y는 위치이므로 로그에 남기지 않는다(layer만).
// 경로 형식 `/req/wmts/1.0.0/{key}/{Base|gray}/{z}/{y}/{x}.png`(GoogleMapsCompatible)은 공개 문서 기준이며 원문 확인 전(사람 확인).
// server-only를 import하지 않는다(node --test 대상).
import { createHash } from "node:crypto";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { providerError, SiteError, siteErrorResponse } from "./http.ts";
import { siteLog } from "./log.ts";
import { siteFromGateway } from "./search.ts";
import { readLimitedBytes, VWORLD_CALL_TIMEOUT_MS, VWORLD_ORIGIN, type FetchImpl } from "./vworld.ts";

/** 허용 레이어 → VWorld 레이어 이름(고정). 지적 레이어 없음. */
export const TILE_LAYERS = { base: "Base", gray: "gray" } as const;
export type TileLayer = keyof typeof TILE_LAYERS;
export const TILE_Z_MIN = 6;
export const TILE_Z_MAX = 19;
/** 대한민국 범위(경위도, 독도·마라도·휴전선 + 여유). z별 타일 x·y 범위는 이 상자에서 계산한다. */
export const KOREA_LONLAT = { west: 124.0, east: 132.0, south: 33.0, north: 39.0 } as const;
export const TILE_WMTS_PREFIX = "/req/wmts/1.0.0/";
export const TILE_MAX_BYTES = 512 * 1024;
/** 조직당 분당 타일 상한(화면 1장 ≈ 20~40타일, 이동·확대 반복 여유). 검색·조회 리밋과 별도 키. */
export const SITE_TILE_BURST = { limit: 1200, windowS: 60 } as const;
export const TILE_SESSION_TTL_MS = 60_000;
export const TILE_SESSION_CACHE_MAX = 10_000;
export const TILE_CACHE_CONTROL = "private, max-age=86400";
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);
const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

export interface TileParams {
  layer: string;
  z: string;
  x: string;
  y: string;
}

export interface TileRequest {
  layer: TileLayer;
  z: number;
  x: number;
  y: number;
}

export interface TileImage {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: "image/png" | "image/jpeg";
}

export interface SiteTileProvider {
  fetchTile(tile: TileRequest, signal?: AbortSignal): Promise<TileImage>;
}

export interface SiteTileDeps {
  /** ARCH_SITE_MAP_ENABLED. 호출 때마다 읽는다. */
  enabled(): boolean;
  session: GatewaySessionResolver;
  sessionCache: TileSessionCache;
  /** null = VWORLD_API_KEY 없음(AR021 not_configured). */
  provider: SiteTileProvider | null;
  rateLimit: RateLimitStore;
  now(): number;
}

function lonToX(lon: number, n: number): number {
  return Math.floor(((lon + 180) / 360) * n);
}

function latToY(lat: number, n: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
}

/** z의 대한민국 타일 범위(포함). y는 북쪽이 작다. */
export function koreaTileRange(z: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const n = 2 ** z;
  return { minX: lonToX(KOREA_LONLAT.west, n), maxX: lonToX(KOREA_LONLAT.east, n), minY: latToY(KOREA_LONLAT.north, n), maxY: latToY(KOREA_LONLAT.south, n) };
}

const INT = /^(0|[1-9]\d{0,6})$/;

/** 경로 값 검사. 밖이면 null(어느 값이 틀렸는지 돌려주지 않는다). */
export function parseTileParams(p: TileParams): TileRequest | null {
  if (!Object.hasOwn(TILE_LAYERS, p.layer)) return null;
  if (!INT.test(p.z) || !INT.test(p.x) || !INT.test(p.y)) return null;
  const z = Number(p.z);
  const x = Number(p.x);
  const y = Number(p.y);
  if (z < TILE_Z_MIN || z > TILE_Z_MAX) return null;
  const r = koreaTileRange(z);
  if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) return null;
  return { layer: p.layer as TileLayer, z, x, y };
}

/**
 * 세션 확인 결과 캐시(타일은 화면당 수십 건이라 매번 Supabase를 부르지 않는다). 키 = Authorization 헤더 sha256(토큰 원문 미보관).
 * 성공만 담는다. 만료·로그아웃·권한 변경은 최대 TTL(60초)만큼 늦게 반영된다(로그 "남은 항목").
 */
export class TileSessionCache {
  readonly #entries = new Map<string, { session: GatewaySession; expiresAt: number }>();
  readonly #ttlMs: number;
  readonly #max: number;

  constructor(ttlMs = TILE_SESSION_TTL_MS, max = TILE_SESSION_CACHE_MAX) {
    this.#ttlMs = ttlMs;
    this.#max = max;
  }

  static keyOf(authorization: string): string {
    return createHash("sha256").update(authorization, "utf8").digest("hex");
  }

  get(key: string, now: number): GatewaySession | null {
    const e = this.#entries.get(key);
    if (!e) return null;
    if (e.expiresAt <= now) {
      this.#entries.delete(key);
      return null;
    }
    return e.session;
  }

  set(key: string, session: GatewaySession, now: number): void {
    this.#entries.delete(key);
    if (this.#entries.size >= this.#max) {
      for (const [k, v] of this.#entries) {
        if (this.#entries.size < this.#max && v.expiresAt > now) break;
        this.#entries.delete(k);
      }
    }
    this.#entries.set(key, { session, expiresAt: now + this.#ttlMs });
  }
}

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** 상위 URL 조립. 키는 경로 칸 하나에만(인코딩), 조립 결과의 출처·접두가 상수와 다르면 throw. 반환값은 로그·오류에 쓰지 않는다. */
export function buildTileUrl(tile: TileRequest, apiKey: string): string {
  const url = new URL(`${TILE_WMTS_PREFIX}${encodeURIComponent(apiKey)}/${TILE_LAYERS[tile.layer]}/${tile.z}/${tile.y}/${tile.x}.png`, VWORLD_ORIGIN);
  if (url.origin !== VWORLD_ORIGIN || !url.pathname.startsWith(TILE_WMTS_PREFIX) || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new SiteError("internal");
  }
  return url.toString();
}

export interface VworldTileOptions {
  apiKey: string;
  fetch: FetchImpl;
  timeoutMs?: number;
  maxBytes?: number;
}

export function createVworldTiles(options: VworldTileOptions): SiteTileProvider {
  const timeoutMs = options.timeoutMs ?? VWORLD_CALL_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? TILE_MAX_BYTES;
  return {
    async fetchTile(tile, outer) {
      const url = buildTileUrl(tile, options.apiKey);
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onOuter = () => controller.abort();
      outer?.addEventListener("abort", onOuter, { once: true });
      try {
        let res: Response;
        try {
          res = await options.fetch(url, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "image/png,image/jpeg" } });
        } catch {
          // 원 예외 메시지에는 URL(키 포함)이 있을 수 있다 → 버린다.
          throw providerError(timedOut ? "timeout" : "network");
        }
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => undefined);
          throw providerError("http_status");
        }
        const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!ALLOWED_TYPES.has(type)) {
          await res.body?.cancel().catch(() => undefined);
          throw providerError("invalid_response");
        }
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = await readLimitedBytes(res, maxBytes);
        } catch (e) {
          if (e instanceof SiteError) throw e;
          throw providerError(timedOut ? "timeout" : "network");
        }
        // 선언 형식과 실제 바이트가 다르면(오류 페이지를 image/png로 보낸 경우 등) 거부.
        if (type === "image/png" ? !isPng(bytes) : !isJpeg(bytes)) throw providerError("invalid_response");
        return { bytes, contentType: type as TileImage["contentType"] };
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuter);
      }
    },
  };
}

export async function handleSiteTile(req: Request, params: TileParams, deps: SiteTileDeps): Promise<Response> {
  let stage = "switch";
  let layer: string | undefined;
  try {
    if (!deps.enabled()) throw new SiteError("site_map_disabled");

    stage = "input";
    const tile = parseTileParams(params);
    if (!tile) throw new SiteError("invalid_tile");
    layer = tile.layer;

    stage = "session";
    const authorization = req.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) throw new SiteError("unauthorized");
    const cacheKey = TileSessionCache.keyOf(authorization);
    let session = deps.sessionCache.get(cacheKey, deps.now());
    if (!session) {
      try {
        session = await deps.session.resolve(req);
      } catch (e) {
        throw siteFromGateway(e);
      }
      deps.sessionCache.set(cacheKey, session, deps.now());
    }
    if (!MEMBER_PLUS.has(session.role)) throw new SiteError("42501");
    if (!session.entitled) throw new SiteError("entitlement_expired", { can_download: true });

    stage = "limit";
    if (!deps.provider) throw providerError("not_configured");
    const hit = await deps.rateLimit.hit(`arch:site_tiles:org:${session.orgId}`, SITE_TILE_BURST.limit, SITE_TILE_BURST.windowS, deps.now());
    if (!hit.allowed) {
      throw new SiteError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }

    stage = "fetch";
    const image = await deps.provider.fetchTile(tile, req.signal);
    // 상위 헤더(Set-Cookie 등)는 하나도 옮기지 않는다: 새 헤더만.
    return new Response(image.bytes, {
      status: 200,
      headers: {
        "content-type": image.contentType,
        "content-length": String(image.bytes.byteLength),
        "cache-control": TILE_CACHE_CONTROL,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const e = error instanceof SiteError ? error : new SiteError("internal");
    const reason = typeof e.details?.["reason"] === "string" ? (e.details["reason"] as string) : undefined;
    siteLog.warn("site_tiles.rejected", { route: "site_tiles", code: e.code, stage, ...(layer ? { kind: layer } : {}), ...(reason ? { reason } : {}) });
    return siteErrorResponse(e);
  }
}
