// POST /api/ai/render 본체(04_API.md 2.1절 render 행, AR-06-056 0·1단계). 순서:
// 실패 닫힘 스위치(503, 인증보다 먼저) → 인증(401/403) → 본문 zod strict(400/413/422) → 레이트 리밋(조직 20회/분, 429)
// → 역할 member+(403) → 엔타이틀먼트(402) → 기능 ai_render(402) → quality 'standard'만(22023, 결정 전까지 high·upscale 거부)
// → 국외 이전 동의(AI002 403, 01_PRD.md:265) → 입력 경로 모양(23514) → 객체 재검사(존재 23514 · 10MB AR031 · PNG 매직바이트 415
// · IHDR 폭·높이 ≤ render_max_px AR031) → arch.start_ai_run(차감·enqueue는 그 안에서만) → 202.
// 차감은 start_ai_run 한 곳에서만 일어나므로 그 앞의 모든 거부는 차감 0이다. 출력은 PNG 고정(워커가 정함, 요청에 형식 필드 없음).
// 조직·행위자는 세션에서만. 응답·로그에 경로·토큰·예외 원문을 넣지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import { errorResponse, GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import { startAiRun, type RunStarter } from "../gateway/start-run.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { isServerUploadPath, PURPOSE_POLICIES } from "../../uploads/policy.ts";
import { hasPngSignature, PNG_HEAD_BYTES, readPngSize } from "./png.ts";

/** render_input 객체 읽기(service_role: arch-user 버킷에 사용자 정책이 없다, 2400_arch.sql 11절). 경로는 모양 검사를 통과한 값만. */
export interface RenderInputStore {
  /** 객체 크기(바이트). 객체가 없으면 null. 그 밖의 오류는 throw. */
  size(path: string): Promise<number | null>;
  /** 앞 n바이트(객체가 n보다 짧으면 있는 만큼). */
  head(path: string, n: number): Promise<Uint8Array>;
}

/** 사용자 JWT 클라이언트(RLS). 기능 판정과 국외 이전 동의 조회. */
export interface RenderOrgRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
  /** core.ai_org_settings.cross_border_ack_at이 있는가. */
  hasCrossBorderAck(orgId: string): Promise<boolean>;
}

export interface RenderDeps {
  /** 실패 닫힘 스위치(ARCH_AI_RENDER_ENABLED). 요청마다 읽는다. */
  enabled(): boolean;
  session: GatewaySessionResolver;
  org(session: GatewaySession): RenderOrgRepo;
  inputs(): RenderInputStore;
  starter(): RunStarter;
  rateLimit: RateLimitStore;
  now(): number;
}

export const RENDER_MAX_BODY = 4096;
/** 04_API.md 2.1절 render 행 "429(조직 20회/분)". */
export const RENDER_RATE = { limit: 20, windowS: 60 } as const;
/** render_input 상한(업로드 정책과 같은 값, 10MB). */
export const RENDER_INPUT_MAX_BYTES = PURPOSE_POLICIES.render_input.maxBytes;
/** org_features에 render_max_px가 없을 때 DB와 같은 기본값(start_ai_run feature_int 기본 1024). */
export const DEFAULT_RENDER_MAX_PX = 1024;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);

// preset 값 목록(enum)은 04_API에 이름만 있고 값이 없다 → 짧은 소문자 단어만 받는다(값 목록 결정 후 enum으로 좁힌다).
const presetWord = z.string().regex(/^[a-z0-9_]{1,32}$/);

export const renderRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    project_ref: z.string().regex(UUID_RE),
    quality: z.enum(["standard", "high", "upscale"]),
    preset: z.object({ material: presetWord, time_of_day: presetWord, season: presetWord, style: presetWord.optional() }).strict(),
    inputs: z.union([
      z.object({ depth_path: z.string().min(1).max(300), edge_path: z.string().min(1).max(300) }).strict(),
      z.object({ source_render_id: z.string().regex(UUID_RE) }).strict(),
    ]),
  })
  .strict();

/** 게이트 공용 코드에 없는 렌더 전용 거부(http.ts는 소유 밖이라 같은 봉투로 여기서 만든다). */
type RenderOnlyCode = "ai_render_disabled" | "AI002";

const RENDER_ERRORS: Readonly<Record<RenderOnlyCode, { status: number; message: string }>> = {
  ai_render_disabled: { status: 503, message: "지금은 AI 렌더를 사용할 수 없습니다. 크레딧은 차감되지 않았습니다." },
  AI002: { status: 403, message: "AI 국외 이전 동의가 필요합니다. 조직 관리자가 동의한 뒤 다시 시도하세요." },
};

class RenderReject extends Error {
  readonly code: RenderOnlyCode;
  constructor(code: RenderOnlyCode) {
    super(code);
    this.name = "RenderReject";
    this.code = code;
  }
}

function renderReject(code: RenderOnlyCode): Response {
  const spec = RENDER_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function maxPxOf(features: Record<string, unknown>): number {
  const v = features.render_max_px;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : DEFAULT_RENDER_MAX_PX;
}

/** 입력 객체 1개 재검사. 실패는 GatewayError(차감 전). */
async function recheckInput(store: RenderInputStore, orgId: string, path: string, maxPx: number): Promise<void> {
  if (!isServerUploadPath(orgId, "render_input", path)) throw new GatewayError("23514");
  let size: number | null;
  let head: Uint8Array;
  try {
    size = await store.size(path);
    if (size === null) throw new GatewayError("23514");
    if (size > RENDER_INPUT_MAX_BYTES) throw new GatewayError("AR031", { max_bytes: RENDER_INPUT_MAX_BYTES });
    head = await store.head(path, PNG_HEAD_BYTES);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError("storage_unavailable");
  }
  if (!hasPngSignature(head)) throw new GatewayError("unsupported_media_type");
  const dim = readPngSize(head);
  if (!dim) throw new GatewayError("unsupported_media_type");
  if (dim.width > maxPx || dim.height > maxPx) throw new GatewayError("AR031", { max_px: maxPx });
}

function logReject(code: string): void {
  // 허용 목록 필드만(코드는 고정 목록 값). 경로·본문·토큰은 넣지 않는다.
  logger.warn("ai_render.rejected", { route: "ai_render", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

export async function handleRender(req: Request, deps: RenderDeps): Promise<Response> {
  try {
    // 0) 실패 닫힘: 스위치가 켜져 있지 않으면 아무것도 읽지 않고 503(차감 0).
    if (!deps.enabled()) throw new RenderReject("ai_render_disabled");

    const session = await deps.session.resolve(req);
    const parsed = renderRequestSchema.safeParse(await readJsonLimited(req, RENDER_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    const hit = await deps.rateLimit.hit(`arch:ai_render:${session.orgId}`, RENDER_RATE.limit, RENDER_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const org = deps.org(session);
    const features = await org.orgFeatures(session.orgId);
    if (features.ai_render !== true) throw new GatewayError("feature_unavailable", { can_download: true });

    // 고품질 제공자 경로·업스케일은 [DECISION] 전까지 거부(DB 호출 전, 차감 0).
    if (input.quality !== "standard" || !("depth_path" in input.inputs)) throw new GatewayError("22023");

    // 1) 국외 이전 동의: 상용 제공자(fal)로 입력 이미지를 보내기 전 조건(01_PRD.md:265). 오픈소스 렌더 경로가 없으므로 거부.
    if (!(await org.hasCrossBorderAck(session.orgId))) throw new RenderReject("AI002");

    // 2) 업로드 사용 시점 재검사(서명 URL 수명이 길어 업로드 시점 검사만으로는 부족, tasks/logs/AR-06-047.md P9).
    const maxPx = maxPxOf(features);
    const store = deps.inputs();
    const { depth_path, edge_path } = input.inputs;
    await recheckInput(store, session.orgId, depth_path, maxPx);
    await recheckInput(store, session.orgId, edge_path, maxPx);

    // 3) 차감·enqueue(멱등: request_id). 동시 3건 초과 AR030, 크레딧 부족 CR001, 일일 상한 AI_DAILY_LIMIT은 DB가 정한다.
    const run = await startAiRun(deps.starter(), {
      orgId: session.orgId,
      actorId: session.userId,
      kind: "render",
      variant: "render_std",
      requestId: input.request_id,
      projectRef: input.project_ref,
      options: { preset: input.preset, inputs: { depth_path, edge_path } },
    });
    return okResponse(run, 202);
  } catch (error) {
    if (error instanceof RenderReject) {
      logReject(error.code);
      return renderReject(error.code);
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
