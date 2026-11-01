// 기능별 실행 설정(env → 값). 코어 설정(core/config.ts)과 달리 비밀은 없다.
// AI 렌더 실패 닫힘 스위치: 웹(apps/web/src/server/ai/render/config.ts)과 같은 이름·같은 해석(정확히 "true"만 켬).
// 웹도 제공자 규칙까지 같게 해석해 "enabled && provider"일 때만 차감·enqueue한다(규칙을 바꾸면 양쪽 함께, 테스트 표 RENDER_CONFIG_CASES).
// 꺼져 있거나 제공자가 없으면 render 핸들러를 등록하지 않는다 → arch.render 큐를 claim하지 않는다(집었다가 실패·환불시키지 않음).
export const RENDER_ENABLED_ENV = "ARCH_AI_RENDER_ENABLED";
export const RENDER_PROVIDER_ENV = "ARCH_RENDER_PROVIDER";

/** 지금 선택할 수 있는 렌더 제공자. 실제 fal 구현은 0단계 범위 밖(결정 대기). */
export type RenderProviderName = "mock";

export interface RenderConfig {
  enabled: boolean;
  /** null = 쓸 수 있는 제공자 없음(핸들러 미등록). */
  provider: RenderProviderName | null;
}

/** 모의 제공자는 NODE_ENV가 명시적으로 development·test일 때만. 값이 없거나 production이면 선택 불가(운영 실패 닫힘). */
const DEV_ENVS = new Set(["development", "test"]);

export function loadRenderConfig(env: Readonly<Record<string, string | undefined>>): RenderConfig {
  const enabled = env[RENDER_ENABLED_ENV] === "true";
  const provider = env[RENDER_PROVIDER_ENV] === "mock" && DEV_ENVS.has(env["NODE_ENV"] ?? "") ? "mock" : null;
  return { enabled, provider };
}
