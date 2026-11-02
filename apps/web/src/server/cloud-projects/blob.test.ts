// GET /api/cloud-projects/{id}/blob(AR-06-072): entitled=false 허용·member+·같은 조직만(다른 조직·경로 불일치 404)·
// 응답 모양·서명 URL https·Storage 실패·객체 없음 503·레이트 리밋·로그에 경로·URL 없음.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { logger } from "../../lib/logger.ts";
import { BLOB_RATE, BLOB_URL_TTL_S, handleGetCloudBlob, type CloudBlobDeps, type CloudBlobRow } from "./blob.ts";
import { SNAPSHOT_MAX_BYTES } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const P1 = "11111111-1111-4111-8111-111111111111";
const OBJ = "99999999-9999-4999-8999-999999999999";
const TOKEN = "user-access-token-value-0123456789";
const pathFor = (org: string, folder: string) => `${org}/arch/project_snapshot/${folder}/${OBJ}.arch`;
const SIGNED = `https://storage.example/sign/${OBJ}?token=signed-secret`;

interface World {
  session: GatewaySession | GatewayError;
  rows: Map<string, CloudBlobRow>;
  objects: Map<string, number>;
  signFails?: boolean;
  signUrl?: string;
  digests: string[];
  signs: [string, number][];
}

function world(over: Partial<World> = {}): World {
  return {
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: TOKEN },
    rows: new Map([[`${ORG}:${P1}`, { org_id: ORG, version: 3, storage_path: pathFor(ORG, P1) }]]),
    objects: new Map([[pathFor(ORG, P1), 5000]]),
    digests: [],
    signs: [],
    ...over,
  };
}

function deps(w: World, rate = new MemoryRateLimitStore()): CloudBlobDeps {
  return {
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    repo: () => ({ findSnapshot: async (org, id) => w.rows.get(`${org}:${id}`) ?? null }),
    reader: () => ({
      async stat(path) {
        w.digests.push(path);
        const n = w.objects.get(path);
        return n === undefined ? null : { bytes: n };
      },
      async signDownload(path, ttl) {
        if (w.signFails) throw new Error(`sign failed ${path}`);
        w.signs.push([path, ttl]);
        return w.signUrl ?? SIGNED;
      },
    }),
    rateLimit: rate,
    now: () => Date.UTC(2026, 10, 2),
  };
}

const call = (w: World, id = P1, query = "", rate?: MemoryRateLimitStore) =>
  handleGetCloudBlob(new Request(`https://app.test/api/cloud-projects/${id}/blob${query}`, { headers: { authorization: `Bearer ${TOKEN}` } }), id, deps(w, rate));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
type Json = Record<string, any>;

function captureLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    t.mock.method(logger, level, (...args: unknown[]) => void lines.push(JSON.stringify(args)));
  }
  return lines;
}

test("blob: 서명 URL + org_id·version·bytes, sha256은 null(서버 해시 없음), 10분 서명", async (t) => {
  const logs = captureLogs(t);
  const w = world();
  const res = await call(w);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Json;
  assert.deepEqual(body, { ok: true, data: { url: SIGNED, org_id: ORG, version: 3, bytes: 5000, sha256: null } });
  assert.deepEqual(w.signs, [[pathFor(ORG, P1), BLOB_URL_TTL_S]]);
  assert.equal(res.headers.get("cache-control"), "no-store");
  for (const l of logs) {
    assert.ok(!l.includes(OBJ), "로그에 경로");
    assert.ok(!l.includes("signed-secret"), "로그에 서명 URL");
    assert.ok(!l.includes(TOKEN));
  }
});

test("blob: entitled=false(만료·미배정·회수)여도 허용, viewer는 42501", async () => {
  const expired = world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: TOKEN } });
  assert.equal((await call(expired)).status, 200);
  const viewer = world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: TOKEN } });
  const res = await call(viewer);
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as Json).error.code, "42501");
  assert.deepEqual(viewer.digests, []);
});

test("blob: 없는 행·다른 조직 행·경로 불일치는 모두 not_found 404(서명 0)", async () => {
  const missing = world({ rows: new Map() });
  const r1 = await call(missing);
  assert.equal(r1.status, 404);
  assert.equal(((await r1.json()) as Json).error.code, "not_found");
  // 저장소가 다른 조직 행을 돌려줘도(RLS 이상) 서버가 대조해 버린다.
  const leak = world({ rows: new Map([[`${ORG}:${P1}`, { org_id: OTHER_ORG, version: 1, storage_path: pathFor(OTHER_ORG, P1) }]]) });
  assert.equal((await call(leak)).status, 404);
  const wrongFolder = world({ rows: new Map([[`${ORG}:${P1}`, { org_id: ORG, version: 1, storage_path: pathFor(ORG, OBJ) }]]) });
  assert.equal((await call(wrongFolder)).status, 404);
  for (const w of [missing, leak, wrongFolder]) assert.deepEqual(w.signs, []);
});

test("blob: 행은 있는데 Storage 객체가 없으면(동시 저장 중 이전 객체 삭제) 503 재시도 가능, 서명 0", async () => {
  const w = world({ objects: new Map() });
  const res = await call(w);
  assert.equal(res.status, 503);
  const body = (await res.json()) as Json;
  assert.equal(body.error.code, "storage_unavailable");
  assert.equal(body.error.details.retryable, true);
  assert.equal(res.headers.get("retry-after"), "1");
  assert.deepEqual(w.signs, []);
});

test("blob: 객체 크기가 상한을 넘거나 0이면 500", async () => {
  assert.equal((await call(world({ objects: new Map([[pathFor(ORG, P1), SNAPSHOT_MAX_BYTES + 1]]) }))).status, 500);
  assert.equal((await call(world({ objects: new Map([[pathFor(ORG, P1), 0]]) }))).status, 500);
});

test("blob: 잘못된 id·쿼리 422, 인증 실패 401", async () => {
  assert.equal((await call(world(), "not-a-uuid")).status, 422);
  assert.equal((await call(world(), P1, "?path=x")).status, 422);
  const anon = world({ session: new GatewayError("unauthorized") });
  assert.equal((await call(anon)).status, 401);
});

test("blob: Storage 실패 503(원문 없음), http 서명 URL은 500", async () => {
  const w = world({ signFails: true });
  const res = await call(w);
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes(OBJ));
  assert.equal((await call(world({ signUrl: "http://storage.example/x" }))).status, 500);
});

test("blob: 조직당 레이트 리밋 429", async () => {
  const rate = new MemoryRateLimitStore();
  const w = world();
  for (let i = 0; i < BLOB_RATE.limit; i++) assert.equal((await call(w, P1, "", rate)).status, 200);
  const res = await call(w, P1, "", rate);
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
});
