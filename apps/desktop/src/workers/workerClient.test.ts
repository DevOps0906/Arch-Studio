import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineRequest, EngineResponse } from "./protocol.ts";
import { WorkerClient, type WorkerLike } from "./workerClient.ts";

class FakeWorker implements WorkerLike {
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  postMessage(m: unknown): void {
    this.posted.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(r: EngineResponse): void {
    this.onmessage?.({ data: r });
  }
  crash(): void {
    this.onerror?.(new Error("boom"));
  }
}

function setup(extra: Partial<ConstructorParameters<typeof WorkerClient>[0]> = {}) {
  const workers: FakeWorker[] = [];
  const out: EngineResponse[] = [];
  const client = new WorkerClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    onResponse: (r) => void out.push(r),
    ...extra,
  });
  return { client, workers, out };
}

const judge = (id: string, seq: number): EngineRequest => ({ op: "judge", req_id: id, lane: "judge", seq, model_rev: "r", model: {} as never });
const write = (id: string): EngineRequest => ({ op: "write", req_id: id, lane: "export", format: "dxf", sheets: [], layer_map: {}, bundle: false, project_name: "p", date: "2026-10-29" });
const ok = (id: string, seq?: number): EngineResponse => ({ req_id: id, ...(seq === undefined ? {} : { seq }), ok: true, op: "x", result: null, engine_version: "t", elapsed_ms: 1 });

test("워커 오류 후 재생성하고 레인별 마지막 미응답 요청만 다시 보낸다", () => {
  const { client, workers, out } = setup();
  client.send({ op: "load_rule_pack", req_id: "rp", version: "2026.10.0", sha256: "h", pack: {} });
  workers[0]?.reply({ req_id: "rp", ok: true, op: "load_rule_pack", result: null, engine_version: "t", elapsed_ms: 1 });
  client.send(judge("j1", 1));
  client.send(judge("j2", 2));
  client.send({ op: "build_sheet", req_id: "s1", lane: "sheet", seq: 1, input: {} as never });
  workers[0]?.reply(ok("s1", 1)); // 시트는 이미 응답 받음: 다시 보내지 않는다
  workers[0]?.crash();
  assert.equal(workers.length, 2);
  assert.equal(workers[0]?.terminated, true);
  const ids = workers[1]?.posted.map((m) => (m as { req_id: string }).req_id);
  assert.deepEqual(ids, ["rp", "j2"]); // 규칙 팩 먼저, 판정은 마지막(j2)만
  assert.deepEqual(out.filter((r) => "status" in r), [{ req_id: "j1", status: "superseded" }]);
});

test("export 레인은 미응답 요청을 모두 순서대로 다시 보낸다(끝까지 실행)", () => {
  const { client, workers } = setup();
  client.send(write("e1"));
  client.send(write("e2"));
  workers[0]?.reply(ok("e1"));
  client.send(write("e3"));
  client.notifyExit();
  assert.deepEqual(workers[1]?.posted.map((m) => (m as { req_id: string }).req_id), ["e2", "e3"]);
});

test("재전송 후 새 워커의 응답이 정상 전달된다", () => {
  const { client, workers, out } = setup();
  client.send(judge("j1", 1));
  workers[0]?.crash();
  workers[1]?.reply(ok("j1", 1));
  assert.deepEqual(out, [ok("j1", 1)]);
});

test("레인 최신 seq 보다 작은 성공 응답은 버린다", () => {
  const { client, workers, out } = setup();
  client.send(judge("j1", 1));
  client.send(judge("j2", 2));
  workers[0]?.reply(ok("j1", 1));
  workers[0]?.reply({ req_id: "j2", status: "superseded" });
  assert.deepEqual(out, [{ req_id: "j2", status: "superseded" }]);
});

test("타임아웃: 해당 요청은 오류로 끝내고 워커를 재생성, 나머지는 다시 보낸다", () => {
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const { client, workers, out } = setup({
    timeoutMs: { judge: 100, export: 500 },
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => void ((h as { cleared: boolean }).cleared = true),
  });
  client.send(judge("j1", 1));
  client.send(write("e1"));
  assert.deepEqual(timers.map((t) => t.ms), [100, 500]);
  timers[0]?.fn();
  assert.equal(workers.length, 2);
  assert.deepEqual(out, [{ req_id: "j1", seq: 1, ok: false, code: "AR050", detail: "시간 초과" }]);
  assert.deepEqual(workers[1]?.posted.map((m) => (m as { req_id: string }).req_id), ["e1"]);
});

test("응답 없이 재생성이 반복되면 남은 요청을 오류로 끝내고 멈춘다", () => {
  let fatal = 0;
  const { client, workers, out } = setup({ maxRestarts: 2, onFatal: () => void fatal++ });
  client.send(write("e1"));
  workers[0]?.crash();
  workers[1]?.crash();
  workers[2]?.crash();
  assert.equal(fatal, 1);
  assert.deepEqual(out, [{ req_id: "e1", ok: false, code: "AR052", detail: "엔진 워커를 다시 시작할 수 없습니다" }]);
  assert.equal(workers.length, 3);
});

test("dispose 후에는 아무것도 보내지 않는다", () => {
  const { client, workers } = setup();
  client.dispose();
  client.send(judge("j", 1));
  assert.equal(workers[0]?.posted.length, 0);
  assert.equal(workers[0]?.terminated, true);
});
