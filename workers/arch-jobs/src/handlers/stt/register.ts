// arch.stt 핸들러 등록 판단(handlers.ts에서 한 줄로 쓴다). 꺼져 있거나 제공자가 없으면 null → 등록 안 함 → 큐를 claim하지 않는다.
import type { JobHandler } from "../../core/runner.ts";
import { loadSttConfig } from "./config.ts";
import { createSttHandler } from "./handler.ts";
import { mockConsultSttProvider } from "./provider.ts";
import { supabaseSttCredits, supabaseSttStorage, type SttCredits, type SttStorage } from "./storage.ts";

type Env = Readonly<Record<string, string | undefined>>;

export function buildSttHandler(
  env: Env,
  make: { storage(env: Env): SttStorage; credits(env: Env): SttCredits } = { storage: supabaseSttStorage, credits: supabaseSttCredits },
): JobHandler | null {
  const cfg = loadSttConfig(env);
  if (!cfg.enabled || cfg.provider !== "mock") return null;
  return createSttHandler({ provider: mockConsultSttProvider(), storage: make.storage(env), credits: make.credits(env) });
}
