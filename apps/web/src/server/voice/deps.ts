// 받아쓰기 실제 배선(서버 전용). 스위치 env(ARCH_VOICE_STT_ENABLED)는 serverEnv 스키마 밖이라 process.env에서 직접 읽는다.
// 실제 제공자·scope=voice 토큰 발급은 후속(AR-06-053 [DECISION] 6): 지금은 결정적 가짜와 고정 자리표시 토큰.
import "server-only";
import { gatewaySchemas, gatewaySessionResolver } from "../ai/gateway/user-client.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { isVoiceSttEnabled } from "./config.ts";
import { fakeSttProvider } from "./provider.ts";
import type { VoiceDeps } from "./service.ts";
import { supabaseVoiceLedger } from "./supabase-repo.ts";

// 실제 제공자를 연결하기 전 차단 조건(운영 전 필수):
//  1) rateLimit는 프로세스 메모리라 인스턴스 사이에 공유되지 않는다 -> 공유 저장소(DB·Redis)로 교체.
//  2) token은 고정 자리표시다 -> scope=voice 단기 토큰 발급으로 교체.
//  3) 매직바이트 검사는 컨테이너 시작 바이트만 본다(얕음) -> 제공자 쪽 디코드 검증.
let deps: VoiceDeps | undefined;

export function voiceDeps(): VoiceDeps {
  if (deps) return deps;
  deps = {
    enabled: () => isVoiceSttEnabled(process.env),
    session: gatewaySessionResolver(),
    ledger: supabaseVoiceLedger(createSupabaseServiceClient(), gatewaySchemas()),
    provider: fakeSttProvider(),
    token: async () => "fake-voice-token",
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.now(),
  };
  return deps;
}
