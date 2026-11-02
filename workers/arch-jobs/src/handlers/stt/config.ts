// arch.stt 실패 닫힘 설정. 웹(apps/web/src/server/voice/config.ts isConsultEnabled)과 같은 이름·같은 해석.
// 켜짐 = ARCH_VOICE_CONSULT_ENABLED가 정확히 "true" **이고** 선택 가능한 제공자가 있음.
// 지금 워커가 고를 수 있는 제공자는 mock(development·test)뿐이다: oss-voice는 voice scope 잡 토큰 발급 경로가 없어
// (/api/internal/ai-token은 graph:* 잡 scope만) 인증할 수 없다. 경로가 생기면 웹·워커를 함께 연다.
// 꺼져 있으면 핸들러를 등록하지 않는다 → arch.stt 큐를 claim하지 않는다(웹도 같은 조건으로 접수를 막아 방치 잡이 생기지 않는다).
export const VOICE_CONSULT_ENABLED_ENV = "ARCH_VOICE_CONSULT_ENABLED";
export const VOICE_PROVIDER_ENV = "ARCH_VOICE_STT_PROVIDER";

export interface SttConfig {
  enabled: boolean;
  provider: "mock" | null;
}

const DEV_ENVS = new Set(["development", "test"]);

export function loadSttConfig(env: Readonly<Record<string, string | undefined>>): SttConfig {
  const enabled = env[VOICE_CONSULT_ENABLED_ENV] === "true";
  const provider = env[VOICE_PROVIDER_ENV] === "mock" && DEV_ENVS.has(env["NODE_ENV"] ?? "") ? "mock" : null;
  return { enabled, provider };
}
