// GET /api/jobs/{id} 본체(04_API.md 2.1절, 4.1절 progress). 순서: 인증(401/403) → 레이트 리밋(429) → 잡(RLS + 세션 조직 + app=arch)
// → 실행 행(RLS) → 결과 서명 URL(렌더·제안서) → 응답.
// 없는 잡·다른 조직 잡·다른 제품 잡·형식이 틀린 id는 모두 같은 404(존재 여부 오라클 없음).
// 응답에는 허용 필드만: { id, job_type, status, progress, stage?, result?, error?: { code, message }, refunded }.
// 잡 payload·last_error·locked_by·credit_ledger_id·실행 행 error 원문·Storage 경로는 내보내지 않는다.
// server-only를 import하지 않는다(node --test 대상).
import { GatewayError, okResponse, toErrorResponse, UUID_RE } from "../ai/gateway/http.ts";
import { gatewayLog } from "../ai/gateway/log.ts";
import type { GatewaySession, GatewaySessionResolver } from "../ai/gateway/session.ts";
import type { RateLimitStore } from "../licenses/rate-limit.ts";

export interface JobView {
  id: string;
  org_id: string;
  app_id: string;
  job_type: string;
  status: string;
  progress: number;
  progress_message: string | null;
}

export interface RunView {
  id: string;
  status: string;
  error: string | null;
  result?: unknown;
  output_path?: string | null;
  width?: number | null;
  height?: number | null;
  expires_at?: string | null;
  purged_at?: string | null;
  pdf_path?: string | null;
}

export type RunTable = "renders" | "reviews" | "intake_runs" | "proposals";

/** 사용자 JWT 클라이언트(RLS). 조회는 항상 세션 조직으로 좁힌다. */
export interface JobsRepo {
  getJob(orgId: string, jobId: string): Promise<JobView | null>;
  getRunByJob(table: RunTable, orgId: string, jobId: string): Promise<RunView | null>;
}

/** 결과 내려받기 서명(service_role: org-files·exports는 서버 서명 URL로만 준다). 경로는 호출 전에 조직 폴더 검사를 통과한 값만. */
export interface DownloadSigner {
  createSignedUrl(bucket: "org-files" | "exports", path: string, ttlS: number): Promise<string>;
}

export interface JobsDeps {
  session: GatewaySessionResolver;
  repo(session: GatewaySession): JobsRepo;
  downloads(): DownloadSigner;
  rateLimit: RateLimitStore;
  now(): number;
}

/** 폴링 3초(04_API.md 1장) 기준 잡 여러 개를 동시에 봐도 남는 값(제안). */
export const JOBS_GET_RATE = { limit: 120, windowS: 60 } as const;
/** 결과 서명 URL 수명(제안: 15분 규칙 팩 URL보다 짧게). */
export const RESULT_URL_TTL_S = 300;

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface JobTypeSpec {
  table: RunTable;
  stages: readonly string[];
}

/** 04_API.md 4.1절 표의 job_type·progress stage. */
const JOB_TYPES: Readonly<Record<string, JobTypeSpec>> = {
  "arch.render": { table: "renders", stages: ["submit", "generate", "persist"] },
  "arch.review": { table: "reviews", stages: ["load", "retrieve", "interpret", "compliance"] },
  "arch.intake": { table: "intake_runs", stages: ["extract", "validate", "retry"] },
  "arch.proposal_pdf": { table: "proposals", stages: ["narrative", "assemble", "render"] },
};

/** 사용자에게 보여도 되는 실패 코드(04_API.md 7장). 그 밖은 JOB_FAILED. */
const PUBLIC_FAILURES: Readonly<Record<string, string>> = {
  AR030: "동시에 진행할 수 있는 렌더 수를 넘었습니다.",
  AR031: "입력 크기가 상한을 넘었습니다.",
  AR032: "AI 결과가 형식 검사를 통과하지 못했습니다. 크레딧은 환불됩니다.",
  AR033: "출처를 확인할 수 없는 검토 결과라 차단했습니다. 크레딧은 환불됩니다.",
  AI_UNAVAILABLE: "AI 제공자를 사용할 수 없습니다. 크레딧은 환불됩니다.",
  JOB_TIMEOUT: "작업 시간이 초과됐습니다. 크레딧은 환불됩니다.",
  JOB_FAILED: "작업을 완료하지 못했습니다.",
  JOB_CANCELED: "작업이 취소됐습니다.",
};

function publicError(job: JobView, run: RunView | null): { code: string; message: string } | undefined {
  const failed = job.status === "failed" || job.status === "canceled" || run?.status === "failed" || run?.status === "refunded";
  if (!failed) return undefined;
  if (job.status === "canceled") return { code: "JOB_CANCELED", message: PUBLIC_FAILURES.JOB_CANCELED as string };
  const lead = /^([A-Z][A-Z0-9_]{2,30})\b/.exec(run?.error ?? "")?.[1];
  const code = lead && lead !== "JOB_FAILED" && Object.prototype.hasOwnProperty.call(PUBLIC_FAILURES, lead) ? lead : "JOB_FAILED";
  return { code, message: PUBLIC_FAILURES[code] as string };
}

function stageOf(job: JobView, spec: JobTypeSpec | undefined): string | undefined {
  if (!spec || !job.progress_message || job.progress_message.length > 2000) return undefined;
  try {
    const stage = (JSON.parse(job.progress_message) as { stage?: unknown }).stage;
    return typeof stage === "string" && spec.stages.includes(stage) ? stage : undefined;
  } catch {
    return undefined;
  }
}

async function sign(deps: JobsDeps, bucket: "org-files" | "exports", path: string): Promise<string> {
  try {
    return await deps.downloads().createSignedUrl(bucket, path, RESULT_URL_TTL_S);
  } catch {
    throw new GatewayError("storage_unavailable");
  }
}

async function resultOf(job: JobView, run: RunView, orgId: string, deps: JobsDeps): Promise<unknown> {
  if (job.status !== "succeeded" || run.status !== "succeeded") return undefined;
  switch (job.job_type) {
    case "arch.render": {
      const path = run.output_path ?? "";
      if (run.purged_at || !new RegExp(`^${orgId}/arch/render/${UUID_PART}\\.png$`).test(path)) return { expired: true };
      const url = await sign(deps, "org-files", path);
      return { output_url: url, width: run.width ?? null, height: run.height ?? null, expires_at: run.expires_at ?? null, ai_label: true };
    }
    case "arch.proposal_pdf": {
      const path = run.pdf_path ?? "";
      if (!new RegExp(`^${orgId}/arch/pdf/${UUID_PART}\\.pdf$`).test(path)) return undefined;
      return { pdf_url: await sign(deps, "exports", path) };
    }
    case "arch.review":
    case "arch.intake":
      // finish_ai_run이 4.2·4.3절 스키마로 검사한 결과(사용자용 데이터).
      return run.result ?? undefined;
    default:
      return undefined;
  }
}

export async function handleGetJob(req: Request, jobId: string, deps: JobsDeps): Promise<Response> {
  try {
    const session = await deps.session.resolve(req);
    const hit = await deps.rateLimit.hit(`arch:jobs_get:${session.userId}`, JOBS_GET_RATE.limit, JOBS_GET_RATE.windowS, deps.now());
    if (!hit.allowed) {
      throw new GatewayError("rate_limited", undefined, { "retry-after": String(Math.max(1, Math.ceil((hit.resetAtMs - deps.now()) / 1000))) });
    }
    if (!UUID_RE.test(jobId)) throw new GatewayError("not_found");
    const repo = deps.repo(session);
    const job = await repo.getJob(session.orgId, jobId);
    // 저장소가 조건을 빠뜨려도 여기서 한 번 더 막는다(조직·제품 일치).
    if (!job || job.id !== jobId || job.org_id !== session.orgId || job.app_id !== "arch") throw new GatewayError("not_found");
    const spec = Object.prototype.hasOwnProperty.call(JOB_TYPES, job.job_type) ? JOB_TYPES[job.job_type] : undefined;
    const run = spec ? await repo.getRunByJob(spec.table, session.orgId, job.id) : null;

    const progress = Number.isInteger(job.progress) && job.progress >= 0 && job.progress <= 100 ? job.progress : 0;
    const view: Record<string, unknown> = { id: job.id, job_type: job.job_type, status: job.status, progress };
    const stage = stageOf(job, spec);
    if (stage) view.stage = stage;
    if (run) {
      const result = await resultOf(job, run, session.orgId, deps);
      if (result !== undefined) view.result = result;
    }
    const error = publicError(job, run);
    if (error) view.error = error;
    view.refunded = run?.status === "refunded";
    return okResponse(view);
  } catch (error) {
    const code = error instanceof GatewayError ? error.code : "internal";
    if (code !== "not_found") gatewayLog.warn("jobs_get.rejected", { route: "jobs_get", code });
    return toErrorResponse(error instanceof GatewayError ? error : new GatewayError("internal"));
  }
}
