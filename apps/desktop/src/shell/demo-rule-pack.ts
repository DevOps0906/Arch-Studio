// 데모 모드 전용(개발 빌드 + VITE_DEMO_MODE=1에서만 main.tsx가 동적 import — 릴리스 번들에는 들어가지 않는다):
// 저장소의 미서명 규칙 팩(2026.10.0, 전 규칙 미확인)을 판정 워커에 넣어, 백엔드 없이도 판정이 끝나야 하는 화면(도면 시트 등)을 확인한다.
// 운영 경로(Rust 서명 확인 → load_rule_pack, AR-06-042)와 무관하며 운영에서는 쓰지 않는다.
import type { EngineHost } from "@arch-studio/features/shell";
import manifest from "../../../../packages/rules/packs/2026.10.0/manifest.json";
import pack from "../../../../packages/rules/packs/2026.10.0/pack.json";

export function loadDemoRulePack(engine: EngineHost | null): void {
  if (!engine) return;
  const request = { op: "load_rule_pack", req_id: "demo-rule-pack-1", version: "2026.10.0", sha256: manifest.sha256, pack };
  engine.send(request);
}
