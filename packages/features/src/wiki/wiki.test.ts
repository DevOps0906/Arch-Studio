// 위키 순수 로직 테스트(AR-06-055): 목록·페이지 응답 검사(출처·확인일), slug 검사, 본문 블록(HTML 해석 없음), 목업 어댑터.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient, type FetchResponseLike } from "../api-client/index.ts";
import { mockWikiSource } from "./mock.ts";
import { dateOnly, httpWikiSource, isSlug, parseList, parsePage, wikiBlocks } from "./model.ts";

test("목록: 확인일·출처 확인 필요(stale), 잘못된 slug 항목은 버림", () => {
  const l = parseList({
    items: [
      { slug: "glossary/far", title: "용적률", category: "glossary", checked_at: "2026-10-01T00:00:00Z", stale: true },
      { slug: "../etc", title: "x", category: "glossary", checked_at: "2026-10-01" },
    ],
    next: "c2",
  });
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0]!.stale, true);
  assert.equal(dateOnly(l.items[0]!.checked_at), "2026-10-01");
  assert.equal(l.next, "c2");
  assert.throws(() => parseList({}));
});

test("페이지: 출처 목록과 확인일, https 아닌 링크는 버림", () => {
  const p = parsePage({
    slug: "a",
    title: "t",
    category: "glossary",
    body_md: "# 제목\n본문",
    sources: [{ title: "건축법 제55조", checked_at: "2026-10-01", url: "javascript:alert(1)" }, { title: "no date" }],
    revisions: [{ date: "2026-10-01", sections: ["요지"] }],
    checked_at: "2026-10-02",
  });
  assert.deepEqual(p.sources, [{ title: "건축법 제55조", checked_at: "2026-10-01" }]);
  assert.equal(p.revisions[0]!.sections[0], "요지");
  assert.equal(p.stale, false);
});

test("slug·본문 블록: 경로 이동 거부, 마크다운은 글 블록으로만", () => {
  assert.equal(isSlug("ordinance/far"), true);
  assert.equal(isSlug("a/../b"), false);
  assert.equal(isSlug("<script>"), false);
  assert.deepEqual(wikiBlocks("## 머리\n첫 줄\n둘째 줄\n\n- 항목\n<b>x</b>"), [
    { kind: "heading", text: "머리" },
    { kind: "paragraph", text: "첫 줄 둘째 줄" },
    { kind: "item", text: "항목" },
    { kind: "paragraph", text: "<b>x</b>" },
  ]);
});

test("HTTP 어댑터: GET /api/ai/wiki/pages?category&q, 서버 404는 오류(빈 목록으로 숨기지 않음)", async () => {
  const urls: string[] = [];
  const res = (status: number, body: unknown): FetchResponseLike => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
  const api = createApiClient({
    baseUrl: "https://api.test",
    getAccessToken: async () => "t",
    genId: () => "00000000-0000-4000-8000-000000000001",
    sleep: async () => undefined,
    fetch: async (url) => {
      urls.push(url);
      return url.includes("/pages/") ? res(404, { ok: false, error: { code: "not_found", message: "" } }) : res(200, { ok: true, data: { items: [], next: null } });
    },
  });
  const src = httpWikiSource(api);
  const l = await src.list({ category: "glossary", q: " 용적률 ", cursor: null });
  assert.equal(l.items.length, 0);
  assert.equal(urls[0], `https://api.test/api/ai/wiki/pages?category=glossary&q=${encodeURIComponent("용적률")}`);
  await assert.rejects(src.page("glossary/far"), (e: unknown) => (e as { code?: string }).code === "not_found");
  await assert.rejects(src.page("../x"));
});

test("목업 어댑터: 분류·검색 필터, 모든 문서에 출처·확인일", async () => {
  const m = mockWikiSource();
  const all = await m.list({ category: null, q: "", cursor: null });
  assert.ok(all.items.length >= 3);
  assert.ok(all.items.some((i) => i.stale));
  const g = await m.list({ category: "glossary", q: "", cursor: null });
  assert.ok(g.items.every((i) => i.category === "glossary"));
  for (const it of all.items) {
    const p = await m.page(it.slug);
    assert.ok(p.sources.length > 0 && p.sources.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.checked_at)));
  }
});
