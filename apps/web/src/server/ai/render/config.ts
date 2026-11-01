// AI 렌더 실패 닫힘 스위치(웹·워커 공유 env 이름과 해석). 켜짐 = 스위치가 정확히 "true" **이고** 사용 가능한 제공자가 있음.
// 제공자 규칙은 워커(workers/arch-jobs/src/config.ts loadRenderConfig)와 같다: 지금은 "mock"만, NODE_ENV가 development·test일 때만.
// 웹이 스위치만 보고 차감·enqueue하면 워커가 핸들러를 등록하지 않은 환경(운영)에서 잡이 queued로 방치되므로 같은 조건으로 막는다.
// 같은 입력 표로 양쪽을 검사하는 테스트: service.test.ts·handler.test.ts의 RENDER_CONFIG_CASES.
// server-only를 import하지 않는다(node --test 대상).

export const RENDER_ENABLED_ENV = "ARCH_AI_RENDER_ENABLED";
export const RENDER_PROVIDER_ENV = "ARCH_RENDER_PROVIDER";

const DEV_ENVS = new Set(["development", "test"]);

/** 사용 가능한 제공자 이름. 없으면 null. 실제 fal 구현이 생기면 워커와 같은 작업에서 함께 추가한다. */
export function renderProviderOf(env: Readonly<Record<string, string | undefined>>): "mock" | null {
  return env[RENDER_PROVIDER_ENV] === "mock" && DEV_ENVS.has(env["NODE_ENV"] ?? "") ? "mock" : null;
}

export function isRenderEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[RENDER_ENABLED_ENV] === "true" && renderProviderOf(env) !== null;
}
