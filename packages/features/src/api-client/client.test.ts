// 클라이언트 동작: 시계·fetch·sleep·토큰 모두 가짜로 주입해 결정적으로 돌린다.
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "node:test";
import { ApiError, createApiClient, type ApiLogEvent, type FetchLike, type FetchResponseLike } from "./index.ts";

const TOKEN = "tok-SECRET-abc123";
const BODY_SECRET = "본문-비밀-xyz";
const KEY1 = "11111111-1111-4111-8111-111111111111";
const KEY2 = "22222222-2222-4222-8222-222222222222";

type Step = { status: number; body?: unknown; headers?: Record<string, string> } | "network";

function res(s: Exclude<Step, "network">): FetchResponseLike {
  const h = s.headers ?? {};
  return {
    status: s.status,
    headers: { get: (n) => h[n.toLowerCase()] ?? null },
    text: async () => (s.body === undefined ? "" : typeof s.body === "string" ? s.body : JSON.stringify(s.body)),
  };
}

function ok(data: unknown): Step {
  return { status: 200, body: { ok: true, data } };
}
function fail(status: number, code: string, details?: unknown, headers?: Record<string, string>): Step {
  return { status, body: { ok: false, error: { code, message: "서버 원문 SQL select * from secret", details } }, ...(headers ? { headers } : {}) };
}

/** 신호(abort)가 올 때까지 끝나지 않는 sleep: 오프라인 대기 타이머가 저절로 만료되지 않게 한다. */
const pendingSleep = (_ms: number, signal?: { aborted: boolean; addEventListener: (t: "abort", l: () => void) => void }): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    signal?.addEventListener("abort", () => resolve());
  });

function harness(script: Step[] | ((n: number, url: string) => Step), over: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const events: ApiLogEvent[] = [];
  const fetch: FetchLike = async (url, init) => {
    const n = calls.length;
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const step = typeof script === "function" ? script(n, url) : (script[n] ?? script[script.length - 1]!);
    if (step === "network") throw new TypeError(`fetch failed ${TOKEN} ${BODY_SECRET}`);
    return res(step);
  };
  let ids = 0;
  const client = createApiClient({
    baseUrl: "https://api.example.test/",
    getAccessToken: async () => TOKEN,
    fetch,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    genId: () => `id-${++ids}`,
    log: (e) => events.push(e),
    ...over,
  });
  return { client, sleeps, calls, events, advance: (ms: number) => (t += ms) };
}

test("Bearer 헤더·JSON 본문·멱등 키 헤더를 붙이고 data를 돌려준다", async () => {
  const h = harness([ok({ run_id: "r1" })]);
  const out = await h.client.request<{ run_id: string }>({
    method: "POST",
    path: "/api/ai/review",
    idempotencyKey: KEY1,
    body: { request_id: KEY1 },
    parse: (d) => d as { run_id: string },
  });
  assert.equal(out.run_id, "r1");
  const c = h.calls[0]!;
  assert.equal(c.url, "https://api.example.test/api/ai/review");
  assert.equal(c.headers["Authorization"], `Bearer ${TOKEN}`);
  assert.equal(c.headers["Idempotency-Key"], KEY1);
  assert.equal(c.headers["Content-Type"], "application/json");
  assert.equal(c.body, JSON.stringify({ request_id: KEY1 }));
});

test("쿼리는 키 순서로 고정된다", async () => {
  const h = harness([ok(null)]);
  await h.client.request({ method: "GET", path: "/api/x", query: { b: 2, a: "한" } });
  assert.equal(h.calls[0]!.url, "https://api.example.test/api/x?a=%ED%95%9C&b=2");
});

test("응답 검증 훅이 던지면 invalid_response(검증기 메시지 비포함)", async () => {
  const h = harness([ok({ x: BODY_SECRET })]);
  await assert.rejects(
    h.client.request({
      method: "GET",
      path: "/x",
      parse: () => {
        throw new Error(`bad ${BODY_SECRET}`);
      },
    }),
    (e: unknown) => e instanceof ApiError && e.code === "invalid_response" && !inspect(e).includes(BODY_SECRET),
  );
});

test("토큰이 null이면 네트워크 호출 없이 인증 오류", async () => {
  const h = harness([ok(1)], { getAccessToken: async () => null });
  await assert.rejects(h.client.request({ method: "GET", path: "/x" }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, "unauthenticated");
    assert.equal(e.httpStatus, 401);
    assert.equal(e.retryable, false);
    assert.match(e.userMessage, /로그인/);
    return true;
  });
  assert.equal(h.calls.length, 0);
});

test("401 응답은 재시도 없이 인증 오류", async () => {
  const h = harness([{ status: 401, body: "" }]);
  await assert.rejects(h.client.request({ method: "GET", path: "/x" }), (e: unknown) => e instanceof ApiError && e.code === "unauthenticated");
  assert.equal(h.calls.length, 1);
});

test("4xx(AR 코드)는 재시도하지 않고 문구가 붙는다", async () => {
  const h = harness([fail(409, "AR041")]);
  await assert.rejects(
    h.client.request({ method: "POST", path: "/api/cloud-projects", idempotencyKey: KEY1, body: { a: 1 } }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "AR041");
      assert.equal(e.httpStatus, 409);
      assert.equal(e.retryable, false);
      assert.match(e.userMessage, /먼저 저장/);
      assert.ok(e.actions.includes("서버 최신 열기"));
      assert.ok(!inspect(e).includes("select * from secret"));
      return true;
    },
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test("429 AR 코드(AR004·AR034)도 재시도하지 않는다", async () => {
  for (const code of ["AR004", "AR034"]) {
    const h = harness([fail(429, code, undefined, { "retry-after": "1" })]);
    await assert.rejects(h.client.request({ method: "GET", path: "/x" }), (e: unknown) => e instanceof ApiError && e.code === code);
    assert.equal(h.calls.length, 1);
  }
});

test("429 rate_limited는 Retry-After를 존중해 기다린 뒤 재시도한다", async () => {
  const h = harness([fail(429, "rate_limited", undefined, { "retry-after": "7" }), ok("done")]);
  assert.equal(await h.client.request({ method: "GET", path: "/x" }), "done");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.sleeps, [7000]); // 지수 백오프 500보다 Retry-After가 크다
});

test("Retry-After가 없으면 지수 백오프(+주입 jitter)로 기다린다", async () => {
  const h = harness([{ status: 503, body: "" }, { status: 502, body: "" }, { status: 500, body: "" }, ok(1)], { jitter: (d) => d / 10 });
  await h.client.request({ method: "GET", path: "/x" });
  assert.deepEqual(h.sleeps, [550, 1100, 2200]);
});

test("Retry-After가 HTTP 날짜여도 읽는다", async () => {
  const when = new Date(1_000_000 + 5000).toUTCString(); // 초 단위로 내림되어 4~5초
  const h = harness([fail(429, "rate_limited", undefined, { "retry-after": when }), ok(1)]);
  await h.client.request({ method: "GET", path: "/x" });
  assert.ok(h.sleeps[0]! >= 4000 && h.sleeps[0]! <= 5000);
});

test("5xx가 계속되면 최대 시도 뒤 retryable 오류로 끝난다", async () => {
  const h = harness([{ status: 503, body: "" }], { maxAttempts: 3 });
  await assert.rejects(h.client.request({ method: "GET", path: "/x" }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, "server_error");
    assert.equal(e.retryable, true);
    return true;
  });
  assert.equal(h.calls.length, 3);
});

test("네트워크 오류는 재시도하고 오류 객체·로그에 원문(토큰·본문)이 없다", async () => {
  const h = harness(["network", ok("back")]);
  assert.equal(await h.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1, body: { memo: BODY_SECRET } }), "back");
  assert.equal(h.calls.length, 2);

  const h2 = harness(["network"], { maxAttempts: 2 });
  await assert.rejects(
    h2.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1, body: { memo: BODY_SECRET } }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "network_offline");
      for (const dump of [inspect(e, { depth: 6 }), JSON.stringify(e), e.message, e.stack ?? ""]) {
        assert.ok(!dump.includes(TOKEN), "토큰 노출");
        assert.ok(!dump.includes(BODY_SECRET), "본문 노출");
      }
      return true;
    },
  );
  const logs = JSON.stringify([...h.events, ...h2.events]);
  assert.ok(!logs.includes(TOKEN));
  assert.ok(!logs.includes(BODY_SECRET));
  assert.ok(!logs.includes("Bearer"));
});

test("오프라인 요청은 복귀 후 FIFO 순서로 처리된다", async () => {
  let online = false;
  const h = harness((n) => ok(n), { isOnline: () => online, sleep: pendingSleep });
  const order: string[] = [];
  const mk = (name: string, key: string) =>
    h.client.request({ method: "POST", path: `/api/${name}`, idempotencyKey: key, body: { n: name } }).then(() => order.push(name));
  const p = [mk("a", "k1"), mk("b", "k2"), mk("c", "k3")];
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.length, 0);
  assert.equal(h.client.pending, 3);
  online = true;
  h.client.notifyOnline();
  await Promise.all(p);
  assert.deepEqual(order, ["a", "b", "c"]);
  assert.deepEqual(
    h.calls.map((c) => c.url.split("/").pop()),
    ["a", "b", "c"],
  );
});

test("대기 시간 상한을 넘기면 queue_expired", async () => {
  // sleep이 시계를 앞당기므로 오프라인 대기 타이머가 곧 만료된다
  const h = harness([ok(1)], { isOnline: () => false, maxWaitMs: 5000 });
  await assert.rejects(h.client.request({ method: "GET", path: "/x" }), (e: unknown) => e instanceof ApiError && e.code === "queue_expired" && e.retryable);
  assert.equal(h.calls.length, 0);
});

test("최대 대기 건수를 넘기면 queue_full", async () => {
  const h = harness([ok(1)], { isOnline: () => false, maxQueue: 2, maxWaitMs: 1_000_000_000, sleep: pendingSleep });
  const a = h.client.request({ method: "GET", path: "/a" }).catch(() => {});
  const b = h.client.request({ method: "GET", path: "/b" }).catch(() => {});
  await assert.rejects(h.client.request({ method: "GET", path: "/c" }), (e: unknown) => e instanceof ApiError && e.code === "queue_full");
  h.client.notifyOnline(); // 정리
  void a;
  void b;
});

test("같은 멱등 키는 한 번만 보내고 결과를 공유한다", async () => {
  let online = false;
  const h = harness([ok({ job: 1 })], { isOnline: () => online, sleep: pendingSleep });
  const r1 = h.client.request({ method: "POST", path: "/api/ai/render", idempotencyKey: KEY1, body: { request_id: KEY1 } });
  const r2 = h.client.request({ method: "POST", path: "/api/ai/render", idempotencyKey: KEY1, body: { request_id: KEY1 } });
  const r3 = h.client.request({ method: "POST", path: "/api/ai/render", idempotencyKey: KEY2, body: { request_id: KEY2 } });
  assert.equal(h.client.pending, 2);
  online = true;
  h.client.notifyOnline();
  const [a, b] = await Promise.all([r1, r2, r3]);
  assert.deepEqual(a, b);
  assert.equal(h.calls.length, 2);
  assert.ok(h.events.some((e) => e.type === "dedupe"));
});

test("끝난 멱등 키는 다시 보낼 수 있다", async () => {
  const h = harness([ok(1)]);
  await h.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1, body: {} });
  await h.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1, body: {} });
  assert.equal(h.calls.length, 2);
});

test("AbortSignal: 대기 중 취소는 보내지 않고 aborted", async () => {
  const h = harness([ok(1)], { isOnline: () => false, maxWaitMs: 1_000_000_000, sleep: pendingSleep });
  const ac = new AbortController();
  const p = h.client.request({ method: "GET", path: "/x", signal: ac.signal });
  ac.abort();
  await assert.rejects(p, (e: unknown) => e instanceof ApiError && e.code === "aborted");
  await new Promise((r) => setImmediate(r));
  assert.equal(h.client.pending, 0);
  assert.equal(h.calls.length, 0);
});

test("이미 취소된 signal은 바로 aborted", async () => {
  const h = harness([ok(1)]);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(h.client.request({ method: "GET", path: "/x", signal: ac.signal }), (e: unknown) => e instanceof ApiError && e.code === "aborted");
  assert.equal(h.calls.length, 0);
});

test("402 entitled=false는 사유별 문구, CR001은 잔액 details만 통과", async () => {
  const h = harness([fail(402, "AR044", { reason: "seat_revoked", can_download: true, secret: BODY_SECRET })]);
  await assert.rejects(h.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1 }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.match(e.userMessage, /좌석 배정이 해제/);
    assert.deepEqual(e.details, { reason: "seat_revoked", can_download: true });
    return true;
  });
  const h2 = harness([fail(402, "CR001", { required: 15, balance: 3 })]);
  await assert.rejects(h2.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1 }), (e: unknown) => e instanceof ApiError && e.details?.required === 15);
});

test("런타임 방어: 타입을 우회한 금지 필드는 보내지 않는다(키 이름만 보고 값은 로그에 없음)", async () => {
  const h = harness([ok(1)]);
  const bad = { nested: { Org_Id: BODY_SECRET } } as never;
  await assert.rejects(
    h.client.request({ method: "POST", path: "/x", idempotencyKey: KEY1, body: bad }),
    (e: unknown) => e instanceof ApiError && e.code === "forbidden_field" && !inspect(e).includes(BODY_SECRET),
  );
  assert.equal(h.calls.length, 0);
});

test("멱등 키 없는 변경 요청(타입 우회)은 보내지 않는다", async () => {
  const h = harness([ok(1)]);
  await assert.rejects(h.client.request({ method: "POST", path: "/x" } as never), (e: unknown) => e instanceof ApiError);
  assert.equal(h.calls.length, 0);
});

test("성공·실패 로그 이벤트에는 경로(쿼리 제외)와 코드만 있다", async () => {
  const h = harness([fail(404, "P0002")]);
  await assert.rejects(h.client.request({ method: "GET", path: "/api/cloud-projects/abc?token=x" }));
  const f = h.events.find((e) => e.type === "failure")!;
  assert.equal(f.path, "/api/cloud-projects/abc");
  assert.equal(f.code, "P0002");
  assert.deepEqual(Object.keys(f).sort(), ["code", "id", "method", "path", "status", "type"]);
});
