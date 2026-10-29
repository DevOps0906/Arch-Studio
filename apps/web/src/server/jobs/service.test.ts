// GET /api/jobs/{id}: 조직 격리(IDOR)·응답 필드 허용 목록·오류 원문 비노출·결과 서명 경로 검사(tasks/logs/AR-06-047.md P11·P12).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { handleGetJob, type JobsDeps, type JobView, type RunTable, type RunView } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_JOB = "abababab-abab-4bab-8bab-abababababab";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OBJ = "99999999-9999-4999-8999-999999999999";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);

interface World {
  jobs: JobView[];
  runs: Partial<Record<RunTable, RunView>>;
  signed: { bucket: string; path: string; ttl: number }[];
  /** true면 저장소가 조직 조건을 빠뜨린 것처럼 동작(방어 2겹 확인) */
  leakyRepo?: boolean;
  session?: GatewaySession | GatewayError;
}

function job(over: Partial<JobView> = {}): JobView {
  return { id: JOB, org_id: ORG, app_id: "arch", job_type: "arch.review", status: "running", progress: 40, progress_message: '{"stage":"retrieve"}', ...over };
}

function world(over: Partial<World> = {}): World {
  return { jobs: [job()], runs: { reviews: { id: RUN, status: "running", error: null } }, signed: [], ...over };
}

function deps(w: World, rate = new MemoryRateLimitStore()): JobsDeps {
  return {
    session: {
      async resolve() {
        const s = w.session ?? { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: "x".repeat(30) };
        if (s instanceof GatewayError) throw s;
        return s;
      },
    },
    repo: () => ({
      async getJob(orgId, id) {
        return w.jobs.find((j) => j.id === id && (w.leakyRepo || j.org_id === orgId)) ?? null;
      },
      async getRunByJob(table) {
        return w.runs[table] ?? null;
      },
    }),
    downloads: () => ({
      async createSignedUrl(bucket, path, ttl) {
        w.signed.push({ bucket, path, ttl });
        return `https://proj.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=signed-download-token`;
      },
    }),
    rateLimit: rate,
    now: () => NOW,
  };
}

async function get(w: World, id = JOB, rate?: MemoryRateLimitStore) {
  const res = await handleGetJob(new Request(`https://web.example/api/jobs/${id}`), id, deps(w, rate));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

function spy(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

test("같은 조직 잡: 허용 필드만(id·job_type·status·progress·stage·refunded)", async (t) => {
  spy(t);
  const r = await get(world());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, { id: JOB, job_type: "arch.review", status: "running", progress: 40, stage: "retrieve", refunded: false });
});

test("IDOR: 다른 조직 잡·다른 제품 잡·없는 잡·형식 틀린 id는 같은 404 본문", async (t) => {
  spy(t);
  const missing = await get(world(), OTHER_JOB);
  assert.equal(missing.status, 404);
  const otherOrg = await get(world({ jobs: [job({ org_id: OTHER_ORG })] }));
  const leaky = await get(world({ jobs: [job({ org_id: OTHER_ORG })], leakyRepo: true }));
  const otherApp = await get(world({ jobs: [job({ app_id: "toon" })] }));
  const badId = await get(world(), "../../etc");
  for (const r of [otherOrg, leaky, otherApp, badId]) assert.deepEqual(r, missing);
});

test("실패: 실행 행 error 원문·last_error는 숨기고 공개 코드만, refunded 표시", async (t) => {
  spy(t);
  const w = world({
    jobs: [job({ status: "failed", progress_message: null })],
    runs: { reviews: { id: RUN, status: "refunded", error: "AR033 no source; provider=anthropic key sk-live-123 at /srv/app.py:42" } },
  });
  const r = await get(w);
  assert.deepEqual(r.json.data.error, { code: "AR033", message: "출처를 확인할 수 없는 검토 결과라 차단했습니다. 크레딧은 환불됩니다." });
  assert.equal(r.json.data.refunded, true);
  assert.ok(!JSON.stringify(r.json).includes("sk-live") && !JSON.stringify(r.json).includes("anthropic"));
  const unknown = await get(world({ jobs: [job({ status: "failed" })], runs: { reviews: { id: RUN, status: "failed", error: "Traceback: psycopg error" } } }));
  assert.equal(unknown.json.data.error.code, "JOB_FAILED");
  const canceled = await get(world({ jobs: [job({ status: "canceled" })] }));
  assert.equal(canceled.json.data.error.code, "JOB_CANCELED");
});

test("stage: 허용 목록 밖·JSON 아님·다른 job_type의 stage는 생략", async (t) => {
  spy(t);
  for (const pm of ['{"stage":"<script>"}', "retrieve", '{"stage":"generate"}', null]) {
    const r = await get(world({ jobs: [job({ progress_message: pm })] }));
    assert.equal("stage" in r.json.data, false, String(pm));
  }
  assert.equal((await get(world({ jobs: [job({ progress: 999 })] }))).json.data.progress, 0);
});

test("렌더 성공: 자기 조직 render 경로만 짧은 서명 URL, 경로 원문은 응답에 없음", async (t) => {
  spy(t);
  const path = `${ORG}/arch/render/${OBJ}.png`;
  const w = world({
    jobs: [job({ job_type: "arch.render", status: "succeeded", progress: 100, progress_message: '{"stage":"persist"}' })],
    runs: { renders: { id: RUN, status: "succeeded", error: null, output_path: path, width: 1024, height: 768, expires_at: "2027-01-27T00:00:00Z", purged_at: null } },
  });
  const r = await get(w);
  assert.equal(r.status, 200);
  assert.deepEqual(w.signed, [{ bucket: "org-files", path, ttl: 300 }]);
  assert.equal(r.json.data.result.width, 1024);
  assert.equal("output_path" in r.json.data.result, false);
  // 다른 조직 경로·상위 경로·만료(purged)는 서명하지 않는다
  for (const bad of [`${OTHER_ORG}/arch/render/${OBJ}.png`, `${ORG}/arch/render/../x.png`, `${ORG}/arch/render_input/${OBJ}.png`]) {
    const w2 = world({ jobs: [job({ job_type: "arch.render", status: "succeeded" })], runs: { renders: { id: RUN, status: "succeeded", error: null, output_path: bad } } });
    const r2 = await get(w2);
    assert.deepEqual(r2.json.data.result, { expired: true }, bad);
    assert.equal(w2.signed.length, 0);
  }
});

test("제안서 성공: exports의 자기 조직 pdf만 서명", async (t) => {
  spy(t);
  const w = world({
    jobs: [job({ job_type: "arch.proposal_pdf", status: "succeeded" })],
    runs: { proposals: { id: RUN, status: "succeeded", error: null, pdf_path: `${ORG}/arch/pdf/${OBJ}.pdf` } },
  });
  assert.ok((await get(w)).json.data.result.pdf_url);
  assert.equal(w.signed[0]?.bucket, "exports");
  const w2 = world({ jobs: [job({ job_type: "arch.proposal_pdf", status: "succeeded" })], runs: { proposals: { id: RUN, status: "succeeded", error: null, pdf_path: `${OTHER_ORG}/arch/pdf/${OBJ}.pdf` } } });
  assert.equal("result" in (await get(w2)).json.data, false);
  assert.equal(w2.signed.length, 0);
});

test("검토 성공: 결과는 실행 행 result, 실행 중에는 result 없음", async (t) => {
  spy(t);
  const result = { items: [], sentences: [], needs_check: [], sources: [] };
  const done = await get(world({ jobs: [job({ status: "succeeded" })], runs: { reviews: { id: RUN, status: "succeeded", error: null, result } } }));
  assert.deepEqual(done.json.data.result, result);
  const running = await get(world({ runs: { reviews: { id: RUN, status: "running", error: null, result } } }));
  assert.equal("result" in running.json.data, false);
});

test("미인증 401, 레이트 리밋 120회/분 429", async (t) => {
  spy(t);
  assert.equal((await get(world({ session: new GatewayError("unauthorized") }))).status, 401);
  const rate = new MemoryRateLimitStore();
  for (let i = 0; i < 120; i++) assert.equal((await get(world(), JOB, rate)).status, 200);
  assert.equal((await get(world(), JOB, rate)).status, 429);
});

test("로그에 서명 URL·경로·오류 원문 없음", async (t) => {
  const lines = spy(t);
  await get(world({ jobs: [job({ job_type: "arch.render", status: "succeeded" })], runs: { renders: { id: RUN, status: "succeeded", error: "secret-detail", output_path: `${ORG}/arch/render/${OBJ}.png` } } }));
  await get(world({ session: new GatewayError("unauthorized") }));
  const all = lines.join("\n");
  for (const s of ["signed-download-token", OBJ, "secret-detail", "supabase.co"]) assert.ok(!all.includes(s), s);
});
