// POST /api/ai/review: 서버 재계산만 저장(클라이언트 JudgmentResult 불신)·폴백 AR012·스위치·멱등(AR-06-051). 차감은 가짜 start_ai_run이 센다.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { judge, loadRulePack, type RulePack } from "../../../../../../packages/rules/src/index.ts";
import { FIXTURE_PACK_RAW, fixtureModel } from "../../../../../../packages/rules/src/test-fixtures.ts";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import type { RunStarter } from "../gateway/start-run.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { isReviewEnabled } from "./config.ts";
import { recomputeJudgment } from "./recompute.ts";
import { handleReview, REVIEW_MAX_BODY, type ReviewDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 10, 2, 3, 0, 0);
// 픽스처 팩의 가짜 지자체 코드를 DB 형식(숫자 5~10자리)으로 바꾼다: T-OK = 조례 확인, T-NO = 조례 미확인.
const MUNI_OK = "1168010100";
const MUNI_NO = "2635010100";
const PACK: RulePack = loadRulePack(JSON.parse(JSON.stringify(FIXTURE_PACK_RAW).replaceAll('"T-OK"', `"${MUNI_OK}"`).replaceAll('"T-NO"', `"${MUNI_NO}"`)));

function model(municipality = MUNI_OK) {
  return fixtureModel({ municipality_code: municipality });
}

interface World {
  enabled: boolean;
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  packs: Map<string, RulePack>;
  packFails?: boolean;
  dbError?: string;
  runs: Map<string, { run_id: string; job_id: string; credits: number }>;
  stored: Record<string, unknown>[];
  charged: number;
  starterCalls: number;
  sessionCalls: number;
}

function world(over: Partial<World> = {}): World {
  return {
    enabled: true,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    features: { cloud_review: true },
    packs: new Map([[PACK.version, PACK]]),
    runs: new Map(),
    stored: [],
    charged: 0,
    starterCalls: 0,
    sessionCalls: 0,
    ...over,
  };
}

let seq = 0;
function fakeStarter(w: World): RunStarter {
  return {
    async startAiRun(args) {
      w.starterCalls += 1;
      if (w.dbError) throw Object.assign(new Error("db"), { code: w.dbError });
      const existing = w.runs.get(args.p_request_id);
      if (existing) return [existing];
      seq += 1;
      const hex = seq.toString(16).padStart(12, "0");
      const row = { run_id: `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`, job_id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`, credits: 15 };
      w.runs.set(args.p_request_id, row);
      w.stored.push(args.p_options);
      w.charged += 15;
      return [row];
    },
    async runExists(requestId) {
      return w.runs.has(requestId);
    },
  };
}

function deps(w: World): ReviewDeps {
  return {
    enabled: () => w.enabled,
    session: {
      async resolve() {
        w.sessionCalls += 1;
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    org: () => ({ orgFeatures: async () => w.features }),
    packs: () => ({
      async load(version) {
        if (w.packFails) throw new Error("storage 500 service_role=secret");
        return w.packs.get(version) ?? null;
      },
    }),
    starter: () => fakeStarter(w),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
  };
}

let reqSeq = 0;
function rid(): string {
  reqSeq += 1;
  return `22222222-2222-4222-8222-${reqSeq.toString(16).padStart(12, "0")}`;
}

function body(over: Record<string, unknown> = {}, m = model()): Record<string, unknown> {
  return {
    request_id: rid(),
    project_ref: PROJECT,
    rule_pack_version: m.rule_context.rule_pack_version,
    application_date: m.rule_context.application_date,
    municipality_code: m.rule_context.municipality_code,
    design_model: m,
    ...over,
  };
}

function req(b: unknown): Request {
  return new Request("http://localhost/api/ai/review", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-access-token-value-0123456789" },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

function quiet(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

async function call(w: World, b: unknown = body()): Promise<{ status: number; json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
  const res = await handleReview(req(b), deps(w));
  return { status: res.status, json: (await res.json()) as never };
}

test("review: 정상 → 202 · review/review · 저장 판정 = 서버 packages/rules 재계산 값", async (t) => {
  quiet(t);
  const w = world();
  const r = await call(w);
  assert.equal(r.status, 202);
  assert.deepEqual(Object.keys(r.json.data ?? {}).sort(), ["credits", "job_id", "run_id"]);
  assert.equal(w.charged, 15);
  const stored = w.stored[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ["application_date", "judgment", "model_summary", "municipality_code", "rule_pack_version"]);
  assert.deepEqual(stored.judgment, judge(model(), PACK).result);
  assert.deepEqual(stored.model_summary, {
    site_area_m2: 300,
    use_district: "가짜주거",
    floors: 2,
    gross_area_m2: 160,
    building_area_m2: 80,
    height_mm: 6000,
    ordinance_unverified: [],
  });
});

test("클라이언트 JudgmentResult·model_summary 불신: 조작한 값을 보내도 서버 재계산 값만 저장", async (t) => {
  quiet(t);
  const w = world();
  const honest = judge(model(), PACK).result;
  const forged = {
    ...honest,
    items: honest.items.map((i) => ({ ...i, verdict: "PASS", value: 1, limit: 999 })),
  };
  const r = await call(w, body({ judgment: forged, model_summary: { site_area_m2: 1, gross_area_m2: 99999 } }));
  assert.equal(r.status, 202);
  const stored = w.stored[0] as { judgment: unknown; model_summary: { site_area_m2: number; gross_area_m2: number } };
  assert.deepEqual(stored.judgment, honest);
  assert.notDeepEqual(stored.judgment, forged);
  assert.equal(stored.model_summary.site_area_m2, 300);
  assert.equal(stored.model_summary.gross_area_m2, 160);
});

test("조례 미확인 지자체 → model_summary.ordinance_unverified에 서버가 찾은 key", async (t) => {
  quiet(t);
  const w = world();
  const m = model(MUNI_NO);
  const r = await call(w, body({}, m));
  assert.equal(r.status, 202);
  const expected = recomputeJudgment(m, PACK).summary.ordinance_unverified;
  assert.ok(expected.length > 0);
  assert.deepEqual((w.stored[0] as { model_summary: { ordinance_unverified: string[] } }).model_summary.ordinance_unverified, expected);
});

test("재계산은 결정적(같은 입력 → 같은 출력)", () => {
  assert.deepEqual(recomputeJudgment(model(), PACK), recomputeJudgment(JSON.parse(JSON.stringify(model())), PACK));
});

test("폴백 AR012: 엔타이틀먼트 만료·cloud_review 꺼짐 → 403 AR012, 차감 0 / DB AR012도 403", async (t) => {
  quiet(t);
  const expired = world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: "user-access-token-value-0123456789" } });
  let r = await call(expired);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "AR012");
  assert.equal(expired.starterCalls, 0);

  const fallback = world({ features: { cloud_review: false, state: "fallback" } });
  r = await call(fallback);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "AR012");
  assert.equal(fallback.charged, 0);

  const db = world({ dbError: "AR012" });
  r = await call(db);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "AR012");
  assert.equal(db.charged, 0);
});

const REVIEW_CONFIG_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "https://ai.example.com" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://127.0.0.1:8000" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://localhost:8000/" }, true],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://ai.example.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "true", ARCH_AI_API_URL: "http://localhost.evil.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "true" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "TRUE", ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{ ARCH_AI_REVIEW_ENABLED: "1", ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{ ARCH_AI_API_URL: "https://ai.example.com" }, false],
  [{}, false],
];

test("스위치: 'true' + 그래프 서버 주소일 때만 켬 — 워커와 같은 표", () => {
  for (const [env, expected] of REVIEW_CONFIG_CASES) assert.equal(isReviewEnabled(env), expected, JSON.stringify(env));
});

test("스위치 off → 503 · 세션·start_ai_run 호출 0", async (t) => {
  quiet(t);
  const w = world({ enabled: false });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "ai_review_disabled");
  assert.equal(w.sessionCalls, 0);
  assert.equal(w.starterCalls, 0);
});

test("rule_context 불일치·없는 팩 버전 → 22023, 팩 저장소 오류 → 503(원문 없음), 차감 0", async (t) => {
  const lines = quiet(t);
  const w = world();
  assert.equal((await call(w, body({ application_date: "2000-04-01" }))).json.error?.code, "22023");
  assert.equal((await call(w, body({ municipality_code: MUNI_NO }))).json.error?.code, "22023");
  const other = fixtureModel({ municipality_code: MUNI_OK, rule_pack_version: "2000.02.1" });
  assert.equal((await call(w, body({}, other))).json.error?.code, "22023");
  const broken = world({ packFails: true });
  const r = await call(broken);
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "storage_unavailable");
  assert.ok(!lines.join("\n").includes("secret"));
  assert.equal(w.charged + broken.charged, 0);
});

test("DesignModel 계약 위반·본문 형식 오류 → 422, 256KB 초과 → 413, 차감 0", async (t) => {
  quiet(t);
  const w = world();
  const bad = { ...model(), extra: 1 };
  assert.equal((await call(w, body({}, bad as never))).status, 422);
  assert.equal((await call(w, body({ request_id: "not-uuid" }))).status, 422);
  assert.equal((await call(w, body({ unknown_key: true }))).status, 422);
  assert.equal((await call(w, body({ municipality_code: "T-OK" }))).status, 422);
  const big = body({ model_summary: "x".repeat(REVIEW_MAX_BODY) });
  assert.equal((await call(w, big)).status, 413);
  assert.equal(w.starterCalls, 0);
});

test("역할 viewer → 403 42501 · 세션 없음 → 401", async (t) => {
  quiet(t);
  const viewer = world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: "user-access-token-value-0123456789" } });
  assert.equal((await call(viewer)).json.error?.code, "42501");
  const anon = world({ session: new GatewayError("unauthorized") });
  assert.equal((await call(anon)).status, 401);
  assert.equal(viewer.starterCalls + anon.starterCalls, 0);
});

test("같은 request_id 재전송 → 같은 실행, 차감 1회 · 크레딧 부족 CR001 402 · 일일 상한 429", async (t) => {
  quiet(t);
  const w = world();
  const b = body();
  const first = await call(w, b);
  const second = await call(w, b);
  assert.equal(second.status, 202);
  assert.deepEqual(second.json.data, first.json.data);
  assert.equal(w.charged, 15);
  assert.equal(w.stored.length, 1);
  assert.equal((await call(world({ dbError: "CR001" }))).status, 402);
  const capped = await call(world({ dbError: "AR034" }));
  assert.equal(capped.status, 429);
  assert.equal(capped.json.error?.code, "AI_DAILY_LIMIT");
});
