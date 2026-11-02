// 음성 STT 실제 배선(서버 전용). 스위치 ARCH_VOICE_STT_PROVIDER·ARCH_VOICE_CONSULT_ENABLED·NODE_ENV는 serverEnv 스키마(소유 밖)에 없어
// process.env에서 직접 읽는다. OSS_VOICE_BASE_URL·ARCH_RECORDING_NOTICE_VERSION·AI_TOKEN_*은 serverEnv()로.
import "server-only";
import { aiTokenSigner } from "../ai/gateway/deps.ts";
import { gatewaySchemas, gatewaySessionResolver, userClient } from "../ai/gateway/user-client.ts";
import { serverEnv } from "../env.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { isConsultEnabled, sttProviderOf } from "./config.ts";
import { mockSttProvider, ossVoiceProvider, type SttProvider } from "./provider.ts";
import type { VoiceDeps } from "./service.ts";
import { supabaseConsultAudio, supabaseConsultQueue, supabaseVoiceCredits, supabaseVoiceOrg } from "./supabase-repo.ts";

let deps: VoiceDeps | undefined;

function providerFromEnv(): SttProvider | null {
  const name = sttProviderOf(process.env);
  if (name === "mock") return mockSttProvider();
  if (name === "oss-voice") {
    return ossVoiceProvider({
      baseUrl: serverEnv().OSS_VOICE_BASE_URL,
      // 서명 키가 없거나 잘못되면 throw → 제공자 실패 → 전액 환불·503(실패 닫힘).
      issueToken: (orgId, userId) => aiTokenSigner().issueUserToken({ userId, orgId, scope: "voice", nowS: Math.floor(Date.now() / 1000) }).token,
      fetch: globalThis.fetch.bind(globalThis),
    });
  }
  return null;
}

export function voiceDeps(): VoiceDeps {
  if (deps) return deps;
  deps = {
    provider: providerFromEnv,
    consultEnabled: () => isConsultEnabled(process.env),
    recordingNoticeVersion: () => serverEnv().ARCH_RECORDING_NOTICE_VERSION,
    session: gatewaySessionResolver(),
    org: (session) => supabaseVoiceOrg(userClient(session.accessToken), gatewaySchemas()),
    credits: () => supabaseVoiceCredits(createSupabaseServiceClient(), gatewaySchemas()),
    consultAudio: () => supabaseConsultAudio(createSupabaseServiceClient()),
    queue: () => supabaseConsultQueue(createSupabaseServiceClient(), gatewaySchemas()),
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
