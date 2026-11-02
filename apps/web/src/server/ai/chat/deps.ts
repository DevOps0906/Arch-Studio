// 채팅 실제 배선(서버 전용). 스위치·API 주소 env(ARCH_AI_CHAT_ENABLED·ARCH_API_URL)는 serverEnv 스키마 밖이라 process.env에서 직접 읽는다.
// 운영 전 차단: ① 메모리 레이트리밋(인스턴스 공유 안 됨) ② 일일 상한은 원장 건수 근사(동시 요청 시 소폭 초과, 원자 카운터 마이그레이션 후속)
// ③ Dify 연결은 후속([DECISION] 1).
import "server-only";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";
import { aiTokenSigner } from "../gateway/deps.ts";
import { gatewaySchemas, gatewaySessionResolver } from "../gateway/user-client.ts";
import { isChatEnabled } from "./config.ts";
import type { ChatDeps } from "./service.ts";
import { supabaseChatLedger, supabaseChatStore, supabaseChatTurnsPerDay } from "./supabase-repo.ts";

let deps: ChatDeps | undefined;

export function chatDeps(): ChatDeps {
  if (deps) return deps;
  const service = createSupabaseServiceClient();
  const schemas = gatewaySchemas();
  const turns = supabaseChatTurnsPerDay(service, schemas);
  deps = {
    enabled: () => isChatEnabled(process.env),
    session: gatewaySessionResolver(),
    turnsPerDay: (session) => turns(session.orgId),
    ledger: supabaseChatLedger(service, schemas),
    store: supabaseChatStore(service, schemas),
    apiUrl: () => process.env["ARCH_API_URL"] || undefined,
    issueToken: (a) =>
      aiTokenSigner().issueUserToken({
        userId: a.userId,
        orgId: a.orgId,
        scope: "chat",
        feat: "arch.chat",
        conv: a.conversationId,
        req: a.requestId,
        nowS: Math.floor(Date.now() / 1000),
      }).token,
    fetch: (input, init) => fetch(input, init),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
