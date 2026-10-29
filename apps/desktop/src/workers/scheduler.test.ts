// 실행: node --test src/workers/*.test.ts (apps/desktop). 스케줄러 코어는 Worker·시간·난수와 무관해 Node 에서 그대로 돈다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EngineResponse, Lane } from "./protocol.ts";
import { LaneScheduler, type Effect, type Outcome } from "./scheduler.ts";

interface Req {
  req_id: string;
  lane: Lane;
  seq?: number;
}
const req = (req_id: string, lane: Lane, seq?: number): Req => (seq === undefined ? { req_id, lane } : { req_id, lane, seq });
const OK: Outcome = { ok: true, op: "x", result: null, engine_version: "t", elapsed_ms: 0 };

const replies = (e: Effect<Req>[]): EngineResponse[] => e.flatMap((x) => (x.kind === "reply" ? [x.response] : []));
const starts = (e: Effect<Req>[]): string[] => e.flatMap((x) => (x.kind === "start" ? [x.request.req_id] : []));

test("같은 레인 새 요청이 오면 대기 중이던 이전 요청은 superseded 로 답한다", () => {
  const s = new LaneScheduler<Req>();
  assert.deepEqual(starts(s.submit(req("a", "judge", 1))), ["a"]);
  assert.deepEqual(replies(s.submit(req("b", "judge", 2))), []); // a 는 실행 중: 끝날 때 답한다
  assert.deepEqual(replies(s.submit(req("c", "judge", 3))), [{ req_id: "b", status: "superseded" }]);
  const afterA = s.finish("a", OK);
  assert.deepEqual(replies(afterA), [{ req_id: "a", status: "superseded" }]);
  assert.deepEqual(starts(afterA), ["c"]);
  const afterC = s.finish("c", OK);
  assert.deepEqual(replies(afterC), [{ req_id: "c", seq: 3, ok: true, op: "x", result: null, engine_version: "t", elapsed_ms: 0 }]);
  assert.equal(s.inFlight(), 0);
});

test("늦게 도착한 옛 seq 는 바로 superseded", () => {
  const s = new LaneScheduler<Req>();
  s.submit(req("new", "sheet", 5));
  assert.deepEqual(replies(s.submit(req("old", "sheet", 4))), [{ req_id: "old", status: "superseded" }]);
});

test("export 레인은 덮어쓰이지 않고 취소되지 않으며 순서대로 끝까지 실행한다", () => {
  const s = new LaneScheduler<Req>();
  assert.deepEqual(starts(s.submit(req("e1", "export"))), ["e1"]);
  assert.deepEqual(replies(s.submit(req("e2", "export"))), []);
  assert.deepEqual(s.cancel("e1"), []);
  assert.deepEqual(s.cancel("e2"), []);
  assert.equal(s.isCanceled("e1"), false);
  const a = s.finish("e1", OK);
  assert.equal((replies(a)[0] as { ok?: boolean }).ok, true);
  assert.deepEqual(starts(a), ["e2"]);
  assert.equal((replies(s.finish("e2", OK))[0] as { ok?: boolean }).ok, true);
});

test("export 요청은 같은 레인의 판정 계열 요청에 영향받지 않는다(레인 독립)", () => {
  const s = new LaneScheduler<Req>();
  assert.deepEqual(starts(s.submit(req("e", "export"))), ["e"]);
  assert.deepEqual(starts(s.submit(req("j", "judge", 1))), ["j"]);
  assert.deepEqual(starts(s.submit(req("s", "sheet", 1))), ["s"]);
  s.submit(req("j2", "judge", 2));
  assert.equal(s.isCanceled("e"), false);
  assert.equal(s.isCanceled("s"), false);
  assert.equal(s.isCanceled("j"), true);
});

test("대기 중 취소는 바로 canceled, 실행 중 취소는 표시 후 끝날 때 canceled", () => {
  const s = new LaneScheduler<Req>();
  s.submit(req("a", "import"));
  s.submit(req("b", "import"));
  assert.deepEqual(replies(s.cancel("b")), [{ req_id: "b", status: "canceled" }]);
  assert.deepEqual(s.cancel("a"), []);
  assert.equal(s.isCanceled("a"), true);
  assert.deepEqual(replies(s.finish("a", OK)), [{ req_id: "a", status: "canceled" }]);
  assert.deepEqual(s.cancel("nope"), []);
});

test("실패 결과는 seq 와 함께 오류로 답한다", () => {
  const s = new LaneScheduler<Req>();
  s.submit(req("a", "layout", 7));
  assert.deepEqual(replies(s.finish("a", { ok: false, code: "AR050", detail: "x" })), [{ req_id: "a", seq: 7, ok: false, code: "AR050", detail: "x" }]);
});

test("중복 req_id 는 오류", () => {
  const s = new LaneScheduler<Req>();
  s.submit(req("a", "judge", 1));
  const r = replies(s.submit(req("a", "judge", 2)));
  assert.equal((r[0] as { ok?: boolean }).ok, false);
});

// 속성 테스트: fast-check 는 apps/desktop 의존성에 없어(새 의존성 금지) 고정 시드 난수로 임의 순서를 만든다.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("임의 메시지 순서에서 각 최신만 유효 레인의 최종 응답은 마지막 요청의 것", () => {
  const LANES: Lane[] = ["judge", "suggest", "layout", "sheet"];
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = mulberry32(seed);
    const s = new LaneScheduler<Req>();
    const log: EngineResponse[] = [];
    const running = new Set<string>();
    const submitted: Req[] = [];
    const canceled = new Set<string>();
    const logLenAtSubmit = new Map<string, number>();
    const take = (e: Effect<Req>[]) => {
      for (const x of e) {
        if (x.kind === "start") running.add(x.request.req_id);
        else log.push(x.response);
      }
    };
    let n = 0;
    const seqs = new Map<Lane, number>();
    for (let step = 0; step < 40; step++) {
      const r = rnd();
      if (r < 0.55) {
        const lane = LANES[Math.floor(rnd() * LANES.length)] as Lane;
        const seq = (seqs.get(lane) ?? 0) + 1;
        seqs.set(lane, seq);
        const q = req(`r${n++}`, lane, seq);
        submitted.push(q);
        logLenAtSubmit.set(q.req_id, log.length);
        take(s.submit(q));
      } else if (r < 0.9 && running.size > 0) {
        const id = [...running][Math.floor(rnd() * running.size)] as string;
        running.delete(id);
        take(s.finish(id, OK));
      } else if (submitted.length > 0) {
        const q = submitted[Math.floor(rnd() * submitted.length)] as Req;
        canceled.add(q.req_id);
        take(s.cancel(q.req_id));
      }
    }
    while (running.size > 0) {
      const id = [...running][0] as string;
      running.delete(id);
      take(s.finish(id, OK));
    }
    assert.equal(s.inFlight(), 0, `seed ${seed}`);
    const terminal = log.filter((x) => !("status" in x && x.status === "progress"));
    // 모든 요청은 정확히 한 번 답한다
    for (const q of submitted) assert.equal(terminal.filter((x) => x.req_id === q.req_id).length, 1, `seed ${seed} ${q.req_id}`);
    for (const lane of LANES) {
      const inLane = submitted.filter((q) => q.lane === lane);
      const last = inLane[inLane.length - 1];
      if (!last) continue;
      const laneIds = new Set(inLane.map((q) => q.req_id));
      const laneReplies = terminal.filter((x) => laneIds.has(x.req_id));
      const finalReply = laneReplies[laneReplies.length - 1] as EngineResponse;
      // 마지막 요청이 취소됐다면 canceled 답이 앞선 요청의 늦은 답보다 먼저 나갈 수 있어 순서는 보지 않는다
      if (!canceled.has(last.req_id)) {
        assert.equal(finalReply.req_id, last.req_id, `seed ${seed} ${lane}: 최종 응답이 마지막 요청의 것이 아님`);
        assert.ok("ok" in finalReply && finalReply.ok, `seed ${seed} ${lane}: 마지막 요청이 성공해야 함`);
      }
      // 성공 응답은 그 뒤에 더 새 요청이 없던 요청만 받는다: 마지막이 아닌 요청의 ok 는 새 요청이 오기 전에 끝난 것
      for (const q of inLane) {
        const rep = laneReplies.find((x) => x.req_id === q.req_id) as EngineResponse;
        if ("ok" in rep && rep.ok && q !== last) {
          const newer = inLane[inLane.indexOf(q) + 1] as Req;
          assert.ok(log.indexOf(rep) < (logLenAtSubmit.get(newer.req_id) as number), "새 요청이 온 뒤에 옛 요청이 성공으로 끝났다");
        }
      }
    }

  }
});
