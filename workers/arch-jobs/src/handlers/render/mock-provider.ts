// 개발 전용 모의 제공자: 외부 호출 없이 깊이 이미지를 그대로 돌려준다(결정적). 선택은 src/config.ts가 development·test에서만 허용.
import type { RenderProvider } from "./provider.ts";

export function mockRenderProvider(): RenderProvider {
  return {
    name: "mock",
    model: "mock-echo-v1",
    async render(req) {
      if (req.signal.aborted) throw req.signal.reason;
      return { png: req.depth, seed: 0 };
    },
  };
}
