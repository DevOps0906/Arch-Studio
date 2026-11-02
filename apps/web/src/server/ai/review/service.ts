// POST /api/ai/review 본체(04_API.md 2.1절 review 행, AR-06-051). 순서:
// 실패 닫힘 스위치(503, 인증보다 먼저) → 인증(401/403) → 본문 zod strict ≤256KB(400/413/422) → 레이트 리밋(조직 10회/분, 제안, 429)
// → 역할 member+(403) → 엔타이틀먼트·기능 cloud_review(아니면 AR012 403: 폴백·만료) → rule_context 일치(22023)
// → 서버 규칙 팩 로드(같은 버전, 없으면 22023) → packages/rules 재계산 → arch.start_ai_run(차감·enqueue는 그 안에서만) → 202.
// 클라이언트가 보낸 judgment·model_summary는 받기만 하고 쓰지 않는다(서버 재계산 값만 저장, 02_ARCHITECTURE.md 4장).
// 차감은 start_ai_run 한 곳에서만 일어나므로 그 앞의 모든 거부는 차감 0이다. 같은 request_id 재전송은 DB가 기존 실행을 돌려준다
// (추가 차감·추가 잡 없음, 다른 조직이면 42501 — 차감 키 consume:arch:<request_id>와 실행 행 request_id unique가 한 트랜잭션).
// 조직·행위자는 세션에서만. 응답·로그에 판정 값·주소·토큰·예외 원문을 넣지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import { errorResponse, GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import { startAiRun, type RunStarter } from "../gateway/start-run.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { VERSION_RE } from "../../rule-packs/manifest.ts";
import { recomputeJudgment, type RulePack } from "./recompute.ts";

/** 사용자 JWT 클라이언트(RLS). 기능 판정. */
export interface ReviewOrgRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
}

/** 서버 규칙 팩(게시된 버전만, 저장소 원문 sha256·크기 대조 후). 없거나 게시 상태가 아니면 null. 그 밖의 오류는 throw. */
export interface RulePackSource {
  load(version: string): Promise<RulePack | null>;
}

export interface ReviewDeps {
  /** 실패 닫힘 스위치(ARCH_AI_REVIEW_ENABLED + 그래프 서버 주소). 요청마다 읽는다. */
  enabled(): boolean;
  session: GatewaySessionResolver;
  org(session: GatewaySession): ReviewOrgRepo;
  packs(): RulePackSource;
  starter(): RunStarter;
  rateLimit: RateLimitStore;
  now(): number;
}

/** 04_API.md 2.1절 review 행 "≤256KB(제안)". DB 판정 칸 상한과 같다. */
export const REVIEW_MAX_BODY = 256 * 1024;
/** 제안 값(04_API에 없음): 검토는 15크레딧 정액이라 렌더(20/분)보다 낮게. */
export const REVIEW_RATE = { limit: 10, windowS: 60 } as const;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MUNICIPALITY_RE = /^[0-9]{5,10}$/;

export const reviewRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    project_ref: z.string().regex(UUID_RE),
    rule_pack_version: z.string().regex(VERSION_RE),
    application_date: z.string().regex(ISO_DATE_RE),
    municipality_code: z.string().regex(MUNICIPALITY_RE),
    /** 서버가 다시 판정할 원본. 모양 검사는 recomputeJudgment(designModelV1Schema strict)가 한다. */
    design_model: z.record(z.string(), z.unknown()),
    /** 데스크톱 판정·요약(04_API 계약 필드). 받기만 하고 쓰지 않는다. */
    judgment: z.unknown().optional(),
    model_summary: z.unknown().optional(),
  })
  .strict();

type ReviewOnlyCode = "ai_review_disabled";

const REVIEW_ERRORS: Readonly<Record<ReviewOnlyCode, { status: number; message: string }>> = {
  ai_review_disabled: { status: 503, message: "지금은 클라우드 검토를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다." },
};

class ReviewReject extends Error {
  readonly code: ReviewOnlyCode;
  constructor(code: ReviewOnlyCode) {
    super(code);
    this.name = "ReviewReject";
    this.code = code;
  }
}

function reviewReject(code: ReviewOnlyCode): Response {
  const spec = REVIEW_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function logReject(code: string): void {
  // 허용 목록 필드만(코드는 고정 목록 값). 판정 값·주소·본문·토큰은 넣지 않는다.
  logger.warn("ai_review.rejected", { route: "ai_review", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

/** rule_context가 본문 버전·기준일·지자체와 같아야 한다(다른 값으로 판정해 저장하는 것을 막는다). */
function contextOf(model: Record<string, unknown>): Record<string, unknown> | null {
  const ctx = model["rule_context"];
  return ctx !== null && typeof ctx === "object" && !Array.isArray(ctx) ? (ctx as Record<string, unknown>) : null;
}

async function loadPack(source: RulePackSource, version: string): Promise<RulePack> {
  let pack: RulePack | null;
  try {
    pack = await source.load(version);
  } catch {
    throw new GatewayError("storage_unavailable");
  }
  if (!pack || pack.version !== version) throw new GatewayError("22023");
  return pack;
}

export async function handleReview(req: Request, deps: ReviewDeps): Promise<Response> {
  try {
    // 0) 실패 닫힘: 스위치가 켜져 있지 않으면 아무것도 읽지 않고 503(차감 0).
    if (!deps.enabled()) throw new ReviewReject("ai_review_disabled");

    const session = await deps.session.resolve(req);
    const parsed = reviewRequestSchema.safeParse(await readJsonLimited(req, REVIEW_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    const hit = await deps.rateLimit.hit(`arch:ai_review:${session.orgId}`, REVIEW_RATE.limit, REVIEW_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");

    // 1) 폴백·만료·플랜 밖: AR012(04_API.md 2.1절 review 행). DB(start_ai_run)도 cloud_review로 같은 판정을 한다.
    if (!session.entitled) throw new GatewayError("AR012");
    const features = await deps.org(session).orgFeatures(session.orgId);
    if (features.cloud_review !== true) throw new GatewayError("AR012");

    // 2) 본문 rule_context = 본문 버전·기준일·지자체.
    const ctx = contextOf(input.design_model);
    if (
      !ctx ||
      ctx["rule_pack_version"] !== input.rule_pack_version ||
      ctx["application_date"] !== input.application_date ||
      ctx["municipality_code"] !== input.municipality_code
    ) {
      throw new GatewayError("22023");
    }

    // 3) 서버 재계산(같은 엔진·같은 팩 버전). 클라이언트 judgment·model_summary는 여기서 버린다.
    const pack = await loadPack(deps.packs(), input.rule_pack_version);
    const server = recomputeJudgment(input.design_model, pack);

    // 4) 차감·enqueue(멱등: request_id). 크레딧 부족 CR001, 일일 상한 AI_DAILY_LIMIT, 기능 AR012는 DB가 다시 정한다.
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
        judgment: server.judgment,
        model_summary: server.summary,
      },
    });
    return okResponse(run, 202);
  } catch (error) {
    if (error instanceof ReviewReject) {
      logReject(error.code);
      return reviewReject(error.code);
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
