// 음성 STT 실패 닫힘 설정(env → 값). 비밀 값은 읽지 않고 이름과 존재만 본다.
// 제공자: 04_API.md 2.2절 `/api/voice/stt`·12장 core-voice 행 = 오픈소스 음성 서버(oss-voice, OSS_VOICE_BASE_URL).
// ElevenLabs 대체(voice_chat auto 체인 2순위)는 국외 이전 동의·SDK 의존성 결정 전이라 이 작업에서 붙이지 않는다(로그 AR-06-053).
// 상담 녹음(arch.stt 잡)은 워커가 같은 제공자를 쓸 수 있어야 켠다. 워커는 아직 oss-voice 인증 경로(잡용 voice 토큰)가 없어
// 지금은 mock(development·test)만 켤 수 있다. 규칙을 바꾸면 workers/arch-jobs/src/handlers/stt/config.ts도 같이 바꾼다.
// server-only를 import하지 않는다(node --test 대상).

export const VOICE_PROVIDER_ENV = "ARCH_VOICE_STT_PROVIDER";
export const VOICE_CONSULT_ENABLED_ENV = "ARCH_VOICE_CONSULT_ENABLED";
export const OSS_VOICE_URL_ENV = "OSS_VOICE_BASE_URL";

export type SttProviderName = "oss-voice" | "mock";

type Env = Readonly<Record<string, string | undefined>>;

const DEV_ENVS = new Set(["development", "test"]);

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** 받아쓰기 제공자. 값이 없거나 조건이 안 맞으면 null(→ 503, 차감 0). */
export function sttProviderOf(env: Env): SttProviderName | null {
  const v = env[VOICE_PROVIDER_ENV];
  if (v === "mock") return DEV_ENVS.has(env["NODE_ENV"] ?? "") ? "mock" : null;
  if (v === "oss-voice") return isHttpUrl(env[OSS_VOICE_URL_ENV]) ? "oss-voice" : null;
  return null;
}

/** 상담 녹음 접수(arch.stt enqueue). 스위치가 정확히 "true"이고 워커와 같은 제공자(지금은 mock)일 때만. */
export function isConsultEnabled(env: Env): boolean {
  return env[VOICE_CONSULT_ENABLED_ENV] === "true" && sttProviderOf(env) === "mock";
}
