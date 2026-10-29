// arch.start_ai_run 헬퍼: 입력 검사·오류 매핑·금액 키 거부·consume_credits 직접 호출 0(tasks/logs/AR-06-047.md P6·P7).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { GatewayError } from "./http.ts";
import { mapStartRunError, startAiRun, type RunStarter, type StartAiRunInput } from "./start-run.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const base: StartAiRunInput = {
  orgId: ORG,
  actorId: USER,
  kind: "review",
  variant: "review",
  requestId: REQ,
  projectRef: PROJECT,
  options: { rule_pack_version: "2026.10.1" },
};

function starter(result: unknown, calls: unknown[] = []): RunStarter {
  return {
    async startAiRun(args) {
      calls.push(args);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function quiet(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    assert.ok(e instanceof GatewayError);
    return e.code;
  }
}

test("정상: RPC 인자 = 세션 조직·행위자, 금액 인자 없음, 반환 그대로", async (t) => {
  quiet(t);
  const calls: Record<string, unknown>[] = [];
  const out = await startAiRun(starter([{ run_id: RUN, job_id: JOB, credits: 15 }], calls), base);
  assert.deepEqual(out, { run_id: RUN, job_id: JOB, credits: 15 });
  assert.deepEqual(Object.keys(calls[0] as object).sort(), ["p_actor", "p_kind", "p_options", "p_org", "p_project_ref", "p_request_id", "p_variant"]);
  assert.equal((calls[0] as Record<string, unknown>).p_org, ORG);
});

test("멱등: request_id는 UUID v4만(대문자·v1·빈 값 거부), RPC 호출 0", async (t) => {
  quiet(t);
  for (const requestId of ["", "ABCDEF12-2222-4222-A222-22222222222A", "22222222-2222-1222-8222-222222222222", "x"]) {
    const calls: unknown[] = [];
    assert.equal(await code(startAiRun(starter([], calls), { ...base, requestId })), "invalid_input", requestId);
    assert.equal(calls.length, 0);
  }
});

test("kind·variant 표 밖·Phase 2 kind → 22023, RPC 호출 0", async (t) => {
  quiet(t);
  const bad: Partial<StartAiRunInput>[] = [
    { kind: "render", variant: "review" },
    { kind: "review", variant: "render_std" },
    { kind: "layout", variant: "layout" },
    { kind: "walkthrough", variant: "walkthrough" },
    { kind: "__proto__" as "render", variant: "render_std" },
    { orgId: "not-uuid" },
    { projectRef: "../x" },
  ];
  for (const b of bad) {
    const calls: unknown[] = [];
    assert.equal(await code(startAiRun(starter([], calls), { ...base, ...b })), "22023", JSON.stringify(b));
    assert.equal(calls.length, 0);
  }
});

test("options에 금액·조직·행위자 키가 있으면 거부(중첩·대소문자 포함)", async (t) => {
  quiet(t);
  const bad = [
    { credits: 0 },
    { nested: { amount: 1 } },
    { list: [{ Price: 1 }] },
    { org_id: ORG },
    { p_actor: USER },
    JSON.parse('{"__proto__": {"credits": 0}}'),
  ];
  for (const options of bad) {
    const calls: unknown[] = [];
    assert.equal(await code(startAiRun(starter([], calls), { ...base, options })), "invalid_input", JSON.stringify(options));
    assert.equal(calls.length, 0);
  }
});

test("SQLSTATE 매핑: AR012·AR030·AR031·AR034(AI_DAILY_LIMIT)·CR001·42501·22023·23514·P0002, 그 밖은 internal", async (t) => {
  quiet(t);
  const table: [string, string][] = [
    ["AR012", "AR012"],
    ["AR030", "AR030"],
    ["AR031", "AR031"],
    ["AR034", "AI_DAILY_LIMIT"],
    ["CR001", "CR001"],
    ["42501", "42501"],
    ["22023", "22023"],
    ["23514", "23514"],
    ["P0002", "not_found"],
    ["XX000", "internal"],
  ];
  for (const [sqlstate, expected] of table) {
    assert.equal(mapStartRunError({ code: sqlstate }), expected);
    const err = Object.assign(new Error(`raise: secret detail ${sqlstate}`), { code: sqlstate });
    assert.equal(await code(startAiRun(starter(err), base)), expected);
  }
  assert.equal(mapStartRunError(null), "internal");
});

test("반환 형식이 이상하면 internal(빈 행·음수·실수 크레딧·UUID 아님)", async (t) => {
  quiet(t);
  for (const bad of [[], [{ run_id: RUN, job_id: JOB, credits: -1 }], [{ run_id: RUN, job_id: JOB, credits: 1.5 }], [{ run_id: "x", job_id: JOB, credits: 1 }], null]) {
    assert.equal(await code(startAiRun(starter(bad), base)), "internal", JSON.stringify(bad));
  }
});

test("반환 크레딧이 pricing.ts와 다르면 원장 값을 돌려주고 오류 로그만(운영 신호)", async (t) => {
  const lines = quiet(t);
  const out = await startAiRun(starter([{ run_id: RUN, job_id: JOB, credits: 99 }]), base);
  assert.equal(out.credits, 99);
  assert.ok(lines.some((l) => l.includes("start_ai_run.price_mismatch")));
  assert.ok(!lines.join("").includes("rule_pack_version"));
});

test("doc_template 같은 버전 재요청(DB가 0크레딧)은 정상: price_mismatch 오류 로그 없음", async (t) => {
  const lines = quiet(t);
  const out = await startAiRun(starter([{ run_id: RUN, job_id: JOB, credits: 0 }]), { ...base, kind: "proposal", variant: "doc_template", options: {} });
  assert.equal(out.credits, 0);
  assert.ok(!lines.some((l) => l.includes("price_mismatch")));
  assert.ok(lines.some((l) => l.includes("start_ai_run.free_rerun")));
});

test("0크레딧이라도 doc_template이 아니면 여전히 오류 로그", async (t) => {
  const lines = quiet(t);
  await startAiRun(starter([{ run_id: RUN, job_id: JOB, credits: 0 }]), base);
  assert.ok(lines.some((l) => l.includes("start_ai_run.price_mismatch")));
});

test("멱등 재전송(최초 차감액 반환)은 정상: price_mismatch 오류 로그 없음", async (t) => {
  const lines = quiet(t);
  const s: RunStarter = { ...starter([{ run_id: RUN, job_id: JOB, credits: 99 }]), runExists: async () => true };
  const out = await startAiRun(s, base);
  assert.equal(out.credits, 99);
  assert.ok(!lines.some((l) => l.includes("price_mismatch")));
  assert.ok(lines.some((l) => l.includes("start_ai_run.replay")));
});

test("재전송 판별이 실패하면 경보 쪽(오류 로그 유지)", async (t) => {
  const lines = quiet(t);
  const s: RunStarter = {
    ...starter([{ run_id: RUN, job_id: JOB, credits: 99 }]),
    runExists: async () => {
      throw new Error("db down");
    },
  };
  await startAiRun(s, base);
  assert.ok(lines.some((l) => l.includes("start_ai_run.price_mismatch")));
});

test("Route Handler·서버 AI 코드에서 consume_credits 직접 호출 0(04_API.md 1장 선차감 위치)", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const targets = [path.join(root, "app/api"), path.join(root, "server/ai"), path.join(root, "server/uploads"), path.join(root, "server/jobs")];
  const hits: string[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const n of readdirSync(p)) walk(path.join(p, n));
    else if (/\.tsx?$/.test(p) && !p.endsWith(".test.ts") && /consume_credits/.test(readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, ""))) hits.push(p);
  };
  for (const d of targets) walk(d);
  assert.deepEqual(hits, []);
});
