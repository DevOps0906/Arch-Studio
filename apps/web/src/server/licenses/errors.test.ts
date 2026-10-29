// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { ERROR_TABLE, errorResponse, mapDbError } from "./errors.ts";

test("오류 코드 매핑 표(04_API.md 2.1·7.1·7.2절)", () => {
  const expected: Record<string, number> = {
    AR001: 409,
    AR002: 404,
    AR003: 403,
    AR004: 429,
    AR006: 403,
    "42501": 403,
    P0002: 404,
    "22023": 422,
    unauthorized: 401,
    entitlement_expired: 402,
    rate_limited: 429,
    payload_too_large: 413,
    license_signing_unavailable: 503,
    internal: 500,
  };
  for (const [code, status] of Object.entries(expected)) assert.equal(ERROR_TABLE[code as keyof typeof ERROR_TABLE].status, status, code);
});

test("DB 오류: SQLSTATE만 보고, 모르는 코드는 internal", () => {
  assert.equal(mapDbError({ code: "AR001", message: "activate_license: activation limit 2 reached" }), "AR001");
  assert.equal(mapDbError({ code: "23505", message: "duplicate key ..." }), "internal");
  assert.equal(mapDbError({ code: "AR099" }), "internal");
  assert.equal(mapDbError(null), "internal");
  assert.equal(mapDbError("AR001"), "internal");
});

test("응답 봉투에 DB 원문 없음, details는 있을 때만", async () => {
  const res = errorResponse("AR006");
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as { ok: boolean; error: Record<string, unknown> };
  assert.equal(body.ok, false);
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
  const withDetails = (await errorResponse("entitlement_expired", { reason: "expired", can_download: true }).json()) as { error: { details: unknown } };
  assert.deepEqual(withDetails.error.details, { reason: "expired", can_download: true });
});
