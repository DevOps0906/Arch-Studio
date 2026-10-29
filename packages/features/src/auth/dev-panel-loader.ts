// 개발용 로그인 패널 로더(03장 3.1절 A단계). 조건식은 글자 그대로 둔다: 릴리스 빌드는 Vite가 DEV를 false로 치환해
// 아래 동적 import(dev-panel.tsx, 패널 문구·Mock 호출 포함)가 번들에서 빠진다 — 008 loadDevMockAuth와 같은 방식.
// 패널이 실제로 보이는지는 앱이 넘긴 AuthPort.loadDevMock(= shell-bridge loadDevMockAuth 판정)이 정한다(이중 잠금).
import type { ComponentType } from "react";
import type { DevMockPanelProps } from "./dev-panel-types.ts";

export async function loadDevPanel(): Promise<ComponentType<DevMockPanelProps> | null> {
  if (typeof import.meta.env !== "undefined" && import.meta.env.DEV === true) {
    const mod = await import("./dev-panel.tsx");
    return mod.DevMockPanel;
  }
  return null;
}
