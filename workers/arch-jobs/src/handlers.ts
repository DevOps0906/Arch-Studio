// job_type → 핸들러. 실제 핸들러(review·intake·proposal_pdf·stt)는 각 기능 작업에서 추가한다.
// 여기 없는 큐는 claim하지 않는다(집었다가 no_handler로 실패·환불시키지 않기 위해).
// arch.render는 실패 닫힘 스위치(ARCH_AI_RENDER_ENABLED)가 켜지고 선택 가능한 제공자가 있을 때만 등록한다(src/config.ts).
import { randomUUID } from "node:crypto";
import { loadRenderConfig } from "./config.ts";
import type { JobHandler } from "./core/runner.ts";
import { createRenderHandler } from "./handlers/render/handler.ts";
import { mockRenderProvider } from "./handlers/render/mock-provider.ts";
import type { RenderStorage } from "./handlers/render/storage.ts";
import { supabaseRenderStorage } from "./handlers/render/storage.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function buildHandlers(env: Env, makeStorage: (env: Env) => RenderStorage = supabaseRenderStorage): Readonly<Record<string, JobHandler>> {
  const handlers: Record<string, JobHandler> = {};
  const render = loadRenderConfig(env);
  if (render.enabled && render.provider === "mock") {
    handlers["arch.render"] = createRenderHandler({ provider: mockRenderProvider(), storage: makeStorage(env), randomUUID: () => randomUUID() });
  }
  return handlers;
}

export const HANDLERS: Readonly<Record<string, JobHandler>> = buildHandlers(process.env);
