// AR-06-042 RulePackProvider: Rust 불러오기 결과 → 워커 공급 메시지, 이유 코드(AR063~065), 데모 공급원.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineHost, EngineRequestLike } from "@arch-studio/features/shell";
import type { RulePackLoadResult, RulePackStore } from "@arch-studio/shell-bridge";
import { parseRequest } from "../workers/protocol.ts";
import { demoRulePackProvider } from "./demo-rule-pack.ts";
import { connectRulePacks, rustRulePackProvider, supplyFromLoad } from "./rule-packs.ts";

function host(): { engine: EngineHost; sent: EngineRequestLike[] } {
  const sent: EngineRequestLike[] = [];
  return { sent, engine: { send: (r) => void sent.push(r), subscribe: () => () => undefined, dispose: () => undefined } };
}

const OK: RulePackLoadResult = { state: "ok", pack: { version: "2026.10.0", sha256: "a".repeat(64), basisDate: "2026-10-14", publishedAt: "2026-10-20T00:00:00Z", text: '{"version":"2026.10.0"}' } };

test("불러오기 상태 → 공급: ok는 팩, missing AR063, invalid AR064, not_entitled AR065, 깨진 JSON AR064", () => {
  assert.deepEqual(supplyFromLoad(OK), { kind: "pack", version: "2026.10.0", sha256: "a".repeat(64), pack: { version: "2026.10.0" } });
  assert.deepEqual(supplyFromLoad({ state: "missing" }), { kind: "unavailable", code: "AR063" });
  assert.deepEqual(supplyFromLoad({ state: "invalid" }), { kind: "unavailable", code: "AR064" });
  assert.deepEqual(supplyFromLoad({ state: "not_entitled" }), { kind: "unavailable", code: "AR065" });
  assert.deepEqual(supplyFromLoad({ state: "ok", pack: { ...(OK as { pack: object }).pack, text: "{" } } as RulePackLoadResult), { kind: "unavailable", code: "AR064" });
});

test("Rust 공급원: 라이선스 파일을 넘기고, 저장소가 없으면 AR063, 라이선스 읽기 실패는 null로", async () => {
  const seen: (string | null)[] = [];
  const store: RulePackStore = {
    load: async (lic) => (seen.push(lic), lic ? OK : { state: "not_entitled" }),
    install: async () => ({ state: "installed", version: null }),
  };
  assert.equal((await rustRulePackProvider(store, async () => "LIC").current()).kind, "pack");
  assert.deepEqual(await rustRulePackProvider(store, async () => Promise.reject(new Error("x"))).current(), { kind: "unavailable", code: "AR065" });
  assert.deepEqual(seen, ["LIC", null]);
  assert.deepEqual(await rustRulePackProvider(null, async () => "LIC").current(), { kind: "unavailable", code: "AR063" });
});

test("connectRulePacks: 워커 봉투 검사를 통과하는 load_rule_pack(팩 또는 이유 코드)을 보낸다", async () => {
  const a = host();
  assert.deepEqual(await connectRulePacks(a.engine, { current: async () => supplyFromLoad(OK) }, () => "id1"), { state: "loaded", version: "2026.10.0" });
  const p = parseRequest(a.sent[0]);
  assert.ok(p.ok && p.request.op === "load_rule_pack" && p.request.version === "2026.10.0" && p.request.unavailable === undefined);
  const b = host();
  assert.deepEqual(await connectRulePacks(b.engine, { current: async () => Promise.reject(new Error("boom")) }, () => "id2"), { state: "unavailable", code: "AR064" });
  const q = parseRequest(b.sent[0]);
  assert.ok(q.ok && q.request.op === "load_rule_pack" && q.request.unavailable === "AR064");
});

test("데모 공급원: 저장소 개발용 팩(2026.10.0), 호출마다 새 복사본", async () => {
  const d = demoRulePackProvider();
  const a = await d.current();
  const b = await d.current();
  assert.ok(a.kind === "pack" && b.kind === "pack");
  assert.equal(a.kind === "pack" && a.version, "2026.10.0");
  assert.notEqual(a.kind === "pack" && a.pack, b.kind === "pack" && b.pack);
});
