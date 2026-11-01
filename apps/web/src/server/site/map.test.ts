// 새 프로젝트 지도 서버: POST /api/site/search · GET /api/site/tiles/{layer}/{z}/{x}/{y}.
// 스위치 off 503 · 키 없음 AR021 · 입력·범위 거부 · 인증 401 · 리밋 · 상위 비이미지·크기 초과 거부 · 키·주소·URL 비노출. 외부 호출 없음(가짜 fetch).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { isSiteMapEnabled } from "./map-config.ts";
import { createVworldSearch, handleSiteSearch, SITE_SEARCH_BURST, type SiteSearchDeps } from "./search.ts";
import { buildTileUrl, createVworldTiles, handleSiteTile, koreaTileRange, SITE_TILE_BURST, TILE_CACHE_CONTROL, TileSessionCache, type SiteTileDeps, type TileParams } from "./tiles.ts";
import type { FetchImpl } from "./vworld.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = Date.UTC(2026, 10, 2, 3, 0, 0);
const API_KEY = "VWORLD-SECRET-KEY-abcdef-123456";
const TOKEN = "user-access-token-value-0123456789";
const ADDRESS = "경기도 성남시 분당구 운중동";
const PNU = "4113510900100120004";
const SESSION: GatewaySession = { userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", orgId: ORG, role: "member", entitled: true, accessToken: TOKEN };

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => lines.push(a.map(String).join(" ")));
  return lines;
}

function sessionResolver(s: GatewaySession | GatewayError = SESSION, calls = { n: 0 }) {
  return {
    async resolve() {
      calls.n++;
      if (s instanceof GatewayError) throw s;
      return s;
    },
  };
}

// ── 검색 ──

function searchOk(): unknown {
  const items = Array.from({ length: 14 }, (_, i) => ({
    id: i === 0 ? PNU : `bad-${i}`,
    address: { parcel: `${ADDRESS} ${i + 1}`, road: `경기도 성남시 분당구 운중로 ${i + 1}`, zipcode: "13461" },
    point: { x: "127.1", y: "37.4" },
  }));
  return { response: { status: "OK", result: { crs: "EPSG:5186", type: "address", items } } };
}

function searchDeps(over: Partial<SiteSearchDeps> & { fetch?: FetchImpl; calls?: string[] } = {}): SiteSearchDeps {
  const calls = over.calls ?? [];
  const fetch: FetchImpl =
    over.fetch ??
    (async (url) => {
      calls.push(url);
      return new Response(JSON.stringify(searchOk()), { status: 200 });
    });
  return {
    enabled: () => true,
    session: sessionResolver(),
    provider: createVworldSearch({ apiKey: API_KEY, fetch }),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
    ...over,
  };
}

function searchReq(body: unknown, method = "POST", headers: Record<string, string> = {}): Request {
  return new Request("https://arch.example/api/site/search", {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

const jibunBody = { query: { kind: "jibun", value: ADDRESS } };

async function json(res: Response): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } }> {
  return (await res.json()) as never;
}

test("스위치: 정확히 'true'일 때만 켜짐", () => {
  assert.equal(isSiteMapEnabled({ ARCH_SITE_MAP_ENABLED: "true" }), true);
  for (const v of [undefined, "", "1", "TRUE", "yes"]) assert.equal(isSiteMapEnabled({ ARCH_SITE_MAP_ENABLED: v }), false);
});

test("검색: 스위치 off면 503, 세션·제공자 미호출", async () => {
  const calls: string[] = [];
  const s = { n: 0 };
  const res = await handleSiteSearch(searchReq(jibunBody), searchDeps({ enabled: () => false, session: sessionResolver(SESSION, s), calls }));
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error?.code, "site_map_disabled");
  assert.equal(s.n, 0);
  assert.equal(calls.length, 0);
});

test("검색: 키 없음이면 AR021 not_configured", async () => {
  const res = await handleSiteSearch(searchReq(jibunBody), searchDeps({ provider: null }));
  assert.equal(res.status, 502);
  const body = await json(res);
  assert.equal(body.error?.code, "AR021");
  assert.equal(body.error?.details?.["reason"], "not_configured");
});

test("검색: GET은 405(URL에 주소를 싣지 않는다), 세션·제공자 미호출", async () => {
  const calls: string[] = [];
  const s = { n: 0 };
  const res = await handleSiteSearch(new Request(`https://arch.example/api/site/search?q=${encodeURIComponent(ADDRESS)}`, { method: "GET" }), searchDeps({ session: sessionResolver(SESSION, s), calls }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
  assert.equal(s.n, 0);
  assert.equal(calls.length, 0);
});

test("검색: 2자 미만·금지 문자·추가 필드는 422, 제공자 미호출", async () => {
  const calls: string[] = [];
  const deps = searchDeps({ calls });
  for (const body of [
    { query: { kind: "jibun", value: "운" } },
    { query: { kind: "road", value: " a " } },
    { query: { kind: "road", value: "운중로&key=x" } },
    { query: { kind: "address", value: ADDRESS } },
    { query: { kind: "jibun", value: ADDRESS }, org_id: ORG },
  ]) {
    const res = await handleSiteSearch(searchReq(body), deps);
    assert.equal(res.status, 422, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("검색: 인증 없음 401, 권한 403, 엔타이틀먼트 402", async () => {
  assert.equal((await handleSiteSearch(searchReq(jibunBody), searchDeps({ session: sessionResolver(new GatewayError("unauthorized")) }))).status, 401);
  assert.equal((await handleSiteSearch(searchReq(jibunBody), searchDeps({ session: sessionResolver({ ...SESSION, role: "viewer" }) }))).status, 403);
  assert.equal((await handleSiteSearch(searchReq(jibunBody), searchDeps({ session: sessionResolver({ ...SESSION, entitled: false }) }))).status, 402);
});

test("검색: 후보 최대 10·좌표 없음·pnu는 지번 정규 PNU만, URL은 고정 출처·값 칸", async () => {
  const calls: string[] = [];
  const res = await handleSiteSearch(searchReq(jibunBody), searchDeps({ calls }));
  assert.equal(res.status, 200);
  const data = (await json(res)).data as { candidates: Record<string, unknown>[] };
  assert.equal(data.candidates.length, 10);
  assert.deepEqual(data.candidates[0], { label: `${ADDRESS} 1`, kind: "jibun", pnu: PNU });
  assert.deepEqual(data.candidates[1], { label: `${ADDRESS} 2`, kind: "jibun" });
  assert.ok(!JSON.stringify(data).includes("127.1"));
  const url = new URL(calls[0] as string);
  assert.equal(url.origin, "https://api.vworld.kr");
  assert.equal(url.pathname, "/req/search");
  assert.equal(url.searchParams.get("query"), ADDRESS);
  assert.equal(url.searchParams.get("category"), "parcel");

  const road = await handleSiteSearch(searchReq({ query: { kind: "road", value: "운중로" } }), searchDeps({ calls }));
  const rd = (await json(road)).data as { candidates: Record<string, unknown>[] };
  assert.deepEqual(rd.candidates[0], { label: "경기도 성남시 분당구 운중로 1", kind: "road" });
  assert.equal(new URL(calls[1] as string).searchParams.get("category"), "road");
});

test("검색: NOT_FOUND는 빈 후보, 비정상 응답은 AR021", async () => {
  const nf = searchDeps({ fetch: async () => new Response(JSON.stringify({ response: { status: "NOT_FOUND" } }), { status: 200 }) });
  assert.deepEqual((await json(await handleSiteSearch(searchReq(jibunBody), nf))).data, { candidates: [] });
  const bad = searchDeps({ fetch: async () => new Response("<html>", { status: 200 }) });
  assert.equal((await json(await handleSiteSearch(searchReq(jibunBody), bad))).error?.details?.["reason"], "invalid_response");
  const big = searchDeps({ fetch: async () => new Response("x".repeat(300 * 1024), { status: 200 }) });
  assert.equal((await json(await handleSiteSearch(searchReq(jibunBody), big))).error?.details?.["reason"], "too_large");
});

test("검색: 조직 30/분 초과 429, 조회 리밋과 별도 키", async () => {
  const rate = new MemoryRateLimitStore();
  for (let i = 0; i < 50; i++) rate.hit(`arch:site_lookup:org:${ORG}`, 20, 60, NOW); // 조회 버킷 소진
  const deps = searchDeps({ rateLimit: rate });
  for (let i = 0; i < SITE_SEARCH_BURST.limit; i++) assert.equal((await handleSiteSearch(searchReq(jibunBody), deps)).status, 200, `#${i}`);
  const res = await handleSiteSearch(searchReq(jibunBody), deps);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
});

test("검색: 실패 예외에 URL·키·주소가 섞여도 응답·로그에 0회", async (t) => {
  const logs = captureLogs(t);
  const deps = searchDeps({
    fetch: async (url) => {
      throw new Error(`connect failed ${url}`);
    },
  });
  const res = await handleSiteSearch(searchReq(jibunBody), deps);
  const text = await res.text();
  await handleSiteSearch(searchReq(jibunBody), searchDeps());
  await handleSiteSearch(searchReq({ query: { kind: "jibun", value: "운" } }), searchDeps());
  const all = [text, ...logs].join("\n");
  assert.equal(res.status, 502);
  assert.ok(logs.length >= 3);
  for (const secret of [API_KEY, "운중동", "api.vworld.kr", encodeURIComponent("운중동")]) assert.ok(!all.includes(secret), secret);
  assert.match(logs.join("\n"), /"route":"site_search"/);
});

// ── 타일 ──

const R12 = koreaTileRange(12);
const VALID: TileParams = { layer: "base", z: "12", x: String(R12.minX + 10), y: String(R12.minY + 10) };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function tileDeps(over: Partial<SiteTileDeps> & { fetch?: FetchImpl; calls?: string[]; sessionCalls?: { n: number }; clock?: { now: number } } = {}): SiteTileDeps {
  const calls = over.calls ?? [];
  const clock = over.clock ?? { now: NOW };
  const fetch: FetchImpl =
    over.fetch ??
    (async (url) => {
      calls.push(url);
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png", "set-cookie": "sid=abc", server: "upstream" } });
    });
  return {
    enabled: () => true,
    session: sessionResolver(SESSION, over.sessionCalls),
    sessionCache: new TileSessionCache(),
    provider: createVworldTiles({ apiKey: API_KEY, fetch }),
    rateLimit: new MemoryRateLimitStore(),
    now: () => clock.now,
    ...over,
  };
}

function tileReq(auth: string | null = `Bearer ${TOKEN}`): Request {
  return new Request("https://arch.example/api/site/tiles/x", { headers: auth ? { authorization: auth } : {} });
}

test("타일: z별 대한민국 범위", () => {
  assert.deepEqual(koreaTileRange(6), { minX: 54, maxX: 55, minY: 24, maxY: 25 });
  const r19 = koreaTileRange(19);
  assert.ok(r19.minX < r19.maxX && r19.minY < r19.maxY);
});

test("타일: 스위치 off 503, 키 없음 AR021", async () => {
  assert.equal((await handleSiteTile(tileReq(), VALID, tileDeps({ enabled: () => false }))).status, 503);
  const res = await handleSiteTile(tileReq(), VALID, tileDeps({ provider: null }));
  assert.equal(res.status, 502);
  assert.equal((await json(res)).error?.details?.["reason"], "not_configured");
});

test("타일: 허용 밖 레이어·범위 밖 z·x·y·형식 이상은 404, 세션·상위 미호출", async () => {
  const calls: string[] = [];
  const s = { n: 0 };
  const deps = tileDeps({ calls, sessionCalls: s });
  const cases: TileParams[] = [
    { ...VALID, layer: "cadastral" },
    { ...VALID, layer: "Base" },
    { ...VALID, layer: "satellite" },
    { ...VALID, layer: "__proto__" },
    { ...VALID, z: "5" },
    { ...VALID, z: "20" },
    { ...VALID, z: "012" },
    { ...VALID, x: String(R12.minX - 1) },
    { ...VALID, x: String(R12.maxX + 1) },
    { ...VALID, y: String(R12.minY - 1) },
    { ...VALID, y: String(R12.maxY + 1) },
    { ...VALID, y: "1587.png" },
    { ...VALID, x: "-1" },
    { ...VALID, x: "1e3" },
  ];
  for (const p of cases) assert.equal((await handleSiteTile(tileReq(), p, deps)).status, 404, JSON.stringify(p));
  assert.equal(s.n, 0);
  assert.equal(calls.length, 0);
});

test("타일: 인증 없음 401(세션 미호출), 무효 토큰 401", async () => {
  const s = { n: 0 };
  assert.equal((await handleSiteTile(tileReq(null), VALID, tileDeps({ sessionCalls: s }))).status, 401);
  assert.equal(s.n, 0);
  assert.equal((await handleSiteTile(tileReq(), VALID, tileDeps({ session: sessionResolver(new GatewayError("unauthorized")) }))).status, 401);
});

test("타일: viewer 403, 권리 없음 402, 상위 미호출", async () => {
  const calls: string[] = [];
  assert.equal((await handleSiteTile(tileReq(), VALID, tileDeps({ calls, session: sessionResolver({ ...SESSION, role: "viewer" }) }))).status, 403);
  assert.equal((await handleSiteTile(tileReq(), VALID, tileDeps({ calls, session: sessionResolver({ ...SESSION, entitled: false }) }))).status, 402);
  assert.equal(calls.length, 0);
});

test("타일: 성공은 새 헤더만(Set-Cookie 제거)·private 캐시, 상위 URL은 고정 경로", async () => {
  const calls: string[] = [];
  const res = await handleSiteTile(tileReq(), VALID, tileDeps({ calls }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), TILE_CACHE_CONTROL);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("server"), null);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
  assert.equal(calls[0], `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Base/12/${VALID.y}/${VALID.x}.png`);
  assert.equal(buildTileUrl({ layer: "gray", z: 6, x: 54, y: 24 }, "a/../b?c#d"), "https://api.vworld.kr/req/wmts/1.0.0/a%2F..%2Fb%3Fc%23d/gray/6/24/54.png");
});

test("타일: 상위 비이미지·형식 불일치·크기 초과·HTTP 오류는 AR021", async () => {
  const cases: [Response, string][] = [
    [new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), "invalid_response"],
    [new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }), "invalid_response"],
    [new Response("<html>error</html>", { status: 200, headers: { "content-type": "image/png" } }), "invalid_response"],
    [new Response(new Uint8Array(600 * 1024), { status: 200, headers: { "content-type": "image/jpeg" } }), "too_large"],
    [new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(600 * 1024) } }), "too_large"],
    [new Response("no", { status: 404, headers: { "content-type": "image/png" } }), "http_status"],
  ];
  for (const [upstream, reason] of cases) {
    const res = await handleSiteTile(tileReq(), VALID, tileDeps({ fetch: async () => upstream }));
    assert.equal(res.status, 502);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal((await json(res)).error?.details?.["reason"], reason);
  }
});

test("타일: 세션 결과 60초 캐시(토큰 sha256 키)", async () => {
  const s = { n: 0 };
  const clock = { now: NOW };
  const deps = tileDeps({ sessionCalls: s, clock });
  await handleSiteTile(tileReq(), VALID, deps);
  await handleSiteTile(tileReq(), VALID, deps);
  assert.equal(s.n, 1);
  await handleSiteTile(tileReq("Bearer other-access-token-value-0123456789"), VALID, deps);
  assert.equal(s.n, 2);
  clock.now += 60_001;
  await handleSiteTile(tileReq(), VALID, deps);
  assert.equal(s.n, 3);
});

test("타일: 조직 1200/분 초과 429", async () => {
  const deps = tileDeps();
  for (let i = 0; i < SITE_TILE_BURST.limit; i++) deps.rateLimit.hit(`arch:site_tiles:org:${ORG}`, SITE_TILE_BURST.limit, 60, NOW);
  const res = await handleSiteTile(tileReq(), VALID, deps);
  assert.equal(res.status, 429);
});

test("타일: 상위 예외 메시지(키 포함 URL)·x·y는 응답·로그에 0회", async (t) => {
  const logs = captureLogs(t);
  const res = await handleSiteTile(
    tileReq(),
    VALID,
    tileDeps({
      fetch: async (url) => {
        throw new Error(`fetch failed ${url}`);
      },
    }),
  );
  const all = [await res.text(), ...logs].join("\n");
  assert.equal(res.status, 502);
  for (const s of [API_KEY, "/req/wmts", `${VALID.y}/${VALID.x}`, `"x"`, `"y"`]) assert.ok(!all.includes(s), s);
  assert.match(logs.join("\n"), /"route":"site_tiles".*"reason":"network"/);
});
