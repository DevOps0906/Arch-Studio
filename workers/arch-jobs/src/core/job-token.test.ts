import assert from "node:assert/strict";
import { test } from "node:test";
import { JobError } from "./errors.ts";
import { createJobTokenClient } from "./job-token.ts";

test("잡 토큰: 워커 키로 내부 경로를 부르고 토큰을 돌려준다", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const client = createJobTokenClient({
    baseUrl: "https://web.example",
    workerKey: "wk-123456789",
    fetch: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ token: "tok" }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  assert.equal(await client.get("job-1", "graph:arch.review"), "tok");
  assert.equal(seen?.url, "https://web.example/api/internal/ai-token");
  assert.equal((seen?.init.headers as Record<string, string>).authorization, "Bearer wk-123456789");
  assert.deepEqual(JSON.parse(String(seen?.init.body)), { job_id: "job-1", scope: "graph:arch.review" });
});

test("잡 토큰: 429·5xx는 재시도 가능, 401은 불가, 오류에 키 없음", async () => {
  const cases: [number, boolean][] = [
    [429, true],
    [503, true],
    [401, false],
  ];
  for (const [status, retryable] of cases) {
    const client = createJobTokenClient({
      baseUrl: "https://web.example",
      workerKey: "wk-123456789",
      fetch: (async () => new Response("no", { status })) as unknown as typeof fetch,
    });
    await assert.rejects(client.get("j", "s"), (err: unknown) => {
      assert.ok(err instanceof JobError);
      assert.equal(err.retryable, retryable);
      assert.ok(!err.message.includes("wk-123456789"));
      return true;
    });
  }
});
