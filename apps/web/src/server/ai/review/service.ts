// POST /api/ai/review 본체(04_API.md 2.1절 review 행, AR-06-051 B1). 순서:
// 실패 닫힘 스위치(503, 인증보다 먼저) → 인증 → 본문 읽기(256KB 초과 AR031) → zod strict(422) → 역할 member+(403)
// → 엔타이틀먼트(402) → 레이트 리밋(429, 권한 없는 요청이 한도를 소모하지 못하게 뒤에 둔다) → 본문 rule_context 일치(422) → 규칙 팩 확인(eligible_rule_packs 대조 · sha256 · 서명, 실패 닫힘 503)
// → packages/rules judge() 서버 재계산 → arch.start_ai_run(재계산 결과만 options에, 차감은 그 안에서만) → 202.
// 데스크톱이 보낸 JudgmentResult는 읽지도 저장하지도 않는다(불신, 06_AGENT_PLAN 051). 조직·행위자는 세션에서만.
// 응답·로그에 본문·팩 내용·키·예외 원문을 넣지 않는다. server-only를 import하지 않는다(node --test 대상).
import { judge, loadRulePack, RulesError } from "@arch-studio/rules";
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { checkSignedManifest, manifestStoragePath, MAX_PACK_BYTES, MAX_SIGNED_MANIFEST_BYTES, packStoragePath, sha256Hex, VERSION_RE } from "../../rule-packs/manifest.ts";
import type { ReleasePrivilegedRepo, ReleaseUserRepo } from "../../rule-packs/types.ts";
import { parseRulePackPubKeys, verifySignedManifest } from "../../rule-packs/verify.ts";
import { errorResponse, GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import { startAiRun, type RunStarter } from "../gateway/start-run.ts";

export interface ReviewDeps {
  /** 실패 닫힘 스위치(ARCH_AI_REVIEW_ENABLED). 요청마다 읽는다. */
  enabled(): boolean;
  session: GatewaySessionResolver;
  /** 사용자 JWT(RLS) — eligible_rule_packs. */
  userRepo(session: GatewaySession): Pick<ReleaseUserRepo, "eligibleRulePacks">;
  /** service_role — arch-releases 비공개 버킷 읽기. */
  privilegedRepo(): Pick<ReleasePrivilegedRepo, "readSmallText">;
  /** 운영 공개키 `kid:hex64,…`(ARCH_RULEPACK_PUBKEYS). 없으면 실패 닫힘. */
  pubKeys(): string | undefined;
  starter(): RunStarter;
  rateLimit: RateLimitStore;
  now(): number;
}

/** 04_API.md 2.1절 review 행 "≤256KB". */
export const REVIEW_MAX_BODY = 256 * 1024;
/** 조직·사용자별 10회/분(한 사용자가 조직 전체 한도를 소진하지 못하게 키에 userId 포함). */
export const REVIEW_RATE = { limit: 10, windowS: 60 } as const;
// 운영 차단: 기본 메모리 저장소는 단일 인스턴스 전제다. 공유 저장소(core.rate_limit_hit 또는 Redis)로의 교체는
// 운영 배포 전에 막는다(040·042·047 공통, tasks/logs/AR-06-051.md).

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

export const reviewRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    project_ref: z.string().regex(UUID_RE),
    rule_pack_version: z.string().regex(VERSION_RE),
    application_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    municipality_code: z.string().min(1).max(40),
    /** DesignModelV1. 모양 검사는 judge()가 한다(domain 스키마가 정본). 아래는 일치 검사용 최소 모양만. */
    model: z
      .object({ rule_context: z.object({ rule_pack_version: z.string(), application_date: z.string(), municipality_code: z.string() }).passthrough() })
      .passthrough(),
    /** 데스크톱 판정 결과: 받아도 버린다(불신). 이전 클라이언트 호환을 위해 필드만 허용. */
    judgment: z.unknown().optional(),
  })
  .strict();

type ReviewOnlyCode = "ai_review_disabled" | "rule_pack_unavailable";

const REVIEW_ERRORS: Readonly<Record<ReviewOnlyCode, { status: number; message: string }>> = {
  ai_review_disabled: { status: 503, message: "지금은 클라우드 법규 검토를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다." },
  rule_pack_unavailable: { status: 503, message: "규칙 팩을 확인하지 못했습니다. 크레딧은 차감되지 않았습니다." },
};

class ReviewReject extends Error {
  readonly code: ReviewOnlyCode;
  readonly reason: string | undefined;
  constructor(code: ReviewOnlyCode, reason?: string) {
    super(code);
    this.name = "ReviewReject";
    this.code = code;
    this.reason = reason;
  }
}

function reviewReject(code: ReviewOnlyCode): Response {
  const spec = REVIEW_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function logReject(code: string, reason?: string): void {
  // 허용 목록 필드만(고정 목록 값). 본문·경로·키는 넣지 않는다.
  const safe = (v: string) => (/^[A-Za-z0-9_]{1,40}$/.test(v) ? v : "internal");
  logger.warn("ai_review.rejected", { route: "ai_review", code: safe(code), ...(reason ? { reason: safe(reason) } : {}) });
}

/** 서명·해시 검증을 마친 규칙 팩 본문(JSON). 하나라도 어긋나면 ReviewReject(차감 전). */
async function loadVerifiedPack(deps: ReviewDeps, session: GatewaySession, version: string): Promise<unknown> {
  const row = (await deps.userRepo(session).eligibleRulePacks(session.orgId)).find((r) => r.version === version && r.status === "published");
  if (!row) throw new GatewayError("invalid_input"); // 자격 없음·없는 버전·철회: 내용을 구분해 알리지 않는다
  const keys = parseRulePackPubKeys(deps.pubKeys());
  if (keys.size === 0) throw new ReviewReject("rule_pack_unavailable", "pubkey_unconfigured");
  const priv = deps.privilegedRepo();
  const manifestText = await priv.readSmallText(manifestStoragePath(version), MAX_SIGNED_MANIFEST_BYTES);
  if (manifestText === null) throw new ReviewReject("rule_pack_unavailable", "manifest_missing");
  const checked = checkSignedManifest(manifestText, row);
  if (!checked.ok) throw new ReviewReject("rule_pack_unavailable", "manifest_mismatch");
  const sig = verifySignedManifest(manifestText, keys);
  if (!sig.ok) throw new ReviewReject("rule_pack_unavailable", sig.reason);
  const packText = await priv.readSmallText(packStoragePath(version), MAX_PACK_BYTES);
  if (packText === null) throw new ReviewReject("rule_pack_unavailable", "pack_missing");
  const bytes = Buffer.from(packText, "utf8");
  if (bytes.byteLength !== row.bytes || sha256Hex(bytes) !== row.sha256) throw new ReviewReject("rule_pack_unavailable", "pack_hash_mismatch");
  try {
    return JSON.parse(packText);
  } catch {
    throw new ReviewReject("rule_pack_unavailable", "pack_json");
  }
}

export async function handleReview(req: Request, deps: ReviewDeps): Promise<Response> {
  try {
    // 0) 실패 닫힘: 스위치가 켜져 있지 않으면 아무것도 읽지 않고 503(차감 0).
    if (!deps.enabled()) throw new ReviewReject("ai_review_disabled");

    const session = await deps.session.resolve(req);
    let raw: unknown;
    try {
      raw = await readJsonLimited(req, REVIEW_MAX_BODY);
    } catch (error) {
      if (error instanceof GatewayError && error.code === "payload_too_large") throw new GatewayError("AR031", { max_bytes: REVIEW_MAX_BODY });
      throw error;
    }
    const parsed = reviewRequestSchema.safeParse(raw);
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });
    const hit = await deps.rateLimit.hit(`arch:ai_review:${session.orgId}:${session.userId}`, REVIEW_RATE.limit, REVIEW_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }

    // 판정은 model.rule_context로 돈다. 바깥 필드(DB 컬럼·start_ai_run 검사용)와 다르면 어느 쪽도 믿지 않는다.
    const ctx = input.model.rule_context;
    if (ctx.rule_pack_version !== input.rule_pack_version || ctx.application_date !== input.application_date || ctx.municipality_code !== input.municipality_code) {
      throw new GatewayError("invalid_input");
    }

    const pack = loadRulePack(await loadVerifiedPack(deps, session, input.rule_pack_version));
    if (pack.version !== input.rule_pack_version) throw new ReviewReject("rule_pack_unavailable", "pack_version_mismatch");
    // pendingChanges는 폴백 배너용 서버 값이다. 이 경로는 쓰지 않으므로 0(데스크톱 값은 쓰지 않는다).
    let result: ReturnType<typeof judge>["result"];
    try {
      ({ result } = judge(input.model as unknown as Parameters<typeof judge>[0], pack, { pendingChanges: 0 }));
    } catch (error) {
      // 본문(DesignModel) 입력 오류는 RulesError뿐 아니라 zod 등 다른 예외로도 올 수 있다 → 모두 422(원문은 로그에 남기지 않는다).
      if (error instanceof RulesError) throw error;
      throw new GatewayError("invalid_input");
    }

    const run = await startAiRun(deps.starter(), {
      orgId: session.orgId,
      actorId: session.userId,
      kind: "review",
      variant: "review",
      requestId: input.request_id,
      projectRef: input.project_ref,
      options: {
        rule_pack_version: input.rule_pack_version,
        application_date: input.application_date,
        municipality_code: input.municipality_code,
        judgment: result,
      },
    });
    return okResponse(run, 202);
  } catch (error) {
    if (error instanceof ReviewReject) {
      logReject(error.code, error.reason);
      return reviewReject(error.code);
    }
    if (error instanceof RulesError) {
      logReject("invalid_input", error.code);
      return errorResponse("invalid_input");
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
