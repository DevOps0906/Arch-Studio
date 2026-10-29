// POST /api/internal/ai-token 본체(04_API.md 2.2·6.3절, AI_ARCHITECTURE.md 2.1절). 호출자는 workers/arch-jobs뿐(워커 키).
// 순서: 워커 키(401/503) → 레이트 리밋(429) → 본문 zod strict(400/413/422) → 서명기(503) → 잡(404) → scope·job_type(403)
//       → 잡 running(409) → 실행 행(404/409) → 행위자 활성 멤버(403) → 발급(200).
// 조직·사용자·실행은 DB 잡·실행 행에서만 얻는다. 본문은 { job_id, scope }만(org_id·금액 등 다른 키는 422).
// 응답: { ok: true, data: { token, expires_at }, token }. 최상위 `token`은 workers/arch-jobs/src/core/job-token.ts가
//       `body.token`을 읽기 때문에 둔 호환 필드다(워커가 data.token을 읽게 바뀌면 지운다, tasks/logs/AR-06-047.md).
// server-only를 import하지 않는다(node --test 대상).
import { z } from "zod";
import type { RateLimitStore } from "../../licenses/rate-limit.ts";
import { GatewayError, okResponse, readJsonLimited, toErrorResponse, UUID_RE } from "./http.ts";
import { gatewayLog } from "./log.ts";
import { requireWorkerKey } from "./worker-auth.ts";
import { AiSignerError, JOB_SCOPES, type AiTokenSigner, type Feature, type JobScope } from "../token/signer.ts";

export type RunTable = "reviews" | "intake_runs" | "proposals";

export interface JobRow {
  id: string;
  org_id: string;
  app_id: string;
  job_type: string;
  status: string;
  created_by: string | null;
}

export interface RunRow {
  id: string;
  org_id: string;
  status: string;
  created_by: string | null;
  /** intake_runs.source */
  source?: string | null;
  /** proposals.variant */
  variant?: string | null;
}

/** service_role 포트(워커 경로에는 사용자 세션이 없다). 구현: supabase-repo.ts. 조회 3개 밖에서 service_role을 쓰지 않는다. */
export interface AiTokenRepo {
  getJob(jobId: string): Promise<JobRow | null>;
  getRunByJob(table: RunTable, jobId: string): Promise<RunRow | null>;
  isActiveMember(orgId: string, userId: string): Promise<boolean>;
}

export interface AiTokenDeps {
  repo(): AiTokenRepo;
  /** 실패 시 AiSignerError. DB 호출 전에 부른다. */
  signer(): AiTokenSigner;
  workerKey(): string | undefined;
  rateLimit: RateLimitStore;
  now(): number;
}

export const AI_TOKEN_MAX_BODY = 1024;
/** 워커 키당 분당 600회(제안: 큐 소비자 1개의 그래프 호출·폴링 여유). 운영 전 core.rate_limit_hit로 교체(040과 같음). */
export const AI_TOKEN_RATE = { limit: 600, windowS: 60 } as const;

const bodySchema = z
  .object({
    job_id: z.string().regex(UUID_RE),
    scope: z.enum(JOB_SCOPES),
  })
  .strict();

interface JobTypeSpec {
  scope: JobScope;
  table: RunTable;
  feat(run: RunRow): Feature | null;
}

/** job_type → 허용 scope 1개·실행 테이블·feature(02_ARCHITECTURE.md 4·5장). 여기 없는 잡(render·stt 등)은 잡 토큰이 필요 없다. */
export const JOB_TYPE_SPECS: Readonly<Record<string, JobTypeSpec>> = {
  "arch.review": { scope: "graph:arch.review", table: "reviews", feat: () => "arch.review" },
  "arch.intake": {
    scope: "graph:arch.intake",
    table: "intake_runs",
    // 상담 녹음(consult)은 오픈소스 강제 feature로 라우팅한다(02_ARCHITECTURE.md 5장).
    feat: (run) => (run.source === "consult" ? "arch.intake_consult" : run.source === "chat" ? "arch.intake" : null),
  },
  "arch.proposal_pdf": {
    scope: "graph:arch.proposal_narrative",
    table: "proposals",
    // 서술 생성은 variant 'proposal'만(doc_template은 LLM 없음).
    feat: (run) => (run.variant === "proposal" ? "arch.proposal_narrative" : null),
  },
};

const ACTIVE_RUN = new Set(["queued", "running"]);

export async function handleAiToken(req: Request, deps: AiTokenDeps): Promise<Response> {
  try {
    requireWorkerKey(req, deps.workerKey());
    const hit = await deps.rateLimit.hit("arch:ai_token:worker", AI_TOKEN_RATE.limit, AI_TOKEN_RATE.windowS, deps.now());
    if (!hit.allowed) {
      const retry = Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000));
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(retry) });
    }
    const parsed = bodySchema.safeParse(await readJsonLimited(req, AI_TOKEN_MAX_BODY));
    if (!parsed.success) throw new GatewayError("invalid_input");
    const { job_id: jobId, scope } = parsed.data;

    let signer: AiTokenSigner;
    try {
      signer = deps.signer();
    } catch (error) {
      gatewayLog.error("ai_token.signer_unavailable", { route: "ai_token", reason: error instanceof AiSignerError ? error.reason : "unknown" });
      throw new GatewayError("token_signing_unavailable");
    }

    const repo = deps.repo();
    const job = await repo.getJob(jobId);
    if (!job || job.app_id !== "arch" || job.id !== jobId) throw new GatewayError("not_found");
    const spec = Object.prototype.hasOwnProperty.call(JOB_TYPE_SPECS, job.job_type) ? JOB_TYPE_SPECS[job.job_type] : undefined;
    if (!spec || spec.scope !== scope) throw new GatewayError("scope_mismatch");
    if (job.status !== "running") throw new GatewayError("job_not_running");
    if (!UUID_RE.test(job.org_id)) throw new GatewayError("internal");

    const run = await repo.getRunByJob(spec.table, job.id);
    if (!run || run.org_id !== job.org_id || !UUID_RE.test(run.id)) throw new GatewayError("not_found");
    if (!ACTIVE_RUN.has(run.status)) throw new GatewayError("job_not_running");
    const actor = run.created_by;
    if (!actor || !UUID_RE.test(actor) || (job.created_by !== null && job.created_by !== actor)) throw new GatewayError("42501");
    if (!(await repo.isActiveMember(job.org_id, actor))) throw new GatewayError("42501");
    const feat = spec.feat(run);
    if (!feat) throw new GatewayError("scope_mismatch");

    const nowS = Math.floor(deps.now() / 1000);
    const issued = signer.issueJobToken({ jobId: job.id, runId: run.id, orgId: job.org_id, scope, feat, nowS });
    gatewayLog.info("ai_token.issued", { route: "ai_token", job_id: job.id, run_id: run.id, kind: job.job_type.replace(/^arch\./, "") });
    const expiresAt = new Date(issued.exp * 1000).toISOString();
    return okResponse({ token: issued.token, expires_at: expiresAt }, 200, { token: issued.token });
  } catch (error) {
    if (error instanceof GatewayError) {
      gatewayLog.warn("ai_token.rejected", { route: "ai_token", code: error.code });
    } else {
      gatewayLog.error("ai_token.failed", { route: "ai_token", code: "internal" });
    }
    return toErrorResponse(error);
  }
}

/** POST /api/internal/ai-settle: 정산 규약이 04_API.md에 아직 없다(workers/arch-jobs cron이 부르는 경로). 워커 키 확인 후 501. */
export async function handleAiSettle(req: Request, deps: Pick<AiTokenDeps, "workerKey">): Promise<Response> {
  try {
    requireWorkerKey(req, deps.workerKey());
    gatewayLog.warn("ai_settle.not_implemented", { route: "ai_settle", code: "not_implemented" });
    throw new GatewayError("not_implemented");
  } catch (error) {
    return toErrorResponse(error);
  }
}
