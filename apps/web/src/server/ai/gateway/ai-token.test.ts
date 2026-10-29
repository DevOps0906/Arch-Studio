// POST /api/internal/ai-token: 워커 키·본문·잡 상태·scope·조직·행위자·로그(tasks/logs/AR-06-047.md P1~P5·P10·P12·P15).
// DB는 AiTokenRepo 목. 실제 RLS/RPC 시나리오는 작업 로그 "통합 테스트" 목록.
import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { test, type TestContext } from "node:test";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { newEd25519Pem } from "../../licenses/test-helpers.ts";
import { createAiTokenSigner, verifyAiToken } from "../token/signer.ts";
import { handleAiSettle, handleAiToken, type AiTokenDeps, type JobRow, type RunRow, type RunTable } from "./ai-token.ts";

const WORKER_KEY = "wk_" + "x".repeat(40);
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const AI = newEd25519Pem();
const SIGNER = createAiTokenSigner({ privateKey: AI.pem, kid: "ai-t", licensePrivateKey: newEd25519Pem().pem, licenseKid: "lic-t" });
const KEYS = { "ai-t": createPublicKey(AI.pem).export({ format: "der", type: "spki" }) };

interface World {
  job: JobRow | null;
  runs: Partial<Record<RunTable, RunRow | null>>;
  member: boolean;
  calls: string[];
  workerKey?: string | undefined;
  signerFails?: boolean;
  repoThrows?: boolean;
}

function world(over: Partial<World> = {}): World {
  return {
    job: { id: JOB, org_id: ORG, app_id: "arch", job_type: "arch.review", status: "running", created_by: USER },
    runs: { reviews: { id: RUN, org_id: ORG, status: "running", created_by: USER } },
    member: true,
    calls: [],
    workerKey: WORKER_KEY,
    ...over,
  };
}

function deps(w: World, rate = new MemoryRateLimitStore()): AiTokenDeps {
  return {
    repo: () => ({
      async getJob(id) {
        w.calls.push(`getJob:${id}`);
        if (w.repoThrows) throw Object.assign(new Error("connection refused at db.internal:5432 password=hunter2"), { code: "08006" });
        return w.job;
      },
      async getRunByJob(table, id) {
        w.calls.push(`getRun:${table}:${id}`);
        return w.runs[table] ?? null;
      },
      async isActiveMember(org, user) {
        w.calls.push(`member:${org}:${user}`);
        return w.member;
      },
    }),
    signer: () => {
      if (w.signerFails) return createAiTokenSigner({ privateKey: undefined, kid: undefined, licensePrivateKey: undefined, licenseKid: undefined });
      return SIGNER;
    },
    workerKey: () => w.workerKey,
    rateLimit: rate,
    now: () => NOW,
  };
}

function req(body: unknown, auth: string | null = `Bearer ${WORKER_KEY}`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth !== null) headers.authorization = auth;
  return new Request("https://web.example/api/internal/ai-token", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(w: World, body: unknown = { job_id: JOB, scope: "graph:arch.review" }, auth?: string | null) {
  const res = await handleAiToken(req(body, auth === undefined ? `Bearer ${WORKER_KEY}` : auth), deps(w));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

function spyLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) {
    t.mock.method(console, m, (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  return lines;
}

test("발급: running 잡·활성 실행·활성 멤버 → 잡 토큰(run·job 바인딩, 조직은 DB 값)", async (t) => {
  spyLogs(t);
  const w = world();
  const { status, json } = await call(w);
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.token, json.data.token); // 워커 호환 필드
  const v = verifyAiToken(json.data.token, KEYS, NOW / 1000 + 1);
  assert.ok(v.ok);
  assert.equal(v.claims.sub, `job:${JOB}`);
  assert.equal(v.claims.job, JOB);
  assert.equal(v.claims.run, RUN);
  assert.equal(v.claims.org, ORG);
  assert.equal(v.claims.scope, "graph:arch.review");
  assert.equal(v.claims.feat, "arch.review");
  assert.equal(json.data.expires_at, new Date(NOW + 300_000).toISOString());
  assert.deepEqual(w.calls, [`getJob:${JOB}`, `getRun:reviews:${JOB}`, `member:${ORG}:${USER}`]);
});

test("워커 키: 누락·틀림·접두만 일치·다른 스킴·Supabase 사용자 토큰 → 401, DB 호출 0", async (t) => {
  spyLogs(t);
  const userJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlc2lnbmF0dXJl";
  for (const auth of [null, "", `Bearer ${WORKER_KEY}x`, `Bearer ${WORKER_KEY.slice(0, -1)}`, `Basic ${WORKER_KEY}`, `Bearer ${userJwt}`, `bearer  ${WORKER_KEY}`]) {
    const w = world();
    const { status, json } = await call(w, undefined, auth);
    assert.equal(status, 401, String(auth));
    assert.equal(json.error.code, "unauthorized");
    assert.deepEqual(w.calls, []);
  }
});

test("워커 키 설정이 없거나 32자 미만이면 503(경로 닫힘)", async (t) => {
  spyLogs(t);
  for (const key of [undefined, "", "short-key"]) {
    const w = world({ workerKey: key });
    const { status } = await call(w, undefined, `Bearer ${key ?? ""}`);
    assert.equal(status, 503);
    assert.deepEqual(w.calls, []);
  }
});

test("본문: org_id·credits·run_id 등 다른 키, 허용 밖 scope, UUID 아님 → 422 / JSON 아님 400 / 큼 413", async (t) => {
  spyLogs(t);
  const bad: unknown[] = [
    { job_id: JOB, scope: "graph:arch.review", org_id: OTHER_ORG },
    { job_id: JOB, scope: "graph:arch.review", credits: 0 },
    { job_id: JOB, scope: "graph:arch.review", run_id: RUN },
    { job_id: JOB, scope: "chat" },
    { job_id: JOB, scope: "graph:arch.layout" },
    { job_id: JOB, scope: "graph:arch.review graph:arch.intake" },
    { job_id: "../x", scope: "graph:arch.review" },
    { job_id: JOB.toUpperCase(), scope: "graph:arch.review" },
    { scope: "graph:arch.review" },
    [],
  ];
  for (const b of bad) {
    const w = world();
    assert.equal((await call(w, b)).status, 422, JSON.stringify(b));
    assert.deepEqual(w.calls, []);
  }
  assert.equal((await call(world(), "{nope")).status, 400);
  assert.equal((await call(world(), { job_id: JOB, scope: "graph:arch.review", pad: "x".repeat(2000) })).status, 413);
});

test("running이 아닌 잡(queued·succeeded·failed·canceled) → 409, 토큰 없음", async (t) => {
  spyLogs(t);
  for (const status of ["queued", "succeeded", "failed", "canceled"]) {
    const w = world();
    w.job = { ...(w.job as JobRow), status };
    const r = await call(w);
    assert.equal(r.status, 409, status);
    assert.equal(r.json.error.code, "job_not_running");
    assert.equal(r.json.token, undefined);
  }
});

test("실행 행이 끝났거나(succeeded·failed·refunded) 없거나 다른 조직이면 거부", async (t) => {
  spyLogs(t);
  for (const status of ["succeeded", "failed", "refunded"]) {
    const w = world({ runs: { reviews: { id: RUN, org_id: ORG, status, created_by: USER } } });
    assert.equal((await call(w)).status, 409, status);
  }
  assert.equal((await call(world({ runs: { reviews: null } }))).status, 404);
  assert.equal((await call(world({ runs: { reviews: { id: RUN, org_id: OTHER_ORG, status: "running", created_by: USER } } }))).status, 404);
});

test("없는 잡·다른 제품 잡은 같은 404", async (t) => {
  spyLogs(t);
  const missing = await call(world({ job: null }));
  const w = world();
  w.job = { ...(w.job as JobRow), app_id: "toon" };
  const other = await call(w);
  assert.equal(missing.status, 404);
  assert.deepEqual(other, missing);
});

test("scope는 job_type의 허용 1개와 정확히 일치(다른 그래프·렌더·STT 잡은 403)", async (t) => {
  spyLogs(t);
  assert.equal((await call(world(), { job_id: JOB, scope: "graph:arch.intake" })).status, 403);
  for (const job_type of ["arch.render", "arch.stt", "arch.layout", "toString", "__proto__"]) {
    const w = world();
    w.job = { ...(w.job as JobRow), job_type };
    const r = await call(w);
    assert.equal(r.status, 403, job_type);
    assert.equal(r.json.error.code, "scope_mismatch");
  }
});

test("intake: source=consult → feat arch.intake_consult(오픈소스 강제), chat → arch.intake", async (t) => {
  spyLogs(t);
  for (const [source, feat] of [["consult", "arch.intake_consult"], ["chat", "arch.intake"]] as const) {
    const w = world({ runs: { intake_runs: { id: RUN, org_id: ORG, status: "queued", created_by: USER, source } } });
    w.job = { ...(w.job as JobRow), job_type: "arch.intake" };
    const r = await call(w, { job_id: JOB, scope: "graph:arch.intake" });
    assert.equal(r.status, 200);
    const v = verifyAiToken(r.json.data.token, KEYS, NOW / 1000);
    assert.ok(v.ok);
    assert.equal(v.claims.feat, feat);
  }
});

test("proposal: variant=proposal만 서술 토큰, doc_template은 403", async (t) => {
  spyLogs(t);
  for (const [variant, status] of [["proposal", 200], ["doc_template", 403]] as const) {
    const w = world({ runs: { proposals: { id: RUN, org_id: ORG, status: "running", created_by: USER, variant } } });
    w.job = { ...(w.job as JobRow), job_type: "arch.proposal_pdf" };
    assert.equal((await call(w, { job_id: JOB, scope: "graph:arch.proposal_narrative" })).status, status, variant);
  }
});

test("행위자: 실행 행 created_by 없음·잡 created_by와 다름·비활성 멤버 → 403", async (t) => {
  spyLogs(t);
  assert.equal((await call(world({ member: false }))).status, 403);
  assert.equal((await call(world({ runs: { reviews: { id: RUN, org_id: ORG, status: "running", created_by: null } } }))).status, 403);
  const w = world();
  w.job = { ...(w.job as JobRow), created_by: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
  assert.equal((await call(w)).status, 403);
});

test("서명기 실패 → 503, DB 호출 전", async (t) => {
  spyLogs(t);
  const w = world({ signerFails: true });
  assert.equal((await call(w)).status, 503);
  assert.deepEqual(w.calls, []);
});

test("레이트 리밋: 600회/분 초과 429 + retry-after", async (t) => {
  spyLogs(t);
  const rate = new MemoryRateLimitStore();
  const w = world();
  for (let i = 0; i < 600; i++) rate.hit("arch:ai_token:worker", 600, 60, NOW);
  const res = await handleAiToken(req({ job_id: JOB, scope: "graph:arch.review" }), deps(w, rate));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
});

test("로그·응답에 토큰·워커 키·DB 오류 원문이 없다", async (t) => {
  const lines = spyLogs(t);
  const ok = await call(world());
  const failed = await call(world({ repoThrows: true }));
  assert.equal(failed.status, 500);
  assert.deepEqual(Object.keys(failed.json.error).sort(), ["code", "message"]);
  await call(world(), undefined, "Bearer wrong-key-but-long-enough-0000000000000");
  const all = lines.join("\n") + JSON.stringify(failed.json);
  assert.ok(lines.length >= 3);
  for (const secret of [ok.json.data.token, ok.json.data.token.split(".")[1], WORKER_KEY, "hunter2", "db.internal", "wrong-key-but"]) {
    assert.ok(!all.includes(secret), `leak: ${secret.slice(0, 12)}`);
  }
  assert.doesNotMatch(all, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
});

test("ai-settle: 워커 키 없으면 401, 있으면 501(미구현 명시)", async (t) => {
  spyLogs(t);
  const d = { workerKey: () => WORKER_KEY };
  const mk = (auth?: string) =>
    new Request("https://web.example/api/internal/ai-settle", { method: "POST", headers: auth ? { authorization: auth } : {} });
  assert.equal((await handleAiSettle(mk(), d)).status, 401);
  const res = await handleAiSettle(mk(`Bearer ${WORKER_KEY}`), d);
  assert.equal(res.status, 501);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "not_implemented");
});
