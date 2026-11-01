// POST /api/site/search(새 프로젝트 지도: 지번·도로명 후보 검색) 본체와 VWorld 검색 API 2.0 어댑터.
// 순서: 방식 POST만(405, URL에 주소를 싣는 GET 금지) → 스위치(503) → 인증(401/403) → 본문 zod strict(400/413/422)
// → member+(403) → 엔타이틀먼트(402) → 키 없음 AR021 not_configured → 검색 전용 버스트 리밋(429, 조회 리밋과 별도 키)
// → VWorld `/req/search` 1회 → 후보 최대 10 `{ label, kind, pnu? }`(좌표 미포함).
// 일일 상한(arch.record_site_lookup)에는 산입하지 않는다: 후보를 고른 뒤 화면이 기존 POST /api/site/lookup을 PNU로 부를 때 센다.
// 방어는 vworld.ts와 같다: 고정 출처·경로, 값은 searchParams 값 칸에만, redirect 금지, 크기·시간 상한, 주소 원문·좌표 저장/로그 0.
// 응답 형식(`response.result.items[].{id, address.{parcel,road}}`, parcel 결과의 id = PNU)은 공개 문서 기준이며 원문 확인 전(사람 확인).
// server-only를 import하지 않는다(node --test 대상).
import { GatewayError, readJsonLimited } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { providerError, SiteError, siteErrorResponse, siteOkResponse, type SiteErrorCode } from "./http.ts";
import { siteLog } from "./log.ts";
import { parseSearchBody, PNU_RE, type SiteSearchKind, type SiteSearchQuery } from "./schema.ts";
import { buildVworldUrl, cleanText, readLimitedBytes, VWORLD_CALL_TIMEOUT_MS, VWORLD_PATHS, type FetchImpl } from "./vworld.ts";

export const SITE_SEARCH_MAX_BODY = 1024;
/** 조직당 분당 검색 상한(입력 중 연속 검색 허용, 제공자 쿼터 보호). 키는 조회(arch:site_lookup:…)와 별도. */
export const SITE_SEARCH_BURST = { limit: 30, windowS: 60 } as const;
export const SITE_SEARCH_MAX_CANDIDATES = 10;
/** 검색 응답 본문 상한(후보 10건 × 약 1KB의 20배 여유). */
export const SITE_SEARCH_MAX_RESPONSE_BYTES = 256 * 1024;
const LABEL_MAX = 200;

export interface SiteSearchCandidate {
  label: string;
  kind: SiteSearchKind;
  pnu?: string;
}

export interface SiteSearchProvider {
  search(query: SiteSearchQuery, signal?: AbortSignal): Promise<SiteSearchCandidate[]>;
}

export interface SiteSearchDeps {
  /** ARCH_SITE_MAP_ENABLED. 호출 때마다 읽는다. */
  enabled(): boolean;
  session: GatewaySessionResolver;
  /** null = VWORLD_API_KEY 없음(AR021 not_configured). */
  provider: SiteSearchProvider | null;
  rateLimit: RateLimitStore;
  now(): number;
}

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 게이트웨이 공용 함수(세션·본문 읽기)의 오류 → 대지 코드. */
export function siteFromGateway(e: unknown): SiteError {
  if (!(e instanceof GatewayError)) return new SiteError("internal");
  const map: Partial<Record<string, SiteErrorCode>> = {
    unauthorized: "unauthorized",
    account_inactive: "account_inactive",
    no_org: "no_org",
    invalid_json: "invalid_json",
    payload_too_large: "payload_too_large",
  };
  return new SiteError(map[e.code] ?? "internal");
}

/** 검색 응답 → 후보(좌표 필드는 읽지 않는다). NOT_FOUND는 빈 목록. */
export function parseSearch(json: unknown, kind: SiteSearchKind): SiteSearchCandidate[] {
  const response = obj(obj(json)?.["response"]);
  const status = response?.["status"];
  if (status === "NOT_FOUND") return [];
  if (status !== "OK") throw providerError("invalid_response");
  const items = obj(response?.["result"])?.["items"];
  if (!Array.isArray(items) || items.length > 100) throw providerError("invalid_response");
  const out: SiteSearchCandidate[] = [];
  for (const raw of items) {
    const item = obj(raw);
    const address = obj(item?.["address"]);
    const label = cleanText(kind === "road" ? address?.["road"] : address?.["parcel"], LABEL_MAX);
    if (!label) continue;
    const id = item?.["id"];
    const pnu = kind === "jibun" && typeof id === "string" && PNU_RE.test(id) ? id : undefined;
    if (out.some((c) => c.label === label && c.pnu === pnu)) continue;
    out.push(pnu ? { label, kind, pnu } : { label, kind });
    if (out.length >= SITE_SEARCH_MAX_CANDIDATES) break;
  }
  return out;
}

export interface VworldSearchOptions {
  apiKey: string;
  fetch: FetchImpl;
  domain?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/** VWorld 검색 API 2.0(`/req/search`, type=address, category=parcel|road). 재시도 없음(입력 중 다음 검색이 곧 온다). */
export function createVworldSearch(options: VworldSearchOptions): SiteSearchProvider {
  const timeoutMs = options.timeoutMs ?? VWORLD_CALL_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? SITE_SEARCH_MAX_RESPONSE_BYTES;
  return {
    async search(query, outer) {
      const url = buildVworldUrl(
        VWORLD_PATHS.search,
        {
          service: "search",
          request: "search",
          version: "2.0",
          type: "address",
          category: query.kind === "road" ? "road" : "parcel",
          size: String(SITE_SEARCH_MAX_CANDIDATES),
          page: "1",
          errorformat: "json",
          query: query.value,
        },
        options.apiKey,
        options.domain,
      );
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
          res = await options.fetch(url.toString(), { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json" } });
        } catch {
          // 원 예외(메시지에 URL·키·주소가 있을 수 있음)는 버린다.
          throw providerError(timedOut ? "timeout" : "network");
        }
        if (res.status !== 200) throw providerError("http_status");
        let bytes: Uint8Array;
        try {
          bytes = await readLimitedBytes(res, maxBytes);
        } catch (e) {
          if (e instanceof SiteError) throw e;
          throw providerError(timedOut ? "timeout" : "network");
        }
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        } catch {
          throw providerError("invalid_response");
        }
        return parseSearch(json, query.kind);
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener("abort", onOuter);
      }
    },
  };
}

export async function handleSiteSearch(req: Request, deps: SiteSearchDeps): Promise<Response> {
  let stage = "method";
  let kind: string | undefined;
  try {
    if (req.method !== "POST") throw new SiteError("method_not_allowed", undefined, { allow: "POST" });
    stage = "switch";
    if (!deps.enabled()) throw new SiteError("site_map_disabled");

    stage = "session";
    let session: GatewaySession;
    try {
      session = await deps.session.resolve(req);
    } catch (e) {
      throw siteFromGateway(e);
    }

    stage = "input";
    let body: unknown;
    try {
      body = await readJsonLimited(req, SITE_SEARCH_MAX_BODY);
    } catch (e) {
      throw e instanceof GatewayError ? siteFromGateway(e) : new SiteError("invalid_json");
    }
    const query = parseSearchBody(body);
    if (!query) throw new SiteError("invalid_input");
    kind = query.kind;

    if (!MEMBER_PLUS.has(session.role)) throw new SiteError("42501");
    if (!session.entitled) throw new SiteError("entitlement_expired", { can_download: true });

    stage = "limit";
    if (!deps.provider) throw providerError("not_configured");
    const hit = await deps.rateLimit.hit(`arch:site_search:org:${session.orgId}`, SITE_SEARCH_BURST.limit, SITE_SEARCH_BURST.windowS, deps.now());
    if (!hit.allowed) {
      throw new SiteError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }

    stage = "fetch";
    const candidates = await deps.provider.search(query, req.signal);
    siteLog.info("site_search.ok", { route: "site_search", kind: query.kind });
    return siteOkResponse({ candidates });
  } catch (error) {
    const e = error instanceof SiteError ? error : new SiteError("internal");
    const reason = typeof e.details?.["reason"] === "string" ? (e.details["reason"] as string) : undefined;
    siteLog.warn("site_search.rejected", { route: "site_search", code: e.code, stage, ...(kind ? { kind } : {}), ...(reason ? { reason } : {}) });
    return siteErrorResponse(e);
  }
}
