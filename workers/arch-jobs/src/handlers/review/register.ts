// arch.review 핸들러 등록 판단(handlers.ts에서 한 줄로 쓴다). 꺼져 있거나 그래프 서버 주소·잡 토큰 경로가 없으면 null
// → 등록 안 함 → 큐를 claim하지 않는다(웹도 같은 스위치로 접수·차감을 막아 방치 잡이 생기지 않는다).
import { systemClock } from "../../core/clock.ts";
import { createJobTokenClient, type JobTokenClient } from "../../core/job-token.ts";
import type { JobHandler } from "../../core/runner.ts";
import { loadReviewConfig } from "./config.ts";
import { createGraphClient, type GraphClient } from "./graph-client.ts";
import { createReviewHandler } from "./handler.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function buildReviewHandler(
  env: Env,
  make: { tokens(env: Env): JobTokenClient; graph(apiUrl: string): GraphClient } = {
    tokens: (e) => createJobTokenClient({ baseUrl: e["ARCH_WEB_URL"] as string, workerKey: e["ARCH_WORKER_INTERNAL_KEY"] as string }),
    graph: (apiUrl) => createGraphClient({ baseUrl: apiUrl }),
  },
): JobHandler | null {
  const cfg = loadReviewConfig(env);
  if (!cfg.enabled || cfg.apiUrl === null || !env["ARCH_WEB_URL"] || !env["ARCH_WORKER_INTERNAL_KEY"]) return null;
  return createReviewHandler({ tokens: make.tokens(env), graph: make.graph(cfg.apiUrl), sleep: (ms, signal) => systemClock.sleep(ms, signal) });
}
