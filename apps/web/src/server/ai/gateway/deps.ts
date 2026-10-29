// AI 게이트 실제 배선(서버 전용). 환경 변수는 serverEnv()로만 읽는다(AI_TOKEN_*·LICENSE_SIGNING_*(혼용 검사)·ARCH_WORKER_INTERNAL_KEY).
import "server-only";
import { serverEnv } from "../../env.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { schemaNames } from "../../licenses/supabase-repo.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { createAiTokenSigner, type AiTokenSigner } from "../token/signer.ts";
import type { AiTokenDeps } from "./ai-token.ts";
import type { RunStarter } from "./start-run.ts";
import { supabaseAiTokenRepo, supabaseRunStarter } from "./supabase-repo.ts";

let signer: AiTokenSigner | undefined;
let deps: AiTokenDeps | undefined;

/** 서명기(첫 사용 때 만들고 재사용). 키 혼용·형식 오류면 AiSignerError. */
export function aiTokenSigner(): AiTokenSigner {
  if (signer) return signer;
  const env = serverEnv();
  signer = createAiTokenSigner({
    privateKey: env.AI_TOKEN_PRIVATE_KEY,
    kid: env.AI_TOKEN_KID,
    licensePrivateKey: env.LICENSE_SIGNING_PRIVATE_KEY,
    licenseKid: env.LICENSE_SIGNING_KID,
  });
  return signer;
}

export function aiTokenDeps(): AiTokenDeps {
  if (deps) return deps;
  deps = {
    repo: () => supabaseAiTokenRepo(createSupabaseServiceClient(), schemaNames(serverEnv().SUPABASE_DB_SCHEMA)),
    signer: aiTokenSigner,
    workerKey: () => serverEnv().ARCH_WORKER_INTERNAL_KEY,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}

/** AI Route Handler(render·review·intake·proposal 작업)가 startAiRun(runStarter(), …)으로 쓴다. */
export function runStarter(): RunStarter {
  return supabaseRunStarter(createSupabaseServiceClient(), schemaNames(serverEnv().SUPABASE_DB_SCHEMA));
}
