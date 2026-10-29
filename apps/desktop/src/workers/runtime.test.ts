import assert from "node:assert/strict";
import { test } from "node:test";
import { exportFileName } from "./fileName.ts";
import { parseRequest, type EngineResponse, type LaneRequest } from "./protocol.ts";
import { WorkerRuntime, type Handler, type LogEntry, type RuntimeOptions } from "./runtime.ts";

const SECRET = "비밀-주소-12345";
const tick = () => new Promise<void>((r) => setImmediate(r));

function setup(handlers: Partial<Record<LaneRequest["op"], Handler>>, control?: RuntimeOptions["control"]) {
  const posted: EngineResponse[] = [];
  const logs: LogEntry[] = [];
  let t = 0;
  const rt = new WorkerRuntime({
    lanes: ["judge", "suggest", "layout", "sheet", "export", "import"],
    handlers,
    ...(control ? { control } : {}),
    post: (m) => void posted.push(m),
    now: () => (t += 5),
    yieldFn: () => Promise.resolve(),
    log: (e) => void logs.push(e),
  });
  return { rt, posted, logs };
}

const judgeMsg = (id: string, seq: number) => ({ op: "judge", req_id: id, lane: "judge", seq, model_rev: "r", model: { address: SECRET } });

test("봉투 검사: lane 불일치·seq 누락·알 수 없는 op", () => {
  assert.equal(parseRequest({ op: "judge", req_id: "a", lane: "sheet", seq: 1 }).ok, false);
  assert.equal(parseRequest({ op: "judge", req_id: "a", lane: "judge" }).ok, false);
  assert.equal(parseRequest({ op: "zzz", req_id: "a" }).ok, false);
  assert.equal(parseRequest({ op: "write", req_id: "a", lane: "export" }).ok, true);
  assert.equal(parseRequest(null).ok, false);
});

test("런타임: 같은 레인 연속 요청은 앞이 superseded, 마지막만 결과", async () => {
  const gates: Array<() => void> = [];
  const { rt, posted } = setup({
    judge: async (req, ctx) => {
      await new Promise<void>((r) => gates.push(r));
      await ctx.checkpoint();
      return { result: req.req_id, engine_version: "t" };
    },
  });
  rt.receive(judgeMsg("a", 1));
  await tick();
  rt.receive(judgeMsg("b", 2));
  rt.receive(judgeMsg("c", 3));
  gates.shift()?.();
  await tick();
  gates.shift()?.();
  await tick();
  assert.deepEqual(posted.map((p) => ("status" in p ? `${p.req_id}:${p.status}` : `${p.req_id}:ok`)), ["b:superseded", "a:superseded", "c:ok"]);
});

test("런타임: 실행 중 취소는 단계 경계에서 멈추고 canceled", async () => {
  const gates: Array<() => void> = [];
  const { rt, posted } = setup({
    build_sheet: async (_req, ctx) => {
      await new Promise<void>((r) => gates.push(r));
      await ctx.checkpoint();
      throw new Error("도달하면 안 됨");
    },
  });
  rt.receive({ op: "build_sheet", req_id: "s1", lane: "sheet", seq: 1, input: {} });
  await tick();
  rt.receive({ op: "cancel", req_id: "s1" });
  gates.shift()?.();
  await tick();
  assert.deepEqual(posted, [{ req_id: "s1", status: "canceled" }]);
});

test("런타임: export 는 같은 시점의 다른 요청·취소에도 끝까지 실행", async () => {
  const gates: Array<() => void> = [];
  const { rt, posted } = setup({
    write: async (_req, ctx) => {
      await new Promise<void>((r) => gates.push(r));
      await ctx.checkpoint();
      return { result: { files: [] }, engine_version: "t" };
    },
    build_sheet: () => ({ result: 1, engine_version: "t" }),
  });
  rt.receive({ op: "write", req_id: "w1", lane: "export", format: "dxf", sheets: [], layer_map: {}, bundle: false, project_name: "p", date: "2026-10-29" });
  await tick();
  rt.receive({ op: "build_sheet", req_id: "s", lane: "sheet", seq: 1, input: {} });
  rt.receive({ op: "cancel", req_id: "w1" });
  await tick();
  gates.shift()?.();
  await tick();
  assert.deepEqual(posted.map((p) => `${p.req_id}:${"ok" in p && p.ok ? "ok" : "x"}`), ["s:ok", "w1:ok"]);
});

test("로그에는 본문(모델·좌표)이 한 글자도 남지 않는다", async () => {
  const { rt, posted, logs } = setup({
    judge: (req) => {
      if (req.req_id === "bad") throw new Error(`모델 ${SECRET} 이상`);
      return { result: { ok: 1 }, engine_version: "t" };
    },
  });
  rt.receive(judgeMsg("good", 1));
  await tick();
  rt.receive(judgeMsg("bad", 2));
  await tick();
  rt.receive({ op: "judge", req_id: "x", lane: "judge", seq: "zz", model: { address: SECRET } });
  await tick();
  assert.ok(logs.length >= 3);
  assert.equal(JSON.stringify(logs).includes(SECRET), false);
  assert.equal(JSON.stringify(posted).includes(SECRET), false); // 알 수 없는 예외의 문구도 응답에 새지 않는다
  for (const e of logs) assert.deepEqual(Object.keys(e).filter((k) => !["op", "lane", "req_id", "status", "elapsed_ms", "code"].includes(k)), []);
});

test("다른 워커의 레인·미구현 op 는 AR050", () => {
  const { rt, posted } = setup({});
  rt.receive(judgeMsg("a", 1));
  assert.equal((posted[0] as { code?: string }).code, "AR050");
});

test("내보내기 파일 이름: 규칙·금지 문자·길이", () => {
  assert.equal(exportFileName("한남동주택", "site_plan", 0, 200, "2026-10-16", "dxf"), "한남동주택_SP_01_1-200_20261016.dxf");
  assert.equal(exportFileName("a/b:c", "area_plan", 1, 100, "2026-10-16", "svg"), "a_b_c_AP_02_1-100_20261016.svg");
  assert.ok([...exportFileName("가".repeat(300), "site_plan", 0, 200, "2026-10-16", "dxf")].length <= 120);
});

test("규칙 팩 공급 상태 코드(AR-06-042): 없음 AR063, 이유 코드 그대로, 공급 실패는 받은 팩을 비운다, 잘못된 팩 AR064", async () => {
  const { createEngineHandlers } = await import("./engine.handlers.ts");
  const { RulePackStore } = await import("./rulePacks.ts");
  const { loadRulePack } = await import("@arch-studio/rules");
  const { readFileSync } = await import("node:fs");
  const raw = JSON.parse(readFileSync(new URL("../../../../packages/rules/packs/2026.10.0/pack.json", import.meta.url), "utf8"));
  loadRulePack(structuredClone(raw)); // 개발용 팩이 유효한지
  const store = new RulePackStore();
  const eng = createEngineHandlers(store);
  const e = setup(eng.handlers, eng.control);
  const judgeOnce = async (seq: number) => {
    e.posted.length = 0;
    e.rt.receive({ op: "judge", req_id: `j${seq}`, lane: "judge", seq, model_rev: "r", model: { rule_context: { rule_pack_version: "x" } } });
    await tick();
    await tick();
    return e.posted.map((p) => ("code" in p ? p.code : "ok"));
  };
  assert.deepEqual(await judgeOnce(1), ["AR063"]);
  for (const code of ["AR064", "AR065"] as const) {
    e.rt.receive({ op: "load_rule_pack", req_id: `u-${code}`, version: "", sha256: "", pack: null, unavailable: code });
    await tick();
    assert.deepEqual(await judgeOnce(code === "AR064" ? 2 : 3), [code]);
  }
  // 팩을 넣으면 선택은 된다(모델이 엉터리라 판정 자체는 다른 오류).
  e.rt.receive({ op: "load_rule_pack", req_id: "p", version: "2026.10.0", sha256: "s", pack: raw });
  await tick();
  assert.ok(!(await judgeOnce(4)).some((c) => c === "AR063" || c === "AR065"));
  await assert.rejects(store.select("2026.10.0").then(() => store.markUnavailable("AR065")).then(() => store.select("2026.10.0")), (err: { code?: string }) => err.code === "AR065");
  // 형식이 틀린 팩·버전 불일치 → AR064(검증 실패), 모르는 이유 코드는 봉투 오류(AR050).
  e.posted.length = 0;
  e.rt.receive({ op: "load_rule_pack", req_id: "bad", version: "2026.10.0", sha256: "t", pack: { nope: 1 } });
  e.rt.receive({ op: "load_rule_pack", req_id: "ver", version: "2026.11.0", sha256: "v", pack: raw });
  e.rt.receive({ op: "load_rule_pack", req_id: "weird", version: "", sha256: "", pack: null, unavailable: "AR099" });
  await tick();
  await tick();
  assert.deepEqual(Object.fromEntries(e.posted.map((p) => [p.req_id, "code" in p ? p.code : "ok"])), { bad: "AR064", ver: "AR064", weird: "AR050" });
});

test("실제 핸들러 연결: 규칙 팩 없이 judge 는 AR063(AR050과 구분), pdf 쓰기는 AR056, 잘못된 시트 입력은 AR050", async () => {
  const { createEngineHandlers } = await import("./engine.handlers.ts");
  const { createDraftingHandlers } = await import("./drafting.handlers.ts");
  const { RulePackStore } = await import("./rulePacks.ts");
  const eng = createEngineHandlers(new RulePackStore());
  const e = setup(eng.handlers);
  e.rt.receive({ op: "judge", req_id: "j", lane: "judge", seq: 1, model_rev: "r", model: { rule_context: { rule_pack_version: "x" } } });
  await tick();
  await tick();
  assert.deepEqual(e.posted.map((p) => ("code" in p ? p.code : "?")), ["AR063"]);
  const d = setup(createDraftingHandlers().handlers);
  d.rt.receive({ op: "write", req_id: "w", lane: "export", format: "pdf", sheets: [], layer_map: {}, bundle: false, project_name: "p", date: "2026-10-29" });
  d.rt.receive({ op: "build_sheet", req_id: "b", lane: "sheet", seq: 1, input: { bad: 1 } });
  await tick();
  await tick();
  const codes = Object.fromEntries(d.posted.map((p) => [p.req_id, "code" in p ? p.code : "?"]));
  assert.deepEqual(codes, { w: "AR056", b: "AR050" });
});
