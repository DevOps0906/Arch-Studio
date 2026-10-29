// safeNextPath 테스트 벡터. apps/web/src/lib/auth/next-path.test.ts와 packages/features/src/auth/next-path.test.ts는
// 글자 그대로 같은 파일이다(boundary.test.ts가 두 구현·두 테스트의 동일성을 검사한다).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NEXT, safeNextPath } from "./next-path.ts";

test("같은 출처 상대 경로는 그대로", () => {
  assert.equal(safeNextPath("/projects/abc/site?tab=1#x"), "/projects/abc/site?tab=1#x");
  assert.equal(safeNextPath("/onboarding"), "/onboarding");
  assert.equal(safeNextPath("/login?step=terms"), "/login?step=terms");
  assert.equal(safeNextPath("/"), "/");
  assert.equal(safeNextPath("/a.b/c..d/.e"), "/a.b/c..d/.e");
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

test("점 세그먼트로 정규화 뒤 `//`가 되는 우회는 기본 경로(보안 리뷰 재현)", () => {
  const bad = [
    // 재현 3건: new URL이 점 세그먼트를 접으면 pathname이 `//evil.com`이 된다.
    "/.//evil.com",
    "/x/..//evil.com",
    "/%2e//evil.com",
    // 대소문자·이중 인코딩·조합
    "/%2E//evil.com",
    "/%2e%2e//evil.com",
    "/x/%2E%2e//evil.com",
    "/%252e//evil.com",
    "/%25252e//evil.com",
    "/.%2e//evil.com",
    "/x/.",
    "/x/..",
    "/.",
    "/..",
    "/./x",
    "/x/../y",
    // 유니코드 점(전각 U+FF0E)·전각 슬래시·역슬래시
    "/．//evil.com",
    "/．．//evil.com",
    "/%EF%BC%8E//evil.com",
    "/／／evil.com",
    "/＼evil.com",
  ];
  for (const b of bad) assert.equal(safeNextPath(b), DEFAULT_NEXT, JSON.stringify(b));
});

test("역슬래시·탭·개행·javascript:·프로토콜 상대·인코딩된 슬래시는 기본 경로", () => {
  const bad = [
    "/\\",
    "/a\\b",
    "\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "/x\t",
    "/%09/evil.com",
    "/%0a/evil.com",
    "/%0d%0aSet-Cookie:x",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "//evil.com/path",
    "///evil.com",
    "/%2f%2fevil.com",
    "/%2F/evil.com",
    "/%252f%252fevil.com",
    "/%5c%5cevil.com",
    "/%40evil.com",
  ];
  for (const b of bad) assert.equal(safeNextPath(b), DEFAULT_NEXT, JSON.stringify(b));
  // 경로 안의 `javascript:`는 스킴이 아니라 같은 출처 경로 조각이다(그대로 두어도 외부로 가지 않는다).
  assert.equal(new URL(safeNextPath("/javascript:alert(1)//"), "https://app.example/").origin, "https://app.example");
});

/** 시드 고정 의사 난수(mulberry32). 결과가 매 실행 같다. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  "/", "/", "/", ".", "..", "%2e", "%2E", "%252e", "\\", "%5c", "%5C", "@", "%40", "evil.com", "a", "b1", "?", "#", "=", "&",
  "%2f", "%2F", "%252f", ":", "//", "://", "．", "／", "＼", " ", "\t", "\n", "%", "%25", "%20", "한", "%ED%95%9C",
  "javascript:", "x", "-", "_", "~", ";", "'", '"', "<", ">",
];

test("속성: 결과는 항상 같은 출처의 `/` 상대 경로이고 멱등(시드 고정 난수 5000건)", () => {
  const rand = prng(0x5eed008);
  const ORIGIN = "https://app.example";
  let passed = 0;
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rand() * 8);
    let s = rand() < 0.9 ? "/" : "";
    for (let j = 0; j < n; j++) s += PIECES[Math.floor(rand() * PIECES.length)];
    const out = safeNextPath(s);
    if (out !== DEFAULT_NEXT) passed++;
    const label = JSON.stringify(s);
    assert.ok(out.startsWith("/"), label);
    assert.ok(!out.startsWith("//") && !out.startsWith("/\\"), `${label} → ${out}`);
    // 브라우저가 Location 상대 경로를 해석하는 방식(현재 문서 URL 기준)으로 출처가 바뀌지 않는다.
    assert.equal(new URL(out, `${ORIGIN}/login?x=1`).origin, ORIGIN, `${label} → ${out}`);
    assert.equal(safeNextPath(out), out, `멱등 아님: ${label} → ${out} → ${safeNextPath(out)}`);
  }
  // 생성기가 거부 사례만 만들지 않는지(통과 사례도 충분히 섞였는지) 확인.
  assert.ok(passed > 500, `통과 ${passed}건`);
});

test("멱등: 고정 사례", () => {
  for (const s of ["/projects/abc?q=한 글#h", "/a%20b", "/x?y=%2e%2e", "/p?q=a//b", "/p#//frag"]) {
    const out = safeNextPath(s);
    assert.equal(safeNextPath(out), out, JSON.stringify(s));
  }
});
