// 잡 토큰 클라이언트: 워커 키로 웹 내부 경로에서 잡 토큰(sub=job:<id>, jti 1회)을 받는다(04_API.md 6.3절).
// jti가 1회용이라 캐시하지 않는다. 토큰·워커 키는 로그·오류 메시지에 넣지 않는다.
import { JobError } from "./errors.ts";

export const JOB_TOKEN_PATH = "/api/internal/ai-token";

export interface JobTokenClient {
  /** scope 예: "graph:arch.review" */
  get(jobId: string, scope: string, signal?: AbortSignal): Promise<string>;
}

export function createJobTokenClient(opts: { baseUrl: string; workerKey: string; fetch?: typeof fetch }): JobTokenClient {
  const doFetch = opts.fetch ?? fetch;
  const url = new URL(JOB_TOKEN_PATH, opts.baseUrl).toString();
  return {
    async get(jobId, scope, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.workerKey}` },
        body: JSON.stringify({ job_id: jobId, scope }),
        signal: signal ?? null,
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        throw new JobError(`job token request failed: HTTP ${res.status}`, { retryable, code: `token_http_${res.status}` });
      }
      const body = (await res.json()) as { token?: unknown };
      if (typeof body.token !== "string" || body.token.length === 0) {
        throw new JobError("job token response has no token", { retryable: false, code: "token_invalid" });
      }
      return body.token;
    },
  };
}
