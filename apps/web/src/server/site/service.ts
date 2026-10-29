// POST /api/site/lookup 본체(04_API.md 2.1절, 6·6.1절, 03장 2.2절). 순서:
// 인증(401/403) → 본문 zod strict(400/413/422) → 역할 member+(403) → 엔타이틀먼트(402) → 조회 켜짐(키 없음 AR021 not_configured)
// → 조직 버스트 리밋(429) → 해시 키 확인(503) → 제공자 resolve(PNU 확정; PNU 질의는 호출 0) → HMAC → arch.record_site_lookup(AR020)
// → 제공자 경계·용도지역 → 응답(입력 후보 표시).
// 결과는 "입력 후보"다: 판정 기준이 아니고(02장 위험 #1), 좌표 변환·mm 정수화는 화면(packages/domain mToMm)이 한다(04_API 2.1).
// 서버는 주소 원문·응답 좌표를 저장하지 않는다(DB에는 HMAC 해시만, 로그는 허용 목록).
// server-only를 import하지 않는다(node --test 대상).
import { GatewayError, readJsonLimited } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { HASH_KEY_MIN_CHARS, pnuHash } from "./hash.ts";
import { providerError, SiteError, siteErrorResponse, siteOkResponse, type SiteErrorCode } from "./http.ts";
import { siteLog } from "./log.ts";
import { parseLookupBody } from "./schema.ts";
import { VWORLD_CRS, type SiteLookupProvider } from "./vworld.ts";

/** arch.record_site_lookup 포트(service_role). 남은 횟수를 돌려준다. 상한 초과는 code "AR020"인 오류. */
export interface SiteLookupRecorder {
  record(orgId: string, pnuHash: string): Promise<number>;
}

export interface SiteLookupDeps {
  session: GatewaySessionResolver;
  /** null = 조회 꺼짐(VWORLD_API_KEY 없음 또는 운영 스위치 off). D-14 확인 전 기본. */
  provider: SiteLookupProvider | null;
  recorder(): SiteLookupRecorder;
  /** SITE_LOOKUP_HASH_KEY. 호출 때마다 읽는다(키 값은 어디에도 남기지 않는다). */
  hashKey(): string;
  rateLimit: RateLimitStore;
  now(): number;
}

export const SITE_LOOKUP_MAX_BODY = 1024;
/** 조직당 분당 버스트 상한(일일 상한 전 제공자 쿼터 보호, 로그 "상수 근거"). */
export const SITE_LOOKUP_BURST = { limit: 20, windowS: 60 } as const;
/** 화면 표시용 안내(입력 후보, 판정 기준 아님). */
export const CANDIDATE_NOTICE = "공공 데이터 값은 입력 후보이며 판정 기준이 아닙니다. 경계·용도지역을 확인한 뒤 반영하세요.";

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

/** 게이트웨이 공용 함수(세션·본문 읽기)의 오류 → 대지 조회 코드. */
function fromGateway(e: GatewayError): SiteError {
  const map: Partial<Record<string, SiteErrorCode>> = {
    unauthorized: "unauthorized",
    account_inactive: "account_inactive",
    no_org: "no_org",
    invalid_json: "invalid_json",
    payload_too_large: "payload_too_large",
  };
  return new SiteError(map[e.code] ?? "internal");
}

function dbCode(e: unknown): string | null {
  const c = e !== null && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof c === "string" ? c : null;
}

export async function handleSiteLookup(req: Request, deps: SiteLookupDeps): Promise<Response> {
  let stage = "session";
  let kind: string | undefined;
  try {
    let session: GatewaySession;
    try {
      session = await deps.session.resolve(req);
    } catch (e) {
      throw e instanceof GatewayError ? fromGateway(e) : new SiteError("internal");
    }

    stage = "input";
    let body: unknown;
    try {
      body = await readJsonLimited(req, SITE_LOOKUP_MAX_BODY);
    } catch (e) {
      throw e instanceof GatewayError ? fromGateway(e) : new SiteError("invalid_json");
    }
    const query = parseLookupBody(body);
    if (!query) throw new SiteError("invalid_input");
    kind = query.kind;

    if (!MEMBER_PLUS.has(session.role)) throw new SiteError("42501");
    if (!session.entitled) throw new SiteError("entitlement_expired", { can_download: true });

    stage = "limit";
    if (!deps.provider) throw providerError("not_configured");
    const hit = await deps.rateLimit.hit(`arch:site_lookup:org:${session.orgId}`, SITE_LOOKUP_BURST.limit, SITE_LOOKUP_BURST.windowS, deps.now());
    if (!hit.allowed) {
      throw new SiteError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    const key = deps.hashKey();
    if (typeof key !== "string" || key.length < HASH_KEY_MIN_CHARS) throw new SiteError("site_lookup_unavailable");

    stage = "resolve";
    const lookup = deps.provider.start(req.signal);
    const resolved = await lookup.resolve(query);

    stage = "record";
    let remaining: number;
    try {
      remaining = await deps.recorder().record(session.orgId, pnuHash(resolved.pnu, key));
    } catch (e) {
      throw new SiteError(dbCode(e) === "AR020" ? "AR020" : "internal");
    }

    stage = "fetch";
    const result = await lookup.fetchParcel(resolved);
    const fetchedAt = new Date(deps.now()).toISOString();
    siteLog.info("site_lookup.ok", { kind: query.kind, remaining });
    return siteOkResponse({
      parcel: { pnu: result.pnu, address_label: result.address_label },
      crs: VWORLD_CRS,
      boundary_m: result.ring_m,
      zoning: result.zoning,
      roads: result.roads,
      sources: [{ provider: deps.provider.name, datasets: result.datasets, fetched_at: fetchedAt }],
      source: { kind: "input_candidate", judgment_basis: false, notice: CANDIDATE_NOTICE },
      notes: result.notes,
      remaining_today: remaining,
    });
  } catch (error) {
    const e = error instanceof SiteError ? error : new SiteError("internal");
    const reason = typeof e.details?.["reason"] === "string" ? (e.details["reason"] as string) : undefined;
    siteLog.warn("site_lookup.rejected", { code: e.code, stage, ...(kind ? { kind } : {}), ...(reason ? { reason } : {}) });
    return siteErrorResponse(e);
  }
}
