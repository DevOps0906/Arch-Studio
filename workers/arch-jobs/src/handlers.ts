// job_type → 핸들러. 실제 핸들러(intake·proposal_pdf·stt)는 각 기능 작업에서 추가한다.
// 여기 없는 큐는 claim하지 않는다(집었다가 no_handler로 실패·환불시키지 않기 위해).
// arch.render는 실패 닫힘 스위치(ARCH_AI_RENDER_ENABLED)가 켜지고 선택 가능한 제공자가 있을 때만 등록한다(src/config.ts).
// arch.review는 실패 닫힘 스위치(ARCH_AI_REVIEW_ENABLED)와 FastAPI 주소(ARCH_API_URL)가 있을 때만 등록한다(src/handlers/review/config.ts).
import { randomUUID } from "node:crypto";
import { loadRenderConfig } from "./config.ts";
import { systemClock } from "./core/clock.ts";
import { createJobTokenClient } from "./core/job-token.ts";
import type { JobHandler } from "./core/runner.ts";
import { createRenderHandler } from "./handlers/render/handler.ts";
import { mockRenderProvider } from "./handlers/render/mock-provider.ts";
import type { RenderStorage } from "./handlers/render/storage.ts";
import { supabaseRenderStorage } from "./handlers/render/storage.ts";
import { loadReviewConfig } from "./handlers/review/config.ts";
import { createReviewHandler } from "./handlers/review/handler.ts";
import { supabaseReviewReader, type ReviewReader } from "./handlers/review/reader.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function buildHandlers(
  env: Env,
  makeStorage: (env: Env) => RenderStorage = supabaseRenderStorage,
  makeReviewReader: (env: Env) => ReviewReader = supabaseReviewReader,
): Readonly<Record<string, JobHandler>> {
  const handlers: Record<string, JobHandler> = {};
  const render = loadRenderConfig(env);
  if (render.enabled && render.provider === "mock") {
    handlers["arch.render"] = createRenderHandler({ provider: mockRenderProvider(), storage: makeStorage(env), randomUUID: () => randomUUID() });
  }
  const review = loadReviewConfig(env);
  if (review.enabled && review.apiUrl) {
    handlers["arch.review"] = createReviewHandler({
      reader: makeReviewReader(env),
      tokens: createJobTokenClient({ baseUrl: env["ARCH_WEB_URL"] as string, workerKey: env["ARCH_WORKER_INTERNAL_KEY"] as string }),
      apiUrl: review.apiUrl,
      clock: systemClock,
    });
  }
  return handlers;
}

export const HANDLERS: Readonly<Record<string, JobHandler>> = buildHandlers(process.env);
