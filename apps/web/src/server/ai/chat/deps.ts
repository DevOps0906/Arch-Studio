// 채팅 실제 배선(서버 전용). DIFY_*·AI_SERVICE_URL은 serverEnv 스키마(소유 밖)에 없어 process.env에서 읽는다(config.ts).
import "server-only";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { supabaseVoiceOrg } from "../../voice/supabase-repo.ts";
import { aiTokenSigner } from "../gateway/deps.ts";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../gateway/user-client.ts";
import { chatConfigOf } from "./config.ts";
import type { ChatDeps } from "./service.ts";
import { supabaseChatConversations, supabaseChatCredits } from "./supabase-repo.ts";
import { difyClient, directClient } from "./upstream.ts";

let deps: ChatDeps | undefined;

export function chatDeps(): ChatDeps {
  if (deps) return deps;
  const fetchImpl = globalThis.fetch.bind(globalThis);
  deps = {
    config: () => chatConfigOf(process.env),
    dify: (config) => difyClient({ baseUrl: config.dify.baseUrl, appKey: config.dify.appKey, fetch: fetchImpl }),
    direct: (config) =>
      directClient({
        baseUrl: config.aiServiceUrl,
        // 서명 키가 없거나 잘못되면 throw → 폴백 실패 → 환불·503(실패 닫힘).
        issueToken: (turn) =>
          aiTokenSigner().issueUserToken({
            userId: turn.userId,
            orgId: turn.orgId,
            scope: "chat",
            feat: "arch.chat",
            conv: turn.platformConversationId,
            nowS: Math.floor(Date.now() / 1000),
          }).token,
        fetch: fetchImpl,
      }),
    session: gatewaySessionResolver(),
    org: (session) => supabaseVoiceOrg(userClient(session.accessToken), gatewaySchemas()),
    credits: () => supabaseChatCredits(createSupabaseServiceClient(), gatewaySchemas()),
    conversations: () => supabaseChatConversations(userClient, createSupabaseServiceClient(), gatewaySchemas()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
