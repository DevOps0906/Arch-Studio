// POST /api/uploads/sign 본체(04_API.md 2.1절). 순서: 인증(401/403) → 본문 zod strict(400/413/422) → 레이트 리밋(429)
// → 역할 member+(403) → 엔타이틀먼트·목적별 기능(402) → 확장자(415)·크기(413 AR031) → 서버 경로 생성 → 서명 업로드 URL.
// 조직은 세션에서만. 본문에는 경로·파일명·org_id가 없다(strict로 거부).
// 서명 URL: upsert=false(같은 경로 덮어쓰기 불가), 경로마다 새 UUID. 수명은 Storage 서버 고정값(Supabase 2시간)이라 짧게 할 수 없다:
// 응답 expires_at은 Storage 토큰의 exp를 그대로 알리고, 사용 시점에 서버가 크기·MIME·매직바이트·조직 폴더를 다시 검사한다(04_API 1장).
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE } from "../ai/gateway/http.ts";
import { gatewayLog } from "../ai/gateway/log.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";
import { buildUploadPath, policyFor, UPLOAD_PURPOSES, type PurposePolicy } from "./policy.ts";

/** Storage 서명 포트(service_role: 버킷에 사용자 정책이 없어 서버 서명만 가능, 2400_arch.sql 11절). */
export interface UploadSigner {
  createSignedUploadUrl(bucket: PurposePolicy["bucket"], path: string): Promise<{ signedUrl: string; token: string }>;
}

/** 사용자 JWT 클라이언트(RLS). 기능 판정 arch.org_features만. */
export interface UploadFeatureRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
}

export interface UploadDeps {
  session: GatewaySessionResolver;
  features(session: GatewaySession): UploadFeatureRepo;
  signer(): UploadSigner;
  rateLimit: RateLimitStore;
  now(): number;
  randomUUID(): string;
}

export const UPLOAD_SIGN_MAX_BODY = 1024;
/** "그 밖의 생성 API 조직당 60회/분"(04_API.md 1장 레이트 리밋). */
export const UPLOAD_SIGN_RATE = { limit: 60, windowS: 60 } as const;
/** Storage가 exp를 알려주지 않을 때의 보수적 값(Supabase 서명 업로드 URL 수명 2시간). */
export const FALLBACK_UPLOAD_TTL_S = 2 * 3600;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

export const uploadSignSchema = z
  .object({
    purpose: z.enum(UPLOAD_PURPOSES),
    project_ref: z.string().regex(UUID_RE).optional(),
    ext: z.string().regex(/^[a-z0-9]{1,8}$/),
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

/** Storage 서명 토큰(JWT)의 exp. 검증하지 않고 읽기만(표시용). 실패하면 null. */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    const exp = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isSafeInteger(exp) ? exp : null;
  } catch {
    return null;
  }
}

export async function handleUploadSign(req: Request, deps: UploadDeps): Promise<Response> {
  let purposeForLog: string | undefined;
  try {
    const session = await deps.session.resolve(req);
    const parsed = uploadSignSchema.safeParse(await readJsonLimited(req, UPLOAD_SIGN_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;
    purposeForLog = input.purpose;

    const hit = await deps.rateLimit.hit(`arch:uploads_sign:${session.orgId}`, UPLOAD_SIGN_RATE.limit, UPLOAD_SIGN_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const policy = policyFor(input.purpose) as PurposePolicy;
    if (policy.feature) {
      const features = await deps.features(session).orgFeatures(session.orgId);
      if (features[policy.feature] !== true) throw new GatewayError("feature_unavailable", { can_download: true });
    }
    if (!policy.exts.includes(input.ext)) throw new GatewayError("unsupported_media_type");
    if (input.bytes > policy.maxBytes) throw new GatewayError("AR031", { max_bytes: policy.maxBytes });

    const built = buildUploadPath({ orgId: session.orgId, purpose: input.purpose, ext: input.ext, projectRef: input.project_ref, objectId: deps.randomUUID() });
    if (!built.ok) throw new GatewayError(built.reason === "ext" ? "unsupported_media_type" : built.reason === "project_ref" ? "invalid_input" : "internal");

    let signed: { signedUrl: string; token: string };
    try {
      signed = await deps.signer().createSignedUploadUrl(policy.bucket, built.path);
    } catch {
      throw new GatewayError("storage_unavailable");
    }
    const exp = tokenExpiry(signed.token) ?? Math.floor(deps.now() / 1000) + FALLBACK_UPLOAD_TTL_S;
    gatewayLog.info("uploads_sign.issued", { route: "uploads_sign", purpose: input.purpose });
    return okResponse({ signed_upload_url: signed.signedUrl, path: built.path, expires_at: new Date(exp * 1000).toISOString() });
  } catch (error) {
    const code = error instanceof GatewayError ? error.code : "internal";
    gatewayLog.warn("uploads_sign.rejected", { route: "uploads_sign", code, ...(purposeForLog ? { purpose: purposeForLog } : {}) });
    return toErrorResponse(error);
  }
}
