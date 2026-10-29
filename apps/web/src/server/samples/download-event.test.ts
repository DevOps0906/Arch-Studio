// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../../app/api/samples/download-event/route.ts";
import { handleDownloadEvent, MAX_BODY_BYTES, type SampleDownloadEvent } from "./download-event.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/samples/download-event", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

test("유효한 입력은 204, 싱크에는 sample_id·format만 전달된다", async () => {
  const seen: SampleDownloadEvent[] = [];
  const res = await handleDownloadEvent(post(JSON.stringify({ sample_id: "site-plan", format: "dxf" }), { "user-agent": "x", "x-forwarded-for": "1.2.3.4" }), {
    record: (e) => void seen.push(e),
  });
  assert.equal(res.status, 204);
  assert.deepEqual(seen, [{ sample_id: "site-plan", format: "dxf" }]);
});

test("route POST: 유효 204 / 무효 400", async () => {
  assert.equal((await POST(post(JSON.stringify({ sample_id: "area-plan", format: "dxf" })))).status, 204);
  for (const bad of [
    { sample_id: "nope", format: "dxf" },
    { sample_id: "site-plan", format: "pdf" },
    { sample_id: "site-plan" },
    { sample_id: "site-plan", format: "dxf", ip: "1.2.3.4" },
    [],
    null,
  ]) {
    const res = await POST(post(JSON.stringify(bad)));
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
});

test("JSON이 아니면 400, 본문이 크면 413", async () => {
  assert.equal((await POST(post("{not json"))).status, 400);
  assert.equal((await POST(post(""))).status, 400);
  const big = JSON.stringify({ sample_id: "site-plan", format: "dxf", pad: "x".repeat(MAX_BODY_BYTES) });
  assert.equal((await POST(post(big))).status, 413);
  assert.equal((await POST(post("{}", { "content-length": String(MAX_BODY_BYTES + 1) }))).status, 413);
});

test("싱크 실패는 500(내용 없는 오류 응답)", async () => {
  const res = await handleDownloadEvent(post(JSON.stringify({ sample_id: "site-plan", format: "dxf" })), {
    record: () => {
      throw new Error("db down");
    },
  });
  assert.equal(res.status, 500);
});
