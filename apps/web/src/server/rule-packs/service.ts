// 규칙 팩·단가표·업데이트 배포 Route Handler 본체(04_API.md 2.1·2.3절, AR-06-042).
// 순서: 인증(Bearer) → 역할(member+) → 입력 형식 → 레이트 리밋 → DB 자격 판정 → 저장소 → 응답(no-store).
// 자격은 DB(`arch.eligible_rule_packs`·`latest_cost_catalog`·`eligible_build`)만 판정한다(앱이 보낸 라이선스 파일은 쓰지 않는다).
// 의존성은 ReleaseDeps로 주입(테스트는 목). server-only를 import하지 않는다.
import { DbCallError, LicenseApiError } from "../licenses/errors.ts";
import { logger } from "../../lib/logger.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import {
  checkSignedManifest,
  compareVersions,
  manifestStoragePath,
  MAX_SIGNED_MANIFEST_BYTES,
  packStoragePath,
  VERSION_RE,
} from "./manifest.ts";
import type { EligibleRulePackRow, ReleaseDeps, ReleaseSession } from "./types.ts";

/** 서명 URL 수명(초). 04_API 2.1절 "데스크톱 10분(제안)". */
export const SIGNED_URL_SECONDS = 600;
/** 같은 (조직, 대상) 서명 URL을 다시 줄 수 있는 남은 수명 하한: 수명의 절반(계획 공격 P14, 멱등). */
const REUSE_MIN_REMAINING_MS = (SIGNED_URL_SECONDS * 1000) / 2;
/** 사용자별 레이트 리밋(시간당, 제안값 — 04_API "수치 미확정"). */
export const LIMITS = { list: 120, download: 30, cost: 120, update: 60 } as const;
const WINDOW_SECONDS = 3600;
const CHANGES_LIMIT = 100;
const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const SEMVER = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}$/;
const TARGETS = new Set(["windows", "darwin"]);
const ARCHES = new Set(["x86_64", "aarch64"]);

export type ReleaseRoute = "rule_packs" | "rule_pack_download" | "cost_catalog" | "update";

export type ReleaseErrorCode =
  | "AR010"
  | "AR011"
  | "P0002"
  | "42501"
  | "22023"
  | "unauthorized"
  | "account_inactive"
  | "no_org"
  | "invalid_input"
  | "rate_limited"
  | "internal";

const ERRORS: Readonly<Record<ReleaseErrorCode, { status: number; message: string }>> = {
  AR010: { status: 403, message: "현재 설치된 빌드는 업데이트 기간 밖입니다. 계정 화면에서 사용할 수 있는 마지막 버전을 받으세요." },
  AR011: { status: 403, message: "이 규칙 팩을 받을 자격이 없습니다. 업데이트 플랜을 확인하세요." },
  P0002: { status: 404, message: "대상을 찾을 수 없습니다." },
  "42501": { status: 403, message: "이 작업을 할 권한이 없습니다." },
  "22023": { status: 422, message: "입력 형식이 올바르지 않습니다." },
  unauthorized: { status: 401, message: "로그인이 필요합니다." },
  account_inactive: { status: 403, message: "사용할 수 없는 계정 상태입니다." },
  no_org: { status: 403, message: "조직 정보를 확인할 수 없습니다." },
  invalid_input: { status: 422, message: "입력 값이 올바르지 않습니다." },
  rate_limited: { status: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." },
  internal: { status: 500, message: "요청을 처리하지 못했습니다." },
};

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export class ReleaseApiError extends Error {
  readonly code: ReleaseErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfter: number | undefined;
  /** 로그 전용 원인 코드(응답에는 넣지 않는다). */
  readonly reason: string | undefined;
  constructor(code: ReleaseErrorCode, opts: { details?: Record<string, unknown>; retryAfter?: number; reason?: string } = {}) {
    super(code);
    this.name = "ReleaseApiError";
    this.code = code;
    this.details = opts.details;
    this.retryAfter = opts.retryAfter;
    this.reason = opts.reason;
  }
}

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

const ok = (data: unknown) => json(200, { ok: true, data });
const noContent = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

const LOG_CODE = /^[A-Za-z0-9_]{1,40}$/;

/** 로그 허용 목록: 경로·코드·상태·버전·원인 코드만(URL·서명·토큰은 형식상 못 들어간다). */
export function sanitizeReleaseLog(fields: { route: ReleaseRoute; code?: string; status?: number; version?: string; reason?: string }) {
  const out: Record<string, string | number> = { route: fields.route };
  if (fields.code && LOG_CODE.test(fields.code)) out.code = fields.code;
  if (Number.isInteger(fields.status)) out.status = fields.status as number;
  if (fields.version && (VERSION_RE.test(fields.version) || SEMVER.test(fields.version))) out.version = fields.version;
  if (fields.reason && LOG_CODE.test(fields.reason)) out.reason = fields.reason;
  return out;
}

function toResponse(route: ReleaseRoute, error: unknown, version?: string): Response {
  let code: ReleaseErrorCode = "internal";
  let details: Record<string, unknown> | undefined;
  let extra: Record<string, string> | undefined;
  let reason: string | undefined;
  if (error instanceof ReleaseApiError) {
    code = error.code;
    details = error.details;
    reason = error.reason;
    if (error.retryAfter) extra = { "retry-after": String(error.retryAfter) };
  } else if (error instanceof LicenseApiError) {
    // 세션 해석기(licenses)의 오류 중 이 API가 아는 것만 그대로, 나머지는 internal.
    code = (["unauthorized", "account_inactive", "no_org", "42501"] as const).find((c) => c === error.code) ?? "internal";
  } else if (error instanceof DbCallError) {
    code = (["42501", "22023", "P0002"] as const).find((c) => c === error.code) ?? "internal";
  }
  const spec = ERRORS[code];
  const fields = sanitizeReleaseLog({ route, code, status: spec.status, ...(version ? { version } : {}), ...(reason ? { reason } : {}) });
  if (spec.status >= 500) logger.error("release_request_failed", fields);
  else logger.info("release_request_rejected", fields);
  const err = details ? { code, message: spec.message, details } : { code, message: spec.message };
  return json(spec.status, { ok: false, error: err }, extra);
}

async function authorize(req: Request, deps: ReleaseDeps): Promise<ReleaseSession> {
  const session = await deps.session.resolve(req);
  if (!MEMBER_PLUS.has(session.role)) throw new ReleaseApiError("42501");
  return session;
}

async function limit(store: RateLimitStore, bucket: keyof typeof LIMITS, userId: string, nowMs: number) {
  const r = await store.hit(`arch:release:${bucket}:user:${userId}`, LIMITS[bucket], WINDOW_SECONDS, nowMs);
  if (!r.allowed) throw new ReleaseApiError("rate_limited", { retryAfter: Math.max(1, Math.ceil((r.resetAtMs - nowMs) / 1000)) });
}

function packItem(r: EligibleRulePackRow) {
  return { version: r.version, published_at: r.published_at, basis_date: r.basis_date, sha256: r.sha256, kid: r.kid, bytes: r.bytes, status: r.status };
}

/** GET /api/rule-packs?after=<version> */
export async function handleListRulePacks(req: Request, deps: ReleaseDeps): Promise<Response> {
  try {
    const session = await authorize(req, deps);
    const after = new URL(req.url).searchParams.get("after");
    if (after !== null && !VERSION_RE.test(after)) throw new ReleaseApiError("invalid_input");
    await limit(deps.rateLimit, "list", session.userId, deps.now());
    const repo = deps.userRepo(session);
    const rows = (await repo.eligibleRulePacks(session.orgId)).filter((r) => r.status === "published" && VERSION_RE.test(r.version));
    rows.sort((a, b) => compareVersions(b.version, a.version));
    const last = rows[0] ?? null;
    const items = (after ? rows.filter((r) => compareVersions(r.version, after) > 0) : rows).map(packItem);
    // 폴백 배너(PRD 4.3): 마지막 자격 팩 뒤에 게시된 팩들의 개정 제목. 자격이 전부(업데이트 유효)면 대개 0건.
    const changes = await repo.changesPublishedAfter(last?.published_at ?? null, CHANGES_LIMIT);
    return ok({
      items,
      last_eligible: last ? packItem(last) : null,
      changes_after_last_eligible: changes.map((c) => ({ title: c.title, effective_from: c.effective_from })),
    });
  } catch (error) {
    return toResponse("rule_packs", error);
  }
}

/** 서명 URL 멱등 캐시((조직, 대상) → URL). 인스턴스 메모리 — 운영 전 공유 저장소로(계획 공격 P14). */
export class SignedUrlCache {
  readonly #map = new Map<string, { url: string; expiresAtMs: number }>();
  readonly #max: number;
  constructor(max = 10_000) {
    this.#max = max;
  }
  get(key: string, nowMs: number): { url: string; expiresAtMs: number } | null {
    const hit = this.#map.get(key);
    if (!hit) return null;
    if (hit.expiresAtMs - nowMs < REUSE_MIN_REMAINING_MS) {
      this.#map.delete(key);
      return null;
    }
    return hit;
  }
  set(key: string, value: { url: string; expiresAtMs: number }) {
    if (this.#map.size >= this.#max) {
      const oldest = this.#map.keys().next();
      if (!oldest.done) this.#map.delete(oldest.value);
    }
    this.#map.set(key, value);
  }
}

export interface DownloadDeps extends ReleaseDeps {
  urlCache: SignedUrlCache;
}

/** GET /api/rule-packs/{version}/download */
export async function handleRulePackDownload(req: Request, rawVersion: string, deps: DownloadDeps): Promise<Response> {
  const version = VERSION_RE.test(rawVersion) ? rawVersion : undefined;
  try {
    const session = await authorize(req, deps);
    if (!version) throw new ReleaseApiError("invalid_input");
    const nowMs = deps.now();
    await limit(deps.rateLimit, "download", session.userId, nowMs);
    const repo = deps.userRepo(session);
    const eligible = (await repo.eligibleRulePacks(session.orgId)).find((r) => r.version === version && r.status === "published");
    if (!eligible) {
      // 게시돼 있지만 자격 밖 → AR011. 없음·철회 → 404(철회 팩은 내주지 않는다, P4).
      const meta = await repo.rulePackStatus(version);
      throw new ReleaseApiError(meta?.status === "published" ? "AR011" : "P0002");
    }
    const priv = deps.privilegedRepo();
    const object = await priv.rulePackObject(version);
    const path = packStoragePath(version);
    if (!object || object.status !== "published") throw new ReleaseApiError("P0002");
    // 경로·사실 대조(P7·P11): DB storage_path는 버전에서 만든 경로와 정확히 같아야 하고, 자격 행과 객체 행의 값이 같아야 한다.
    if (
      object.storage_path !== path ||
      object.sha256 !== eligible.sha256 ||
      object.bytes !== eligible.bytes ||
      object.kid !== eligible.kid ||
      object.signature !== eligible.signature
    ) {
      throw new ReleaseApiError("internal", { reason: "row_mismatch" });
    }
    const text = await priv.readSmallText(manifestStoragePath(version), MAX_SIGNED_MANIFEST_BYTES);
    if (text === null) throw new ReleaseApiError("internal", { reason: "manifest_missing" });
    const check = checkSignedManifest(text, { version, sha256: object.sha256, bytes: object.bytes, kid: object.kid, signature: object.signature });
    if (!check.ok) throw new ReleaseApiError("internal", { reason: `manifest_${check.reason}`.slice(0, 40) });
    const cacheKey = `${session.orgId}:rule-pack:${version}`;
    let signed = deps.urlCache.get(cacheKey, nowMs);
    if (!signed) {
      signed = { url: await priv.signedUrl(path, SIGNED_URL_SECONDS), expiresAtMs: nowMs + SIGNED_URL_SECONDS * 1000 };
      deps.urlCache.set(cacheKey, signed);
    }
    return ok({
      version,
      url: signed.url,
      expires_at: new Date(signed.expiresAtMs).toISOString(),
      sha256: object.sha256,
      bytes: object.bytes,
      kid: object.kid,
      signature: object.signature,
      signed_manifest: check.text,
    });
  } catch (error) {
    return toResponse("rule_pack_download", error, version);
  }
}

/** GET /api/cost-catalogs/latest — 0행(자격 없음)이면 204. */
export async function handleLatestCostCatalog(req: Request, deps: ReleaseDeps): Promise<Response> {
  try {
    const session = await authorize(req, deps);
    await limit(deps.rateLimit, "cost", session.userId, deps.now());
    const row = await deps.userRepo(session).latestCostCatalog(session.orgId);
    if (!row) return noContent();
    if (!VERSION_RE.test(row.version) || !Array.isArray(row.items)) throw new ReleaseApiError("internal", { reason: "catalog_shape" });
    return ok({ version: row.version, basis_date: row.basis_date, published_at: row.published_at, items: row.items, source_note: row.source_note, sha256: row.sha256 });
  } catch (error) {
    return toResponse("cost_catalog", error);
  }
}

/**
 * GET /api/updates/{target}/{arch}/{current_version} — Tauri 2 동적 업데이트 서버 형식(본문 그대로, 봉투 없음) 또는 204.
 * 현재 빌드가 영구 라이선스의 업데이트 기간 밖이면 AR010(details.last_eligible).
 */
export async function handleUpdateManifest(
  req: Request,
  params: { target: string; arch: string; current: string },
  deps: DownloadDeps,
): Promise<Response> {
  const current = SEMVER.test(params.current) ? params.current : undefined;
  try {
    const session = await authorize(req, deps);
    if (!TARGETS.has(params.target) || !ARCHES.has(params.arch) || !current) throw new ReleaseApiError("invalid_input");
    const platform = `${params.target}-${params.arch}`;
    const nowMs = deps.now();
    await limit(deps.rateLimit, "update", session.userId, nowMs);
    const features = await deps.userRepo(session).orgFeatures(session.orgId);
    const priv = deps.privilegedRepo();
    if ((features.state === "licensed" || features.state === "licensed_fallback") && features.updates_until) {
      const installed = await priv.build(platform, current);
      if (installed && installed.build_date > features.updates_until) {
        const last = await priv.eligibleBuild(session.orgId, platform, "0.0.0");
        throw new ReleaseApiError("AR010", { details: { last_eligible: { version: last?.version ?? null, download_page: "/account/licenses" } } });
      }
    }
    const build = await priv.eligibleBuild(session.orgId, platform, current);
    if (!build) return noContent();
    const expected = /^builds\/stable\/[0-9.]+\/[A-Za-z0-9._-]{1,120}$/;
    if (!expected.test(build.storage_path) || !build.storage_path.startsWith(`builds/stable/${build.version}/`)) {
      throw new ReleaseApiError("internal", { reason: "build_path" });
    }
    const cacheKey = `${session.orgId}:build:${platform}:${build.version}`;
    let signed = deps.urlCache.get(cacheKey, nowMs);
    if (!signed) {
      signed = { url: await priv.signedUrl(build.storage_path, SIGNED_URL_SECONDS), expiresAtMs: nowMs + SIGNED_URL_SECONDS * 1000 };
      deps.urlCache.set(cacheKey, signed);
    }
    return json(200, { version: build.version, notes: build.notes ?? "", pub_date: build.published_at, url: signed.url, signature: build.signature });
  } catch (error) {
    return toResponse("update", error, current);
  }
}
