// 게이트 로그 허용 목록: 이름·값 형식이 맞지 않으면 버린다(토큰·경로·URL·키가 실수로 들어와도 통과 불가, P12).
import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeGatewayLog } from "./log.ts";

const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJqb2I6eCJ9.c2ln";
const PATH = `${JOB}/arch/render_input/${JOB}.png`;

test("uuid 필드는 UUID만, 단어 필드는 [a-z0-9_]만, 모르는 필드는 버린다", () => {
  const out = sanitizeGatewayLog({
    route: "ai_token",
    job_id: PATH,
    run_id: TOKEN,
    code: "has space",
    purpose: "../x",
    kind: "review",
    reason: `Bearer ${TOKEN}`,
    ...({ token: TOKEN, path: PATH, signed_url: "https://x" } as object),
  });
  assert.deepEqual(out, { route: "ai_token", kind: "review" });
  assert.deepEqual(sanitizeGatewayLog({ route: "ai_token", job_id: JOB, status: 200 }), { route: "ai_token", job_id: JOB, status: 200 });
  assert.deepEqual(sanitizeGatewayLog({ route: "evil" as "ai_token" }), { route: "unknown" });
});
