// 개발 데모 전용 규칙 팩 공급원(AR-06-042 P15). 서명 검증 없이 저장소의 개발용 팩(packages/rules/packs/2026.10.0)을 넣는다.
// main.tsx의 `import.meta.env.DEV === true && VITE_DEMO_MODE === "1"` 분기 안에서만 동적 import한다 — 릴리스 빌드는 이 청크가 빠지고
// scripts/check-release-bundle.mjs가 팩 본문 표식 0건을 확인한다. 설치형 릴리스의 팩은 Rust 서명 검증 경로(rule-packs.ts)만.
import devPack from "@arch-studio/rules/dev-packs/2026.10.0.json" with { type: "json" };
import type { RulePackProvider } from "./rule-packs.ts";

export function demoRulePackProvider(): RulePackProvider {
  const version = (devPack as { version: string }).version;
  return {
    current: async () => ({ kind: "pack", version, sha256: `demo-${version}`, pack: structuredClone(devPack) }),
  };
}
