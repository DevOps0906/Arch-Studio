import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NEXT, safeNextPath } from "./next-path.ts";

test("같은 출처 상대 경로는 그대로", () => {
  assert.equal(safeNextPath("/projects/abc/site?tab=1#x"), "/projects/abc/site?tab=1#x");
  assert.equal(safeNextPath("/onboarding"), "/onboarding");
});

test("open redirect 시도는 기본 경로(B-2)", () => {
  const bad = [
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/%2F%2Fevil.com",
    "/%2f%2fevil.com",
    "/%5Cevil.com",
    "/@evil.com",
    "/x@evil.com",
    "/ok\nSet-Cookie:x",
    "/ok\u0000",
    "javascript:alert(1)",
    "evil.com",
    "",
    "/" + "a".repeat(600),
    "/%E0%A4%A",
  ];
  for (const b of bad) assert.equal(safeNextPath(b), DEFAULT_NEXT, JSON.stringify(b));
  assert.equal(safeNextPath(42), DEFAULT_NEXT);
  assert.equal(safeNextPath(null, "/login"), "/login");
});
