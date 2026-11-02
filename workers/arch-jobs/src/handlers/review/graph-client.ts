// FastAPI 그래프 경로 클라이언트(04_API.md 6.3절): POST /graphs/arch.review/runs { run_id } → 202, GET /graphs/runs/{id}.
// 응답 봉투 { ok, data }. data = { graph_run_id, graph, run_id, status, stage?, result?, error?: { code, retryable? } }.
// stage·result·error 칸은 이 작업이 제안한 확장이다(apps/api routes/graphs.py는 범위 밖이라 아직 내보내지 않는다 → 팀장 확인).
// 토큰·응답 원문은 오류 메시지에 넣지 않는다(HTTP 상태만).
import { JobError } from "../../core/errors.ts";

export const GRAPH_NAME = "arch.review";
/** 결과 상한(DB arch.reviews.result 512KB + 봉투 여유). */
export const MAX_RESPONSE_BYTES = 600 * 1024;

export type GraphStatus = "accepted" | "running" | "succeeded" | "failed";

export interface GraphRunView {
  graph_run_id: string;
  run_id: string;
  status: GraphStatus;
  stage?: string;
  result?: Record<string, unknown>;
  error?: { code: string; retryable?: boolean };
}

export interface GraphClient {
  start(runId: string, token: string, signal: AbortSignal): Promise<GraphRunView>;
  get(graphRunId: string, token: string, signal: AbortSignal): Promise<GraphRunView>;
}

/** HTTP 오류(상태만). 401은 핸들러가 토큰을 한 번 새로 받아 다시 시도한다. */
export class GraphHttpError extends JobError {
  readonly status: number;
  constructor(status: number) {
    super(`graph request failed: HTTP ${status}`, { retryable: status === 429 || status >= 500, code: `graph_http_${status}` });
    this.name = "GraphHttpError";
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES = new Set<GraphStatus>(["accepted", "running", "succeeded", "failed"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function parseView(body: unknown): GraphRunView {
  const data = isObject(body) && body["ok"] === true ? body["data"] : undefined;
  if (!isObject(data)) throw new JobError("graph response invalid", { retryable: false, code: "graph_bad_response" });
  const { graph_run_id, run_id, status, stage, result, error } = data;
  if (typeof graph_run_id !== "string" || !UUID_RE.test(graph_run_id) || typeof run_id !== "string" || !UUID_RE.test(run_id)) {
    throw new JobError("graph response invalid", { retryable: false, code: "graph_bad_response" });
  }
  if (typeof status !== "string" || !STATUSES.has(status as GraphStatus)) {
    throw new JobError("graph response invalid", { retryable: false, code: "graph_bad_response" });
  }
  const view: GraphRunView = { graph_run_id, run_id, status: status as GraphStatus };
  if (typeof stage === "string") view.stage = stage;
  if (isObject(result)) view.result = result;
  if (isObject(error) && typeof error["code"] === "string") {
    view.error = { code: error["code"], ...(typeof error["retryable"] === "boolean" ? { retryable: error["retryable"] } : {}) };
  }
  return view;
}

export function createGraphClient(opts: { baseUrl: string; fetch?: typeof fetch }): GraphClient {
  const doFetch = opts.fetch ?? fetch;
  async function send(url: string, init: RequestInit): Promise<GraphRunView> {
    const res = await doFetch(url, init);
    if (!res.ok) throw new GraphHttpError(res.status);
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new JobError("graph response too large", { retryable: false, code: "graph_bad_response" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new JobError("graph response invalid", { retryable: false, code: "graph_bad_response" });
    }
    return parseView(body);
  }
  return {
    start(runId, token, signal) {
      return send(new URL(`/graphs/${GRAPH_NAME}/runs`, opts.baseUrl).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ run_id: runId }),
        signal,
      });
    },
    get(graphRunId, token, signal) {
      if (!UUID_RE.test(graphRunId)) throw new JobError("graph run id invalid", { retryable: false, code: "graph_bad_response" });
      return send(new URL(`/graphs/runs/${graphRunId}`, opts.baseUrl).toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal,
      });
    },
  };
}
