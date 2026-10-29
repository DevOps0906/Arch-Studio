// 엔진 호스트: 레인별 워커 분배, 지연 생성, 응답 팬아웃, 봉투 오류 throw, dispose 뒤 재생성.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createEngineHost } from "./engine-host.ts";
import type { WorkerLike } from "../workers/workerClient.ts";

function fakeWorker(log: unknown[]): WorkerLike & { reply(data: unknown): void; terminated: boolean } {
  const w = {
    onmessage: null as WorkerLike["onmessage"],
    onerror: null as WorkerLike["onerror"],
    onmessageerror: null as WorkerLike["onmessageerror"],
    terminated: false,
    postMessage(m: unknown) {
      log.push(m);
    },
    terminate() {
      w.terminated = true;
    },
    reply(data: unknown) {
      w.onmessage?.({ data });
    },
  };
  return w;
}

test("판정은 engine 워커, 시트는 drafting 워커로 가고 워커는 첫 요청 때 만든다", () => {
  const engineLog: unknown[] = [];
  const draftLog: unknown[] = [];
  const made: string[] = [];
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const host = createEngineHost({
    createEngineWorker: () => (made.push("engine"), workers[workers.push(fakeWorker(engineLog)) - 1]!),
    createDraftingWorker: () => (made.push("drafting"), workers[workers.push(fakeWorker(draftLog)) - 1]!),
  });
  assert.deepEqual(made, []);
  const got: unknown[] = [];
  const off = host.subscribe((r) => got.push(r));
  host.send({ op: "judge", req_id: "j1", lane: "judge", seq: 1 } as never);
  host.send({ op: "build_sheet", req_id: "s1", lane: "sheet", seq: 1 } as never);
  assert.deepEqual(made, ["engine", "drafting"]);
  assert.equal((engineLog[0] as { req_id: string }).req_id, "j1");
  assert.equal((draftLog[0] as { req_id: string }).req_id, "s1");
  workers[0]!.reply({ req_id: "j1", seq: 1, ok: true, op: "judge", result: {}, engine_version: "x", elapsed_ms: 1 });
  assert.equal(got.length, 1);
  off();
  workers[1]!.reply({ req_id: "s1", seq: 1, ok: true, op: "build_sheet", result: {}, engine_version: "x", elapsed_ms: 1 });
  assert.equal(got.length, 1);
});

test("봉투가 틀리면 throw, 규칙 팩은 engine 워커만, dispose 뒤 다음 요청에서 다시 만든다", () => {
  const log: unknown[] = [];
  let count = 0;
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const host = createEngineHost({
    createEngineWorker: () => (count++, workers[workers.push(fakeWorker(log)) - 1]!),
    createDraftingWorker: () => assert.fail("drafting 워커를 만들면 안 된다"),
  });
  assert.throws(() => host.send({ op: "judge", req_id: "x" }), /봉투/);
  assert.throws(() => host.send({ op: "nope", req_id: "x" }), /봉투/);
  host.send({ op: "load_rule_pack", req_id: "p", version: "2026.10.0", sha256: "0".repeat(64), pack: {} } as never);
  assert.equal(count, 1);
  host.dispose();
  assert.equal(workers[0]!.terminated, true);
  host.send({ op: "judge", req_id: "j2", lane: "judge", seq: 2 } as never);
  assert.equal(count, 2);
  // 다시 만든 워커에도 마지막 규칙 팩이 판정보다 먼저 간다.
  assert.deepEqual(
    log.map((m) => (m as { req_id: string }).req_id),
    ["p", "p", "j2"],
  );
});
