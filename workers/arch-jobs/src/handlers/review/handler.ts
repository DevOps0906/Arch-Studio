// arch.review 핸들러(AR-06-051 B2). payload: { run_id, variant }.
// 순서: payload 검사 → arch.reviews에서 서버 재계산 판정 읽기 → 잡 토큰 → FastAPI POST(attempt마다 새 실행) → GET 폴링 → AR033 이중 검사 → finish 결과.
// 전체 10분은 요청 시각(reviews.created_at)부터, 재시도 포함. 시도당 timeout_s = 남은 시간. 초과는 재시도 없이 실패 → 전액 환불(runner fail_job → fail_ai_run).
// 실패 분류: FastAPI 404·429·5xx·네트워크·PROVIDER는 재시도 가능, AR033·INVALID_INPUT·그 밖 4xx는 즉시 실패.
import type { Clock } from "../../core/clock.ts";
import { JobError } from "../../core/errors.ts";
import type { JobTokenClient } from "../../core/job-token.ts";
import type { HandlerContext, JobHandler } from "../../core/runner.ts";
import type { ReviewReader } from "./reader.ts";

export const REVIEW_TOTAL_MS = 600_000;
export const REVIEW_SCOPE = "graph:arch.review";
export const REVIEW_POLL_MS = 2_000;

export interface ReviewHandlerDeps {
  reader: ReviewReader;
  tokens: JobTokenClient;
  apiUrl: string;
  clock: Clock;
  fetch?: typeof fetch;
  pollMs?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

function fatal(code: string, message: string): JobError {
  return new JobError(message, { retryable: false, code });
}
function retry(code: string, message: string, cause?: unknown): JobError {
  return new JobError(message, { retryable: true, code, cause });
}

/**
 * 결과 문장 출처 id 재검사(결정 6): result.review.sources의 id 집합 밖 출처는 제거, 출처가 남지 않은 문장은 버린다.
 * 항목이 있는데 문장이 한 줄도 남지 않으면 AR033. 항목 0건(선택 항목 없음)은 그대로 성공.
 */
export function recheckSources(result: unknown): Obj {
  if (!isObj(result) || !isObj(result["review"])) throw fatal("bad_result", "review result invalid");
  const review = result["review"];
  const items = review["items"];
  const sources = review["sources"];
  if (!Array.isArray(items) || !Array.isArray(sources)) throw fatal("bad_result", "review result invalid");
  const known = new Set(sources.filter(isObj).map((s) => s["id"]).filter((id): id is string => typeof id === "string"));
  let kept = 0;
  const nextItems = items.map((raw: unknown) => {
    if (!isObj(raw) || !Array.isArray(raw["sentences"])) throw fatal("bad_result", "review item invalid");
    const sentences = (raw["sentences"] as unknown[]).flatMap((s): Obj[] => {
      if (!isObj(s) || typeof s["text"] !== "string" || s["text"].length === 0 || !Array.isArray(s["source_ids"])) return [];
      const ids = (s["source_ids"] as unknown[]).filter((id): id is string => typeof id === "string" && known.has(id));
      return ids.length > 0 ? [{ ...s, source_ids: ids }] : [];
    });
    kept += sentences.length;
    return { ...raw, sentences };
  });
  if (items.length > 0 && kept === 0) throw fatal("AR033", "no sentence with a valid source");
  return { ...result, review: { ...review, items: nextItems } };
}

export function createReviewHandler(deps: ReviewHandlerDeps): JobHandler {
  const doFetch = deps.fetch ?? fetch;
  const pollMs = deps.pollMs ?? REVIEW_POLL_MS;

  async function call(ctx: HandlerContext, method: "POST" | "GET", path: string, body?: Obj): Promise<Obj | null> {
    // 잡 토큰 jti는 1회용 → 요청마다 새로 받는다.
    const token = await deps.tokens.get(ctx.job.id, REVIEW_SCOPE, ctx.signal);
    let res: Response;
    try {
      res = await doFetch(new URL(path, deps.apiUrl).toString(), {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: ctx.signal,
      });
    } catch (err) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      throw retry("api_network", "review api unreachable", err);
    }
    if (res.status === 404 || res.status === 429 || res.status >= 500) throw retry(`api_http_${res.status}`, `review api HTTP ${res.status}`);
    if (!res.ok) throw fatal(`api_http_${res.status}`, `review api HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as unknown;
    return isObj(json) && isObj(json["data"]) ? json["data"] : null;
  }

  return async (ctx) => {
    const { job, signal } = ctx;
    const runId = job.payload?.["run_id"];
    if (typeof runId !== "string" || !UUID_RE.test(runId)) throw fatal("bad_payload", "run_id invalid");

    const row = await deps.reader.get(runId);
    if (!row || row.org_id !== job.org_id) throw fatal("bad_payload", "review row not found");
    if (!isObj(row.judgment) || Number.isNaN(row.created_at_ms)) throw fatal("bad_payload", "review row invalid");
    const deadline = row.created_at_ms + REVIEW_TOTAL_MS;
    const remainingMs = () => deadline - deps.clock.now();
    const overall = () => fatal("review_timeout", "review exceeded 10 minutes");

    if (remainingMs() <= 0) throw overall();
    await ctx.heartbeat(10, JSON.stringify({ stage: "load" }));

    const timeoutS = Math.min(600, Math.max(1, Math.ceil(remainingMs() / 1000)));
    const started = await call(ctx, "POST", "/graphs/arch.review/runs", {
      run_id: runId,
      attempt: job.attempts,
      application_date: row.application_date,
      timeout_s: timeoutS,
      judgment: row.judgment,
    });
    const graphRunId = started?.["graph_run_id"];
    if (typeof graphRunId !== "string" || graphRunId.length === 0) throw fatal("bad_response", "graph run id missing");

    await ctx.heartbeat(30, JSON.stringify({ stage: "retrieve" }));
    for (;;) {
      if (signal.aborted) throw signal.reason;
      if (remainingMs() <= 0) throw overall();
      const data = await call(ctx, "GET", `/graphs/runs/${encodeURIComponent(graphRunId)}`);
      const status = data?.["status"];
      if (status === "succeeded") {
        const checked = recheckSources(data?.["result"]);
        await ctx.heartbeat(90, JSON.stringify({ stage: "compliance" }));
        const refs = isObj(checked["refs"]) ? checked["refs"] : {};
        return { runResult: { review: checked["review"], refs }, jobResult: { run_id: runId, graph_run_id: graphRunId } };
      }
      if (status === "failed") {
        const err = isObj(data?.["error"]) ? data["error"] : {};
        const code = typeof err["code"] === "string" ? err["code"] : "PROVIDER";
        if (code === "PROVIDER" || (err["retryable"] === true && code !== "AR033" && code !== "INVALID_INPUT")) {
          throw retry("PROVIDER", "review graph failed (provider)");
        }
        throw fatal(code === "AR033" || code === "INVALID_INPUT" ? code : "graph_failed", `review graph failed: ${code}`);
      }
      if (status !== "accepted" && status !== "running" && status !== "queued") throw fatal("bad_response", "graph status invalid");
      await ctx.heartbeat(60, JSON.stringify({ stage: "interpret" }));
      await deps.clock.sleep(Math.min(pollMs, Math.max(remainingMs(), 0)), signal);
    }
  };
}
