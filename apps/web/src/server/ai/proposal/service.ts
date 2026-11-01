// POST /api/ai/proposal 본체(04_API.md 2.1절 proposal 행, AR-06-032 1단계). 순서:
// 실패 닫힘 스위치(503, 인증보다 먼저) → 인증(401/403) → 본문 zod strict(≤512KB, 400/413/422) → 레이트 리밋(조직 20회/분, 429, 제안)
// → 역할 member+(403) → 엔타이틀먼트(402) → 기능 ai_render(402, DB start_ai_run도 proposal에 ai_render를 본다)
// → render_ids 비어 있음만(22023, 렌더 이미지 삽입은 1단계 범위 밖) → 국외 이전 동의(kind='proposal'이고 서술이 국외 제공자일 때만, AI002 403)
// → 시트 재검사(경로 모양 23514 · 존재 23514 · 2MB AR031 · SVG 허용 목록 422) → 내용 파일 저장(service_role, arch-user)
// → arch.start_ai_run(차감·enqueue는 그 안에서만, 멱등 request_id, doc_template 같은 내용·버전 재요청 0크레딧은 DB가 정함) → 202.
// 차감은 start_ai_run 한 곳에서만 일어나므로 그 앞의 모든 거부는 차감 0이다. 조직·행위자는 세션에서만.
// 응답·로그에 경로·토큰·본문·예외 원문을 넣지 않는다. server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import { logger } from "../../../lib/logger.ts";
import { errorResponse, GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE, UUID_V4_RE } from "../gateway/http.ts";
import type { GatewaySession, GatewaySessionResolver } from "../gateway/session.ts";
import { startAiRun, type RunStarter } from "../gateway/start-run.ts";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { isServerUploadPath } from "../../uploads/policy.ts";
import { buildContentFile, PROPOSAL_TEMPLATE_VERSION, proposalContentSchema, sha256Hex } from "./content.ts";
import { checkSheetSvgBytes, SHEET_MAX_BYTES } from "./svg.ts";

/** arch-user 객체 읽기·쓰기(service_role: 사용자 정책 없음, 2400_arch.sql 11절). 경로는 모양 검사를 통과했거나 서버가 만든 값만. */
export interface ProposalStore {
  /** 객체 크기(바이트). 없으면 null. 그 밖의 오류는 throw. */
  size(path: string): Promise<number | null>;
  /** 객체 전체(크기 검사 뒤에만 부른다). */
  read(path: string): Promise<Uint8Array>;
  /** 내용 파일 저장(upsert=false, application/json). */
  putContent(path: string, bytes: Uint8Array): Promise<void>;
}

/** 사용자 JWT 클라이언트(RLS). 기능 판정과 국외 이전 동의 조회. */
export interface ProposalOrgRepo {
  orgFeatures(orgId: string): Promise<Record<string, unknown>>;
  hasCrossBorderAck(orgId: string): Promise<boolean>;
}

export interface ProposalDeps {
  /** 실패 닫힘 스위치(ARCH_AI_PROPOSAL_ENABLED + 제공자). 요청마다 읽는다. */
  enabled(): boolean;
  /** 서술 생성이 국외 제공자를 쓰는가(ARCH_PROPOSAL_NARRATIVE_ROUTE). */
  narrativeCrossBorder(): boolean;
  session: GatewaySessionResolver;
  org(session: GatewaySession): ProposalOrgRepo;
  store(): ProposalStore;
  starter(): RunStarter;
  rateLimit: RateLimitStore;
  now(): number;
  randomUUID(): string;
}

/** 04_API.md proposal 행 "≤512KB, 제안". */
export const PROPOSAL_MAX_BODY = 512 * 1024;
/** 04_API에 상한이 없어 render와 같은 값(제안). */
export const PROPOSAL_RATE = { limit: 20, windowS: 60 } as const;

const MEMBER_PLUS = new Set(["owner", "admin", "member"]);
const CONTENT_PATH_TAIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

export const proposalRequestSchema = z
  .object({
    request_id: z.string().regex(UUID_V4_RE),
    project_ref: z.string().regex(UUID_RE),
    kind: z.enum(["proposal", "overview", "area_table", "cost"]),
    content: proposalContentSchema,
    render_ids: z.array(z.string().regex(UUID_RE)).max(8),
    drawing_sheets: z
      .array(z.string().min(1).max(300))
      .max(6)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .refine((b) => b.kind !== "cost" || b.content.cost !== undefined); // 공사비 문서는 공사비 값이 있어야 한다

/** 게이트 공용 코드에 없는 제안서 전용 거부(http.ts는 소유 밖이라 같은 봉투로 여기서 만든다). */
type ProposalOnlyCode = "ai_proposal_disabled" | "AI002" | "proposal_sheet_rejected";

const PROPOSAL_ERRORS: Readonly<Record<ProposalOnlyCode, { status: number; message: string }>> = {
  ai_proposal_disabled: { status: 503, message: "지금은 제안서 PDF를 만들 수 없습니다. 크레딧은 차감되지 않았습니다." },
  AI002: { status: 403, message: "AI 국외 이전 동의가 필요합니다. 조직 관리자가 동의한 뒤 다시 시도하세요." },
  proposal_sheet_rejected: { status: 422, message: "도면 시트 SVG에 허용하지 않는 내용이 있습니다. 시트를 다시 만들어 올리세요." },
};

class ProposalReject extends Error {
  readonly code: ProposalOnlyCode;
  constructor(code: ProposalOnlyCode) {
    super(code);
    this.name = "ProposalReject";
    this.code = code;
  }
}

function proposalReject(code: ProposalOnlyCode): Response {
  const spec = PROPOSAL_ERRORS[code];
  return new Response(JSON.stringify({ ok: false, error: { code, message: spec.message } }), {
    status: spec.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** 시트 1장 재검사(업로드 사용 시점, tasks/logs/AR-06-047.md P9) → 바이트 sha256. 실패는 차감 전. */
async function recheckSheet(store: ProposalStore, orgId: string, path: string): Promise<string> {
  if (!isServerUploadPath(orgId, "proposal_sheet", path)) throw new GatewayError("23514");
  let bytes: Uint8Array;
  try {
    const size = await store.size(path);
    if (size === null) throw new GatewayError("23514");
    if (size > SHEET_MAX_BYTES) throw new GatewayError("AR031", { max_bytes: SHEET_MAX_BYTES });
    bytes = await store.read(path);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError("storage_unavailable");
  }
  if (bytes.byteLength > SHEET_MAX_BYTES) throw new GatewayError("AR031", { max_bytes: SHEET_MAX_BYTES });
  if (!checkSheetSvgBytes(bytes).ok) throw new ProposalReject("proposal_sheet_rejected");
  return sha256Hex(bytes);
}

function logReject(code: string): void {
  // 허용 목록 필드만(코드는 고정 목록 값). 경로·본문·토큰은 넣지 않는다.
  logger.warn("ai_proposal.rejected", { route: "ai_proposal", code: /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "internal" });
}

export async function handleProposal(req: Request, deps: ProposalDeps): Promise<Response> {
  try {
    // 0) 실패 닫힘: 스위치가 켜져 있지 않으면 아무것도 읽지 않고 503(차감 0).
    if (!deps.enabled()) throw new ProposalReject("ai_proposal_disabled");

    const session = await deps.session.resolve(req);
    const parsed = proposalRequestSchema.safeParse(await readJsonLimited(req, PROPOSAL_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const input = parsed.data;

    const hit = await deps.rateLimit.hit(`arch:ai_proposal:${session.orgId}`, PROPOSAL_RATE.limit, PROPOSAL_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!MEMBER_PLUS.has(session.role)) throw new GatewayError("42501");
    if (!session.entitled) throw new GatewayError("entitlement_expired", { can_download: true });

    const org = deps.org(session);
    const features = await org.orgFeatures(session.orgId);
    if (features.ai_render !== true) throw new GatewayError("feature_unavailable", { can_download: true });

    // 렌더 이미지 삽입(render_ids)은 1단계 범위 밖: 결정·구현 전까지 거부(DB 호출 전, 차감 0).
    if (input.render_ids.length > 0) throw new GatewayError("22023");

    // 1) 국외 이전 동의: 서술(LLM)이 들어가는 kind='proposal'만, 서술 경로가 국외 제공자일 때만(01_PRD.md:265).
    //    템플릿 문서(overview·area_table·cost)는 LLM을 부르지 않으므로 동의 없이 만든다.
    if (input.kind === "proposal" && deps.narrativeCrossBorder() && !(await org.hasCrossBorderAck(session.orgId))) {
      throw new ProposalReject("AI002");
    }

    // 2) 시트 재검사(순서대로). 해시는 내용 파일에 들어간다(경로 대신 바이트 기준).
    const store = deps.store();
    const sheetSha256: string[] = [];
    for (const path of input.drawing_sheets) sheetSha256.push(await recheckSheet(store, session.orgId, path));

    // 3) 내용 파일 저장(서버 경로). 멱등 재전송이면 새 파일은 고아가 되지만 실행은 DB가 기존 것을 돌려준다(차감 없음).
    const file = buildContentFile({ kind: input.kind, content: input.content, renderIds: input.render_ids, sheetSha256 });
    const objectName = `${deps.randomUUID()}.json`;
    if (!CONTENT_PATH_TAIL.test(objectName)) throw new GatewayError("internal");
    const contentPath = `${session.orgId}/arch/proposal_content/${objectName}`;
    try {
      await store.putContent(contentPath, file.bytes);
    } catch {
      throw new GatewayError("storage_unavailable");
    }

    // 4) 차감·enqueue. 차감액은 DB가 variant로 정한다(proposal 10, doc_template 1, 같은 내용·버전 doc_template 재요청 0).
    const run = await startAiRun(deps.starter(), {
      orgId: session.orgId,
      actorId: session.userId,
      kind: "proposal",
      variant: input.kind === "proposal" ? "proposal" : "doc_template",
      requestId: input.request_id,
      projectRef: input.project_ref,
      options: {
        doc_kind: input.kind,
        content_path: contentPath,
        content_sha256: file.sha256,
        render_ids: input.render_ids,
        drawing_sheets: input.drawing_sheets,
        template_version: PROPOSAL_TEMPLATE_VERSION,
      },
    });
    return okResponse(run, 202);
  } catch (error) {
    if (error instanceof ProposalReject) {
      logReject(error.code);
      return proposalReject(error.code);
    }
    const code = error instanceof GatewayError ? error.code : "internal";
    logReject(code);
    return error instanceof GatewayError ? toErrorResponse(error) : errorResponse("internal");
  }
}
