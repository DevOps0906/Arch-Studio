// POST /api/site/lookup 본체: 순서·상한(AR020)·공공 API 실패(AR021)·키/주소 비노출·해시만 기록·버스트 리밋(로그 A2·A3·A4·A6·A7·A10·A11).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { pnuHash } from "./hash.ts";
import { CANDIDATE_NOTICE, handleSiteLookup, SITE_LOOKUP_BURST, type SiteLookupDeps } from "./service.ts";
import { createVworldProvider, type FetchImpl } from "./vworld.ts";
import { FIXTURE_PNU, geocodeOk, NOT_FOUND, parcelOk, zoningOk } from "./vworld-fixtures.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const API_KEY = "VWORLD-SECRET-KEY-abcdef-123456";
const HASH_KEY = "site-lookup-hash-key-for-tests-0123456789";
const ADDRESS = "경기도 성남시 분당구 운중동 12-4";

interface World {
  session: GatewaySession | GatewayError;
  recorded: { org: string; hash: string }[];
  recordError?: { code: string; message: string };
  remaining: number;
  fetchCalls: string[];
  geocode?: unknown;
  providerOff?: boolean;
  /** 용도지역(LT_C_UQ111) 호출만 이 상태로 실패시킨다. */
  zoningStatus?: number;
  hashKey?: string;
}

function world(over: Partial<World> = {}): World {
  return {
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    recorded: [],
    remaining: 29,
    fetchCalls: [],
    ...over,
  };
}

function deps(w: World, rate = new MemoryRateLimitStore()): SiteLookupDeps {
  const fetch: FetchImpl = async (raw) => {
    w.fetchCalls.push(raw);
    const url = new URL(raw);
    if (w.zoningStatus && url.searchParams.get("data") === "LT_C_UQ111") return new Response("{}", { status: w.zoningStatus });
    const body =
      url.pathname === "/req/address" ? (w.geocode ?? geocodeOk()) : url.searchParams.get("data") === "LT_C_UQ111" ? zoningOk(["제1종일반주거지역", "지구단위계획구역"]) : parcelOk();
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return {
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    provider: w.providerOff ? null : createVworldProvider({ apiKey: API_KEY, fetch, now: () => NOW }),
    recorder: () => ({
      async record(org, hash) {
        if (w.recordError) throw w.recordError;
        w.recorded.push({ org, hash });
        return w.remaining;
      },
    }),
    hashKey: () => w.hashKey ?? HASH_KEY,
    rateLimit: rate,
    now: () => NOW,
  };
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://arch.example/api/site/lookup", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-access-token-value-0123456789", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const addressBody = { query: { kind: "address", value: ADDRESS } };
const pnuBody = { query: { kind: "pnu", value: FIXTURE_PNU } };

/** 콘솔 출력(로그) 모으기. */
function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => lines.push(a.map(String).join(" ")));
  return lines;
}

async function call(w: World, body: unknown = addressBody, rate?: MemoryRateLimitStore) {
  const res = await handleSiteLookup(req(body), deps(w, rate));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } } };
}

test("성공(주소): 후보 응답 형식, 해시만 기록, 원문·키 비노출(응답·로그)", async (t) => {
  const logs = captureLogs(t);
  const w = world();
  const r = await call(w);
  assert.equal(r.status, 200);
  const d = r.json.data!;
  assert.deepEqual(d["parcel"], { pnu: FIXTURE_PNU, address_label: "[예시] 경기도 성남시 분당구 운중동 12-4" });
  assert.equal(d["crs"], "EPSG:5186");
  assert.equal((d["boundary_m"] as unknown[]).length, 4);
  assert.deepEqual(d["zoning"], { use_district: "제1종일반주거지역", districts: ["지구단위계획구역"] });
  assert.deepEqual(d["source"], { kind: "input_candidate", judgment_basis: false, notice: CANDIDATE_NOTICE });
  assert.equal(d["remaining_today"], 29);
  assert.equal((d["sources"] as { provider: string }[])[0]?.provider, "vworld");
  // DB에는 세션 org + HMAC 해시만
  assert.deepEqual(w.recorded, [{ org: ORG, hash: pnuHash(FIXTURE_PNU, HASH_KEY) }]);
  // 키·해시 키는 응답에 없다. 로그에는 주소·PNU·해시·키가 없다
  for (const secret of [API_KEY, HASH_KEY]) assert.ok(!r.text.includes(secret));
  const all = logs.join("\n");
  for (const s of [API_KEY, HASH_KEY, ADDRESS, "운중동", FIXTURE_PNU, pnuHash(FIXTURE_PNU, HASH_KEY), "200100"]) assert.ok(!all.includes(s), s);
  assert.match(all, /site_lookup\.ok/);
});

test("PNU 조회: 상한 기록이 제공자 호출보다 먼저(상한 초과면 제공자 0회)", async () => {
  const w = world({ recordError: { code: "AR020", message: "record_site_lookup: daily limit 30 reached" } });
  const r = await call(w, pnuBody);
  assert.equal(r.status, 429);
  assert.equal(r.json.error?.code, "AR020");
  assert.equal(w.fetchCalls.length, 0);
  assert.ok(!r.text.includes("daily limit"), "DB 원문 미노출");
});

test("AR020(주소): 지오코딩·필지 확인 2회 뒤 기록에서 멈춘다(용도지역 미호출)", async () => {
  const w = world({ recordError: { code: "AR020", message: "x" } });
  const r = await call(w);
  assert.equal(r.status, 429);
  assert.equal(r.json.error?.code, "AR020");
  assert.equal(w.fetchCalls.length, 2);
});

test("AR021: 공공 API 실패는 502 + reason + next=draw, 기록 전 실패는 상한을 쓰지 않는다", async (t) => {
  const logs = captureLogs(t);
  const w = world({ geocode: NOT_FOUND });
  const r = await call(w);
  assert.equal(r.status, 502);
  assert.equal(r.json.error?.code, "AR021");
  assert.deepEqual(r.json.error?.details, { reason: "not_found", next: "draw" });
  assert.equal(w.recorded.length, 0);
  assert.ok(!logs.join("\n").includes("운중동"));
  assert.match(logs.join("\n"), /"reason":"not_found"/);
});

test("조회 꺼짐(키 없음·D-14 기본): AR021 not_configured, 제공자·DB 미호출", async () => {
  const w = world({ providerOff: true });
  const r = await call(w);
  assert.equal(r.status, 502);
  assert.deepEqual(r.json.error?.details, { reason: "not_configured", next: "draw" });
  assert.equal(w.recorded.length, 0);
});

test("인증·권한·엔타이틀먼트·입력: 401/403/402/422/400/413, 어느 경우도 제공자·DB 미호출", async () => {
  const cases: [Partial<World>, unknown, number, string][] = [
    [{ session: new GatewayError("unauthorized") }, addressBody, 401, "unauthorized"],
    [{ session: new GatewayError("no_org") }, addressBody, 403, "no_org"],
    [{ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: "t".repeat(30) } }, addressBody, 403, "42501"],
    [{ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: "t".repeat(30) } }, addressBody, 402, "entitlement_expired"],
    [{}, { query: { kind: "address", value: "운중동 12&key=x" } }, 422, "invalid_input"],
    [{}, { ...addressBody, org_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, 422, "invalid_input"],
    [{}, "{not json", 400, "invalid_json"],
    [{}, { query: { kind: "address", value: "가".repeat(2000) } }, 413, "payload_too_large"],
  ];
  for (const [over, body, status, code] of cases) {
    const w = world(over);
    const r = await call(w, body);
    assert.equal(r.status, status, code);
    assert.equal(r.json.error?.code, code);
    assert.equal(w.fetchCalls.length, 0, code);
    assert.equal(w.recorded.length, 0, code);
  }
});

test("해시 키가 짧거나 없으면 503, 제공자 미호출(키 값 미노출)", async () => {
  const w = world({ hashKey: "short" });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "site_lookup_unavailable");
  assert.equal(w.fetchCalls.length, 0);
  assert.ok(!r.text.includes("short"));
});

test("조직 버스트 리밋: 분당 상한 다음 요청은 429 + retry-after, 제공자 미호출", async () => {
  const rate = new MemoryRateLimitStore();
  const w = world();
  for (let i = 0; i < SITE_LOOKUP_BURST.limit; i++) assert.equal((await call(w, pnuBody, rate)).status, 200);
  const before = w.fetchCalls.length;
  const res = await handleSiteLookup(req(pnuBody), deps(w, rate));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
  assert.equal(w.fetchCalls.length, before);
});

test("DB 기타 오류는 500 internal(원문 미노출)", async () => {
  const w = world({ recordError: { code: "42501", message: "record_site_lookup: service_role only" } });
  const r = await call(w, pnuBody);
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes("service_role"));
});

test("용도지역 호출 실패: 경계는 돌려주고(zoning null + note), 기록(차감)은 한 번, AR021이 아니다", async (t) => {
  const logs = captureLogs(t);
  const w = world({ zoningStatus: 503 });
  const r = await call(w);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const d = r.json.data!;
  assert.equal((d["boundary_m"] as unknown[]).length, 4);
  assert.deepEqual(d["zoning"], { use_district: null, districts: [] });
  assert.deepEqual(d["notes"], ["zoning_unavailable"]);
  assert.deepEqual((d["sources"] as { datasets: string[] }[])[0]?.datasets, ["LP_PA_CBND_BUBUN"]);
  assert.equal(w.recorded.length, 1);
  for (const s of [API_KEY, HASH_KEY]) assert.ok(!r.text.includes(s), s);
  const all = logs.join("\n");
  for (const s of [API_KEY, HASH_KEY, ADDRESS, FIXTURE_PNU]) assert.ok(!all.includes(s), s);
});
