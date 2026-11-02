import assert from "node:assert/strict";
import { test } from "node:test";
import type { Clock } from "../../core/clock.ts";
import type { JobRow } from "../../core/db.ts";
import { classifyError, JobError } from "../../core/errors.ts";
import { FakeClock } from "../../core/fake-clock.test-util.ts";
import { policyFor } from "../../core/policy.ts";
import { buildHandlers } from "../../handlers.ts";
import { loadReviewConfig } from "./config.ts";
import { createReviewHandler, recheckSources } from "./handler.ts";
import type { ReviewReader, ReviewRow } from "./reader.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GRAPH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const T0 = 1_000_000;

function job(attempts = 1): JobRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    org_id: ORG,
    queue: "arch.review",
    job_type: "arch.review",
    payload: { run_id: RUN, variant: "review" },
    status: "running",
    attempts,
    max_attempts: 2,
    credit_ledger_id: 1,
    run_after: "",
    last_error: null,
  };
}
const row: ReviewRow = { id: RUN, org_id: ORG, status: "running", application_date: "2025-01-01", judgment: { items: [] }, created_at_ms: T0 };
const reader = (r: ReviewRow | null = row): ReviewReader => ({ get: async () => r });

const okResult = {
  review: {
    items: [{ key: "coverage", verdict: "FAIL", sentences: [{ text: "a", source_ids: ["s1", "fake"] }, { text: "b", source_ids: ["fake"] }] }],
    needs_check: [],
    sources: [{ id: "s1" }],
  },
  refs: { "coverage.limit": 60 },
};

type Step = { status: number; body?: unknown } | "throw";
function fakeFetch(gets: Step[], posts: unknown[] = [], post: Step = { status: 202, body: { data: { graph_run_id: GRAPH, status: "accepted" } } }): typeof fetch {
  let g = 0;
  return (async (_url: string, init: RequestInit) => {
    const isPost = init.method === "POST";
    const step = isPost ? post : (gets[Math.min(g++, gets.length - 1)] as Step);
    if (isPost) posts.push(JSON.parse(init.body as string));
    if (step === "throw") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
  }) as unknown as typeof fetch;
}
const ok = (data: unknown): Step => ({ status: 200, body: { data } });
const tokens = { get: async () => "tok" };

interface Opts {
  clock?: Clock;
  attempts?: number;
  row?: ReviewRow | null;
  posts?: unknown[];
  post?: Step;
}
async function run(gets: Step[], opts: Opts = {}) {
  const clock = opts.clock ?? new FakeClock(T0 + 1000);
  const handler = createReviewHandler({
    reader: reader(opts.row === undefined ? row : opts.row),
    tokens,
    apiUrl: "http://api.test",
    clock,
    fetch: fakeFetch(gets, opts.posts, opts.post),
  });
  return handler({ job: job(opts.attempts), signal: new AbortController().signal, heartbeat: async () => {} });
}
async function rejectsWith(p: Promise<unknown>, code: string, retryable: boolean): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof JobError && e.code === code && e.retryable === retryable, `${code}/${String(retryable)}`);
}

test("정상: 폴링 뒤 결과, 이번 출처 집합 밖 id 제거, refs 그대로, attempt·timeout_s·판정 본문 전달", async () => {
  const posts: unknown[] = [];
  const r = await run([ok({ status: "running" }), ok({ status: "succeeded", result: okResult })], { posts, attempts: 2 });
  const review = r?.runResult?.["review"] as typeof okResult.review;
  assert.deepEqual(review.items[0]?.sentences, [{ text: "a", source_ids: ["s1"] }]);
  assert.deepEqual(r?.runResult?.["refs"], { "coverage.limit": 60 });
  assert.deepEqual(posts, [{ run_id: RUN, attempt: 2, application_date: "2025-01-01", timeout_s: 599, judgment: { items: [] } }]);
});

test("AR033: 그래프가 AR033이면 즉시 실패, 출처 id가 모두 지어낸 것이면 워커가 AR033", async () => {
  await rejectsWith(run([ok({ status: "failed", error: { code: "AR033", retryable: false } })]), "AR033", false);
  await rejectsWith(run([ok({ status: "failed", error: { code: "INVALID_INPUT", retryable: false } })]), "INVALID_INPUT", false);
  const bad = { review: { items: [{ key: "k", sentences: [{ text: "x", source_ids: ["fake"] }] }], needs_check: [], sources: [{ id: "s1" }] } };
  await rejectsWith(run([ok({ status: "succeeded", result: bad })]), "AR033", false);
  assert.doesNotThrow(() => recheckSources({ review: { items: [], needs_check: [], sources: [] } }));
});

test("타임아웃 경계: 요청 10분 도달 시 재시도 없이 실패, 직전은 timeout_s 1, 폴링 중 초과도 실패", async () => {
  await rejectsWith(run([ok({ status: "running" })], { clock: new FakeClock(T0 + 600_000) }), "review_timeout", false);
  const posts: unknown[] = [];
  await run([ok({ status: "succeeded", result: okResult })], { clock: new FakeClock(T0 + 599_999), posts });
  assert.equal((posts[0] as { timeout_s: number }).timeout_s, 1);
  await rejectsWith(run([ok({ status: "running" })], { clock: new FakeClock(T0 + 598_000) }), "review_timeout", false);
});

test("재시도 가능: FastAPI 404(POST·GET)·5xx·네트워크·PROVIDER, 그 밖 4xx는 즉시 실패", async () => {
  await rejectsWith(run([{ status: 404 }]), "api_http_404", true);
  await rejectsWith(run([], { post: { status: 404 } }), "api_http_404", true);
  await rejectsWith(run([{ status: 503 }]), "api_http_503", true);
  await rejectsWith(run(["throw"]), "api_network", true);
  await rejectsWith(run([ok({ status: "failed", error: { code: "PROVIDER", retryable: true } })]), "PROVIDER", true);
  await rejectsWith(run([], { post: { status: 422 } }), "api_http_422", false);
});

test("payload·행 검사: 행 없음·다른 조직은 재시도 없이 실패", async () => {
  await rejectsWith(run([], { row: null }), "bad_payload", false);
  await rejectsWith(run([], { row: { ...row, org_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } }), "bad_payload", false);
});

test("정책: review 타임아웃은 재시도하지 않는다(전액 환불 경로)", () => {
  assert.equal(policyFor("arch.review").retryOnTimeout, false);
  assert.equal(classifyError(new JobError("x", { retryable: false, code: "review_timeout" }), false).retryable, false);
});

test("킬 스위치: 정확히 'true'+API·웹 주소·워커 키가 있을 때만 arch.review 등록", () => {
  const base = { ARCH_API_URL: "http://api", ARCH_WEB_URL: "http://web", ARCH_WORKER_INTERNAL_KEY: "k" };
  const r = () => reader();
  const keys = (env: Record<string, string>) => Object.keys(buildHandlers(env, undefined, r));
  assert.deepEqual(keys({}), []);
  assert.deepEqual(keys(base), []);
  assert.deepEqual(keys({ ...base, ARCH_AI_REVIEW_ENABLED: "1" }), []);
  assert.deepEqual(keys({ ...base, ARCH_AI_REVIEW_ENABLED: "true", ARCH_API_URL: "" }), []);
  assert.equal(loadReviewConfig({ ARCH_AI_REVIEW_ENABLED: "true" }).enabled, false);
  assert.deepEqual(keys({ ...base, ARCH_AI_REVIEW_ENABLED: "true" }), ["arch.review"]);
});
