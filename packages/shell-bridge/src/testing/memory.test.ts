// 메모리 더블도 계약을 통과한다(화면 테스트가 실제 구현과 같은 규칙에 기대도록). 불변식을 깨는 묶음은 계약에서 걸린다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasCapability, byCapability, requireCapability, BridgeError } from "../index.ts";
import { runAdapterContract } from "./contract.ts";
import { createFileFixture } from "./files.ts";
import { createMemoryAdapters, FakeEntitlementClient } from "./memory.ts";

// 주의(AR-06-080 보안 리뷰): rasterizer 계약의 SVG 거부 케이스는 여기서 `FakeRasterizer`(JS 정규식 흉내)를 상대로 돈다.
// 실제 Rust 방어는 `apps/desktop/src-tauri`의 `cargo test`만 확인한다(이 테스트가 통과해도 Rust 쪽 보장은 아니다).
runAdapterContract("memory", () => {
  const files = createFileFixture();
  return { adapters: createMemoryAdapters({ files }), files };
});

test("FakeEntitlementClient: granted만 허용", async () => {
  const e = new FakeEntitlementClient({ granted: ["web_edit"], reason: "expired" });
  assert.deepEqual(await e.can("web_edit"), { allowed: true });
  assert.deepEqual(await e.can("ai_chat"), { allowed: false, reason: "expired" });
});

test("capability 헬퍼: has·by·require", () => {
  const a = createMemoryAdapters({ capabilities: { localFiles: true } });
  assert.equal(hasCapability(a, "localFiles"), true);
  assert.equal(hasCapability(a.capabilities, "offline"), false);
  assert.equal(byCapability(a, "offline", "로컬", "클라우드"), "클라우드");
  assert.throws(() => requireCapability(a, "autoUpdate"), (e: unknown) => e instanceof BridgeError && e.code === "NOT_SUPPORTED");
});
