// job_type → 핸들러. 실제 핸들러(review·intake·stt)는 각 기능 작업에서 추가한다.
// 여기 없는 큐는 claim하지 않는다(집었다가 no_handler로 실패·환불시키지 않기 위해).
// arch.render·arch.proposal_pdf는 각자의 실패 닫힘 스위치가 켜지고 선택 가능한 제공자가 있을 때만 등록한다(src/config.ts).
import { randomUUID } from "node:crypto";
import { loadProposalConfig, loadRenderConfig } from "./config.ts";
import type { JobHandler } from "./core/runner.ts";
import { createProposalHandler } from "./handlers/proposal/handler.ts";
import { mockNarrativeClient } from "./handlers/proposal/mock-narrative.ts";
import { mockPdfRenderer } from "./handlers/proposal/mock-pdf-renderer.ts";
import type { ProposalStorage } from "./handlers/proposal/storage.ts";
import { supabaseProposalStorage } from "./handlers/proposal/storage.ts";
import { createRenderHandler } from "./handlers/render/handler.ts";
import { mockRenderProvider } from "./handlers/render/mock-provider.ts";
import type { RenderStorage } from "./handlers/render/storage.ts";
import { supabaseRenderStorage } from "./handlers/render/storage.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function buildHandlers(
  env: Env,
  makeStorage: (env: Env) => RenderStorage = supabaseRenderStorage,
  makeProposalStorage: (env: Env) => ProposalStorage = supabaseProposalStorage,
): Readonly<Record<string, JobHandler>> {
  const handlers: Record<string, JobHandler> = {};
  const render = loadRenderConfig(env);
  if (render.enabled && render.provider === "mock") {
    handlers["arch.render"] = createRenderHandler({ provider: mockRenderProvider(), storage: makeStorage(env), randomUUID: () => randomUUID() });
  }
  const proposal = loadProposalConfig(env);
  if (proposal.enabled && proposal.provider === "mock") {
    handlers["arch.proposal_pdf"] = createProposalHandler({
      narrative: mockNarrativeClient(),
      narrativeCrossBorder: proposal.narrativeCrossBorder,
      renderer: mockPdfRenderer(),
      storage: makeProposalStorage(env),
      randomUUID: () => randomUUID(),
    });
  }
  return handlers;
}

export const HANDLERS: Readonly<Record<string, JobHandler>> = buildHandlers(process.env);
