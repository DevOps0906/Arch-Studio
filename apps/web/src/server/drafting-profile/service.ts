// GET|PUT /api/drafting-profile, POST /api/drafting-profile/logo-upload-url 본체(04_API.md `:31`·`:57-59`, 03장 3.14절).
// 순서(PUT): 인증(401/403) → 역할 owner·admin(AR042 403, RPC 호출 전) → 엔타이틀먼트(402) → 레이트 리밋(429) → 본문 16KB·strict(400/413/422)
// → 로고 경로 소유(23514)·객체 검사(크기·PNG 구조, 415) → arch.upsert_drafting_profile(세션 JWT, p_org = 세션 조직).
// 감사 행은 RPC 안 core.write_audit('drafting_profile.update', 바뀐 키 이름)이 같은 트랜잭션에서 쓴다(서버가 따로 쓰지 않는다 → 위조·이중 기록 경로 없음).
// 조직은 세션에서만. 본문·응답에 org_id·updated_by가 없다. 오류 응답은 코드별 고정 문구(DB·Storage 원문 없음).
// 로고 업로드: 047 `POST /api/uploads/sign`의 목적 목록에 로고가 없고(policy.ts UPLOAD_PURPOSES) 그 코드는 수정 범위 밖이라
// 04_API.md `:59`의 전용 경로를 같은 규약(서버 경로 생성·upsert=false·크기/확장자 사전 검사·사용 시점 재검사)으로 둔다.
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { errorResponse, GatewayError, okResponse, readJsonLimited, type GatewayErrorCode } from "../ai/gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { tokenExpiry } from "../uploads/service.ts";
import { resolveLayerMap } from "./layers.ts";
import { profileLog } from "./log.ts";
import { buildLogoPath, inspectPng, LOGO_MAX_BYTES } from "./png.ts";
import { fromRow, parseProfileInput, toRpcPayload, type DraftingProfileOut } from "./schema.ts";

/** 사용자 JWT(RLS) 저장소. 조직 인자는 항상 세션 조직. */
export interface DraftingProfileRepo {
  /** SELECT arch.drafting_profiles where org_id = orgId(RLS). 없으면 null. */
  get(orgId: string): Promise<unknown | null>;
  /** arch.upsert_drafting_profile(p, p_org). DB 오류는 DbCodeError(SQLSTATE만). */
  upsert(payload: Record<string, unknown>, orgId: string): Promise<unknown>;
}

/** 로고 Storage 포트(service_role: arch-user 버킷에 사용자 정책이 없다, 2400_arch.sql 11절). 경로는 서버가 만든 값만 들어온다. */
export interface LogoStorage {
  createSignedUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  /** 읽기 서명 URL(수명 초). */
  createSignedReadUrl(path: string, ttlSeconds: number): Promise<string>;
  /** 객체 바이트(최대 maxBytes + 1까지). 없으면 null. */
  read(path: string, maxBytes: number): Promise<Uint8Array | null>;
}

export interface DraftingProfileDeps {
  session: GatewaySessionResolver;
  repo(session: GatewaySession): DraftingProfileRepo;
  logos(): LogoStorage;
  rateLimit: RateLimitStore;
  now(): number;
  randomUUID(): string;
}

/** DB `pg_column_size(p) > 16384`와 같은 상한. */
export const PROFILE_MAX_BODY = 16_384;
export const LOGO_URL_MAX_BODY = 1024;
/** 04_API.md 1장 "그 밖의 생성 API 조직당 60회/분". */
export const PROFILE_RATE = { limit: 60, windowS: 60 } as const;
/** GET 응답의 로고 읽기 URL 수명(04_API.md `:57` 서명 10분). */
export const LOGO_READ_TTL_S = 600;
const FALLBACK_UPLOAD_TTL_S = 2 * 3600;

const OWNER_ADMIN = new Set(["owner", "admin"]);
const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

type ProfileErrorCode = GatewayErrorCode | "AR042";

export class ProfileError extends Error {
  readonly code: ProfileErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;
  constructor(code: ProfileErrorCode, details?: Record<string, unknown>, headers?: Record<string, string>) {
    super(code);
    this.name = "ProfileError";
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

const AR042_MESSAGE = "표제란 설정은 조직 owner·admin만 저장합니다.";

function toResponse(error: unknown): Response {
  const e = error instanceof ProfileError ? error : error instanceof GatewayError ? new ProfileError(error.code, error.details, error.headers) : new ProfileError("internal");
  if (e.code === "AR042") {
    return new Response(JSON.stringify({ ok: false, error: { code: "AR042", message: AR042_MESSAGE } }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return errorResponse(e.code, e.details, e.headers);
}

/** DB SQLSTATE → 응답 코드. 모르는 코드는 internal. */
export function mapDbCode(code: unknown): ProfileErrorCode {
  switch (code) {
    case "AR042":
      return "AR042";
    case "22023":
      return "22023";
    case "23514":
      return "23514";
    case "42501":
      return "42501";
    default:
      return "internal";
  }
}

function dbCode(error: unknown): string | undefined {
  const c = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof c === "string" ? c : undefined;
}

async function rate(deps: DraftingProfileDeps, bucket: string, orgId: string) {
  const hit = await deps.rateLimit.hit(`arch:${bucket}:${orgId}`, PROFILE_RATE.limit, PROFILE_RATE.windowS, deps.now());
  if (!hit.allowed) {
    throw new ProfileError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
  }
}

/** 응답 경고: 저장 정규화 경고(PUT) 또는 저장된 map의 정본 경고(GET). 값은 사용자 자신의 입력이라 그대로 돌려준다. */
function storedWarnings(p: DraftingProfileOut) {
  return resolveLayerMap(p.layer_map as Record<string, string>).warnings.filter((w) => w.kind === "name_conflict");
}

async function logoUrl(deps: DraftingProfileDeps, p: DraftingProfileOut | null): Promise<string | null> {
  if (!p?.logo_storage_path) return null;
  try {
    return await deps.logos().createSignedReadUrl(p.logo_storage_path, LOGO_READ_TTL_S);
  } catch {
    return null; // 로고 URL 실패는 프로필 조회를 막지 않는다(화면은 "로고 불러오기 실패"로 표시)
  }
}

export async function handleGetProfile(req: Request, deps: DraftingProfileDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    if (!MEMBER_PLUS.has(session.role)) throw new ProfileError("42501");
    let row: unknown;
    try {
      row = await deps.repo(session).get(session.orgId);
    } catch (e) {
      throw new ProfileError(mapDbCode(dbCode(e)));
    }
    const parsed = row === null ? null : fromRow(row);
    if (row !== null && parsed === null) throw new ProfileError("internal");
    const profile = parsed?.profile ?? null;
    return okResponse({
      profile,
      updated_at: parsed?.updated_at ?? null,
      logo_url: await logoUrl(deps, profile),
      can_edit: OWNER_ADMIN.has(session.role),
      layer_warnings: profile ? storedWarnings(profile) : [],
    });
  } catch (error) {
    profileLog.warn("drafting_profile.get_rejected", { route: "drafting_profile_get", code: error instanceof ProfileError || error instanceof GatewayError ? error.code : "internal" });
    return toResponse(error);
  }
}

export async function handlePutProfile(req: Request, deps: DraftingProfileDeps): Promise<Response> {
  let field: string | undefined;
  try {
    const session = await deps.session.resolve(req);
    if (!OWNER_ADMIN.has(session.role)) throw new ProfileError("AR042");
    if (!session.entitled) throw new ProfileError("entitlement_expired", { can_download: true });
    await rate(deps, "drafting_profile_put", session.orgId);
    const parsed = parseProfileInput(await readJsonLimited(req, PROFILE_MAX_BODY), session.orgId);
    if (!parsed.ok) {
      field = parsed.field;
      throw new ProfileError(parsed.code);
    }
    const repo = deps.repo(session);
    const next = parsed.profile;
    if (next.logo_storage_path) {
      // 저장된 로고와 같으면 다시 받지 않는다(이미 검사를 통과해 저장된 값).
      let current: DraftingProfileOut | null = null;
      try {
        const row = await repo.get(session.orgId);
        current = row === null ? null : (fromRow(row)?.profile ?? null);
      } catch (e) {
        throw new ProfileError(mapDbCode(dbCode(e)));
      }
      if (current?.logo_storage_path !== next.logo_storage_path) {
        let bytes: Uint8Array | null;
        try {
          bytes = await deps.logos().read(next.logo_storage_path, LOGO_MAX_BYTES);
        } catch {
          throw new ProfileError("storage_unavailable");
        }
        field = "logo_storage_path";
        if (bytes === null) throw new ProfileError("23514");
        const png = inspectPng(bytes);
        if (!png.ok) throw new ProfileError(png.reason === "too_large" ? "AR031" : "unsupported_media_type", png.reason === "too_large" ? { max_bytes: LOGO_MAX_BYTES } : undefined);
        field = undefined;
      }
    }
    let row: unknown;
    try {
      row = await repo.upsert(toRpcPayload(next), session.orgId);
    } catch (e) {
      throw new ProfileError(mapDbCode(dbCode(e)));
    }
    const saved = fromRow(row);
    if (!saved) throw new ProfileError("internal");
    profileLog.info("drafting_profile.updated", { route: "drafting_profile_put", keys: Object.keys(toRpcPayload(next)), warnings: parsed.warnings.length });
    return okResponse({
      profile: saved.profile,
      updated_at: saved.updated_at,
      logo_url: await logoUrl(deps, saved.profile),
      can_edit: true,
      layer_warnings: [...parsed.warnings.filter((w) => w.kind !== "name_conflict"), ...storedWarnings(saved.profile)],
    });
  } catch (error) {
    const code = error instanceof ProfileError || error instanceof GatewayError ? error.code : "internal";
    profileLog.warn("drafting_profile.put_rejected", { route: "drafting_profile_put", code, ...(field ? { field } : {}) });
    return toResponse(error);
  }
}

export const logoUrlSchema = z
  .object({
    ext: z.string().regex(/^[a-z0-9]{1,8}$/),
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export async function handleLogoUploadUrl(req: Request, deps: DraftingProfileDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    if (!OWNER_ADMIN.has(session.role)) throw new ProfileError("AR042");
    if (!session.entitled) throw new ProfileError("entitlement_expired", { can_download: true });
    await rate(deps, "drafting_logo_url", session.orgId);
    const parsed = logoUrlSchema.safeParse(await readJsonLimited(req, LOGO_URL_MAX_BODY));
    if (!parsed.success) throw new ProfileError("invalid_input");
    if (parsed.data.ext !== "png") throw new ProfileError("unsupported_media_type");
    if (parsed.data.bytes > LOGO_MAX_BYTES) throw new ProfileError("AR031", { max_bytes: LOGO_MAX_BYTES });
    const path = buildLogoPath(session.orgId, deps.randomUUID());
    if (!path) throw new ProfileError("internal");
    let signed: { signedUrl: string; token: string };
    try {
      signed = await deps.logos().createSignedUploadUrl(path);
    } catch {
      throw new ProfileError("storage_unavailable");
    }
    const exp = tokenExpiry(signed.token) ?? Math.floor(deps.now() / 1000) + FALLBACK_UPLOAD_TTL_S;
    profileLog.info("drafting_logo.issued", { route: "drafting_logo_url" });
    return okResponse({ signed_upload_url: signed.signedUrl, path, expires_at: new Date(exp * 1000).toISOString() });
  } catch (error) {
    const code = error instanceof ProfileError || error instanceof GatewayError ? error.code : "internal";
    profileLog.warn("drafting_logo.rejected", { route: "drafting_logo_url", code });
    return toResponse(error);
  }
}
