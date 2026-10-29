// VWorld 어댑터: 호스트 고정(SSRF)·주입 인코딩·redirect 금지·응답 크기·시간 상한·이상 좌표 거부·응답 정규화(로그 A1·A2·A5·A9).
// 실제 호출 없이 fetch 주입 목 + 문서 기준 픽스처로 검증한다(D-14 원문 확인 전).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SiteError } from "./http.ts";
import {
  buildVworldUrl,
  cleanRing,
  createVworldProvider,
  parseParcel,
  RING_MAX_VERTICES,
  VWORLD_ORIGIN,
  VWORLD_PATHS,
  type FetchImpl,
} from "./vworld.ts";
import { FIXTURE_PNU, FIXTURE_RING, NOT_FOUND, PROVIDER_ERROR, geocodeOk, parcelOk, zoningOk } from "./vworld-fixtures.ts";

const API_KEY = "VWORLD-TEST-KEY-0000-1111";

type Route = (url: URL) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 기본: 지오코더·필지·용도지역을 픽스처로. calls에 URL·init을 기록. */
function mockFetch(over: Partial<Record<"geocode" | "parcel" | "zoning", Route>> = {}) {
  const calls: { url: URL; init: Parameters<FetchImpl>[1] }[] = [];
  const fetch: FetchImpl = async (raw, init) => {
    const url = new URL(raw);
    calls.push({ url, init });
    if (url.pathname === VWORLD_PATHS.geocode) return (over.geocode ?? (() => json(geocodeOk())))(url);
    const data = url.searchParams.get("data");
    if (data === "LP_PA_CBND_BUBUN") return (over.parcel ?? (() => json(parcelOk())))(url);
    if (data === "LT_C_UQ111") return (over.zoning ?? (() => json(zoningOk())))(url);
    return json({}, 404);
  };
  return { fetch, calls };
}

function provider(fetch: FetchImpl, extra: Partial<Parameters<typeof createVworldProvider>[0]> = {}) {
  return createVworldProvider({ apiKey: API_KEY, fetch, now: () => Date.now(), ...extra });
}

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof SiteError, String(e));
    assert.equal(e.code, "AR021");
    return String(e.details?.["reason"]);
  }
  assert.fail("오류가 나야 한다");
}

test("URL: 출처·경로 고정, 사용자 값은 쿼리 값 칸에만 인코딩, 키는 key 값으로만", () => {
  const evil = "운중동 12&key=STEAL#frag/../../admin?x=1 http://evil.example";
  const url = buildVworldUrl(VWORLD_PATHS.geocode, { address: evil }, API_KEY);
  assert.equal(url.origin, VWORLD_ORIGIN);
  assert.equal(url.pathname, "/req/address");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("address"), evil);
  assert.deepEqual(url.searchParams.getAll("key"), [API_KEY]);
  assert.equal(url.searchParams.get("format"), "json");
});

test("주소 조회: 지오코딩 → 필지(점) → 용도지역, 같은 PNU면 필지 재호출 없음, 모든 요청이 고정 호스트·redirect error", async () => {
  const { fetch, calls } = mockFetch();
  const s = provider(fetch).start();
  const resolved = await s.resolve({ kind: "jibun", value: "운중동 12-4" });
  assert.equal(resolved.pnu, FIXTURE_PNU);
  const r = await s.fetchParcel(resolved);
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(c.url.origin, VWORLD_ORIGIN);
    assert.equal(c.init.redirect, "error");
    assert.equal(c.init.method, "GET");
    assert.equal(c.url.searchParams.get("crs"), "EPSG:5186");
  }
  assert.equal(calls[0]?.url.searchParams.get("type"), "PARCEL");
  assert.equal(calls[1]?.url.searchParams.get("geomFilter"), "POINT(200109 550111)");
  assert.equal(r.ring_m.length, 4, "닫는 점 제거");
  assert.deepEqual(r.ring_m[0], FIXTURE_RING[0]);
  assert.deepEqual(r.zoning, { use_district: "제1종일반주거지역", districts: [] });
  assert.equal(r.address_label, "[예시] 경기도 성남시 분당구 운중동 12-4");
  assert.deepEqual(r.roads, []);
});

test("PNU 조회: resolve는 제공자를 부르지 않고, fetchParcel은 attrFilter로 필지 1회 + 용도지역 1회", async () => {
  const { fetch, calls } = mockFetch();
  const s = provider(fetch).start();
  const resolved = await s.resolve({ kind: "pnu", value: FIXTURE_PNU });
  assert.equal(calls.length, 0);
  await s.fetchParcel(resolved);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.searchParams.get("attrFilter"), `pnu:=:${FIXTURE_PNU}`);
});

test("실패 정규화: NOT_FOUND·ERROR 상태·4xx(재시도 없음)·5xx(재시도 1회)·네트워크 → AR021 사유", async () => {
  assert.equal(await reasonOf(provider(mockFetch({ geocode: () => json(NOT_FOUND) }).fetch).start().resolve({ kind: "address", value: "없는 주소 1" })), "not_found");
  assert.equal(await reasonOf(provider(mockFetch({ geocode: () => json(PROVIDER_ERROR) }).fetch).start().resolve({ kind: "address", value: "주소 1" })), "invalid_response");

  const four = mockFetch({ parcel: () => json({}, 401) });
  assert.equal(await reasonOf(provider(four.fetch).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "http_status");
  assert.equal(four.calls.length, 1, "4xx 재시도 없음");

  let n = 0;
  const five = mockFetch({ parcel: () => (++n === 1 ? json({}, 503) : json(parcelOk())) });
  const r = await provider(five.fetch).start().fetchParcel({ pnu: FIXTURE_PNU, point: null });
  assert.equal(r.pnu, FIXTURE_PNU);
  assert.equal(n, 2, "5xx 재시도 1회");

  const net = mockFetch({ parcel: () => Promise.reject(new Error(`connect ECONNREFUSED https://api.vworld.kr/req/data?key=${API_KEY}`)) });
  const e = await provider(net.fetch)
    .start()
    .fetchParcel({ pnu: FIXTURE_PNU, point: null })
    .catch((x: unknown) => x);
  assert.ok(e instanceof SiteError);
  assert.equal(e.details?.["reason"], "network");
  assert.ok(!JSON.stringify({ m: e.message, d: e.details }).includes(API_KEY), "원 예외 메시지(키 포함)는 버린다");
});

test("응답 크기 상한: 선언 길이·실제 스트림 모두 초과하면 too_large", async () => {
  const big = "x".repeat(2048);
  const declared = mockFetch({ parcel: () => new Response(big, { headers: { "content-length": "999999999" } }) });
  assert.equal(await reasonOf(provider(declared.fetch).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "too_large");
  const streamed = mockFetch({ parcel: () => new Response(big) });
  assert.equal(await reasonOf(provider(streamed.fetch, { maxResponseBytes: 1024 }).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "too_large");
  const notJson = mockFetch({ parcel: () => new Response("<html>오류</html>") });
  assert.equal(await reasonOf(provider(notJson.fetch).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "invalid_response");
});

test("시간 상한: 호출 타임아웃은 abort로 끊고, 전체 마감 안에서만 재시도", async () => {
  const hang: Route = () => new Promise<Response>(() => undefined);
  const slow = mockFetch({ parcel: hang });
  const hangFetch: FetchImpl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      void slow.fetch(url, init);
    });
  const t0 = Date.now();
  assert.equal(await reasonOf(provider(hangFetch, { callTimeoutMs: 30, deadlineMs: 60 }).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "timeout");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(slow.calls.length, 1, "남은 시간 < 1초면 재시도하지 않는다");

  // 가짜 시계: 마감이 이미 지났으면 호출하지 않는다
  let clock = 0;
  const counted = mockFetch();
  const p = createVworldProvider({ apiKey: API_KEY, fetch: counted.fetch, now: () => clock, deadlineMs: 4500 });
  const s = p.start();
  clock = 5000;
  assert.equal(await reasonOf(s.fetchParcel({ pnu: FIXTURE_PNU, point: null })), "timeout");
  assert.equal(counted.calls.length, 0);
});

test("이상 좌표·폴리곤 거부: NaN·문자열·범위 밖·꼭짓점 초과·면적 0·거대 필지", async () => {
  const bad: unknown[] = [
    [[200100, 550100], [200110, "550100"], [200110, 550110]],
    [[200100, 550100], [200110, Number.NaN], [200110, 550110]],
    [[9_000_000, 550100], [9_000_010, 550100], [9_000_010, 550110]],
    [[200100, 550100], [200110, 550100], [200120, 550100]],
    [[200100, 550100], [203000, 550100], [203000, 553000]],
    Array.from({ length: RING_MAX_VERTICES + 5 }, (_, i) => [200100 + (i % 2) * 10, 550100 + i * 0.01]),
    [[200100, 550100]],
    "POLYGON((0 0))",
  ];
  for (const ring of bad) {
    assert.equal(cleanRing(ring), null, JSON.stringify(ring).slice(0, 60));
    const m = mockFetch({ parcel: () => json(parcelOk(ring)) });
    assert.equal(await reasonOf(provider(m.fetch).start().fetchParcel({ pnu: FIXTURE_PNU, point: null })), "invalid_response");
  }
});

test("정규화: PNU 형식 검사, 주소 표시 제어문자 제거·길이 상한, 다중 조각은 큰 것 + notes", () => {
  assert.throws(() => parseParcel(parcelOk(FIXTURE_RING, { pnu: "12-4" })), SiteError);
  const r = parseParcel(parcelOk(FIXTURE_RING, { addr: `운중동\u0000 12-4‮<script>${"가".repeat(300)}` }));
  assert.ok(r.address_label && r.address_label.length <= 200);
  assert.ok(!/[\u0000‮]/.test(r.address_label ?? ""));
  const small: [number, number][] = [
    [200200, 550200],
    [200202, 550200],
    [200202, 550202],
  ];
  const multi = {
    response: {
      status: "OK",
      result: {
        featureCollection: {
          features: [{ geometry: { type: "MultiPolygon", coordinates: [[small], [FIXTURE_RING, small]] }, properties: { pnu: FIXTURE_PNU } }],
        },
      },
    },
  };
  const m = parseParcel(multi);
  assert.equal(m.ring_m.length, 4);
  assert.deepEqual(m.notes.sort(), ["holes_dropped", "multipart"]);
});
