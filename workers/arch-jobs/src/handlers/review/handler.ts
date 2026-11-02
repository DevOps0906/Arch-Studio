// arch.review 핸들러(AR-06-051). payload(start_ai_run이 만든 값, 04_API.md 4.1절):
//   { run_id, variant: 'review', rule_pack_version, application_date, municipality_code }. 판정 입력은 arch.reviews 행(그래프가 읽는다).
// 순서: payload 검사 → 잡 토큰(graph:arch.review, jti 1회) → POST /graphs/arch.review/runs → GET 폴링(stage 하트비트)
//   → succeeded: 결과 사전 검사(review.v1, 모든 문장 source_ids ≥ 1, 문장 ≥ 1. 아니면 AR033) → runResult(러너가 finish_ai_run, DB도 AR033 재검사)
//   → failed: AR033은 재시도 없음(전액 환불), 제공자 오류(retryable)는 잡 재시도 1회(같은 run_id라 그래프 실행 재개).
// 10분 초과는 러너 정책(core/policy.ts arch.review 10분, 타임아웃 재시도 1회)이 끊고, 최종 실패면 fail_job·fail_ai_run이 전액 환불한다.
// 로그·오류에 토큰·결과 문장을 넣지 않는다.
import { JobError } from "../../core/errors.ts";
import type { JobTokenClient } from "../../core/job-token.ts";
import type { JobHandler } from "../../core/runner.ts";
import { GraphHttpError, type GraphClient, type GraphRunView } from "./graph-client.ts";

export const REVIEW_SCOPE = "graph:arch.review";
/** 폴링 간격(제안). 10분 상한 안에서 토큰 서버·그래프 서버 부하를 낮게. */
export const POLL_MS = 5_000;

const STAGE_PROGRESS: Readonly<Record<string, number>> = { load: 5, retrieve: 25, interpret: 50, compliance: 85 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9]{4}\.[0-9]{2}\.[0-9]{1,3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MUNI_RE = /^[0-9]{5,10}$/;
const CODE_RE = /^[A-Za-z0-9_]{1,40}$/;

export interface ReviewHandlerDeps {
  tokens: JobTokenClient;
  graph: GraphClient;
  /** ms 대기(signal abort면 즉시 끝). */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  pollMs?: number;
}

function fatal(code: string, message: string): JobError {
  return new JobError(message, { retryable: false, code });
}

function parseRunId(payload: Record<string, unknown>): string {
  const runId = payload["run_id"];
  if (typeof runId !== "string" || !UUID_RE.test(runId)) throw fatal("bad_payload", "run_id invalid");
  if (payload["variant"] !== undefined && payload["variant"] !== "review") throw fatal("bad_payload", "variant invalid");
  const version = payload["rule_pack_version"];
  const date = payload["application_date"];
  const muni = payload["municipality_code"];
  if (typeof version !== "string" || !VERSION_RE.test(version)) throw fatal("bad_payload", "rule_pack_version invalid");
  if (typeof date !== "string" || !DATE_RE.test(date)) throw fatal("bad_payload", "application_date invalid");
  if (typeof muni !== "string" || !MUNI_RE.test(muni)) throw fatal("bad_payload", "municipality_code invalid");
  return runId;
}

function hasSources(sentence: unknown): boolean {
  if (sentence === null || typeof sentence !== "object") return false;
  const ids = (sentence as { source_ids?: unknown }).source_ids;
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string" && id.length > 0);
}

/** finish_ai_run 전 사전 검사(DB와 같은 규칙: 출처 없는 문장 1개라도 있으면 AR033). 남는 문장 0도 AR033. */
export function checkReviewResult(result: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!result || result["schema_version"] !== "review.v1" || !Array.isArray(result["items"])) {
    throw fatal("AR033", "review.v1 result required");
  }
  const needs = result["needs_check"] ?? [];
  if (!Array.isArray(needs)) throw fatal("AR033", "needs_check must be array");
  const sentences: unknown[] = [...needs];
  for (const item of result["items"] as unknown[]) {
    const s = item !== null && typeof item === "object" ? (item as { sentences?: unknown }).sentences ?? [] : null;
    if (!Array.isArray(s)) throw fatal("AR033", "sentences must be array");
    sentences.push(...s);
  }
  if (sentences.length === 0 || !sentences.every(hasSources)) throw fatal("AR033", "sentence without source");
  return result;
}

function failedError(view: GraphRunView): JobError {
  const code = view.error && CODE_RE.test(view.error.code) ? view.error.code : "graph_failed";
  if (code === "AR033") return fatal("AR033", "review has no cited sentence");
  const retryable = view.error?.retryable === true || code === "AI_UNAVAILABLE";
  return new JobError("review graph failed", { retryable, code });
}

export function createReviewHandler(deps: ReviewHandlerDeps): JobHandler {
  const pollMs = deps.pollMs ?? POLL_MS;
  return async (ctx) => {
    const { job, signal } = ctx;
    const runId = parseRunId(job.payload ?? {});

    await ctx.heartbeat(STAGE_PROGRESS["load"], JSON.stringify({ stage: "load" }));
    let token = await deps.tokens.get(job.id, REVIEW_SCOPE, signal);
    let view = await deps.graph.start(runId, token, signal);
    if (view.run_id !== runId) throw fatal("graph_bad_response", "graph run_id mismatch");
    let stage = "load";

    for (;;) {
      if (view.stage && view.stage !== stage && STAGE_PROGRESS[view.stage] !== undefined) {
        stage = view.stage;
        await ctx.heartbeat(STAGE_PROGRESS[stage], JSON.stringify({ stage }));
      }
      if (view.status === "succeeded") {
        const runResult = checkReviewResult(view.result);
        return { runResult, jobResult: { run_id: runId, graph_run_id: view.graph_run_id } };
      }
      if (view.status === "failed") throw failedError(view);

      await deps.sleep(pollMs, signal);
      if (signal.aborted) throw signal.reason;
      const graphRunId = view.graph_run_id;
      try {
        view = await deps.graph.get(graphRunId, token, signal);
      } catch (err) {
        if (!(err instanceof GraphHttpError && err.status === 401)) throw err;
        token = await deps.tokens.get(job.id, REVIEW_SCOPE, signal); // 잡 토큰 수명 만료: 1회 새로 받는다
        view = await deps.graph.get(graphRunId, token, signal);
      }
      if (view.run_id !== runId) throw fatal("graph_bad_response", "graph run_id mismatch");
    }
  };
}
