// 웹 어댑터 5종 테스트(AR-06-072): 070 계약 하네스 + 읽기 캐시·로그아웃·토큰·권리 매핑.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isBridgeError } from "../adapters/errors.ts";
import type { SaveProjectInput } from "../adapters/project-store.ts";
import { LEAK, runAdapterContract, testProjectId } from "../testing/contract.ts";
import { createFileFixture, type FileFixture } from "../testing/files.ts";
import { spyWebStorage } from "../test-helpers.ts";
import type { ExportFormat } from "../adapters/exporter.ts";
import { createCloudProjectStore, createWebAdapters } from "./adapters.ts";
import { BASE, createFakeCloud, createFakeIdb, fakeJwt, STORAGE, type FakeCloud } from "./fakes.ts";
import { WebApi } from "./http.ts";
import type { WebFileHost } from "./file-gateway.ts";
import { createIndexedDbReadCache } from "./read-cache.ts";

/** 파일 fixture(070)를 웹 파일 호스트로 바꾼다. 내용은 실제로 읽을 때만 fixture.read를 부른다. */
function fixtureFileHost(fx: FileFixture): WebFileHost {
  return {
    async pickFile() {
      const offered = fx.takeImport();
      if (!offered) return null;
      return {
        name: offered.name,
        size: offered.size,
        arrayBuffer: async () => {
          const bytes = fx.read(offered);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        },
      };
    },
    async saveFile(format: ExportFormat, data: Uint8Array) {
      const target = fx.takeSaveTarget(format);
      if (!target) return "cancelled";
      if (target.failWith) throw new Error("write");
      fx.write(target.path, data);
      return "saved";
    },
  };
}

function setup(
  cloudOptions?: Parameters<typeof createFakeCloud>[0],
  shared: { cloud?: FakeCloud; idb?: ReturnType<typeof createFakeIdb>; token?: string } = {},
) {
  const cloud = shared.cloud ?? createFakeCloud(cloudOptions);
  const idb = shared.idb ?? createFakeIdb();
  const files = createFileFixture();
  const adapters = createWebAdapters({
    baseUrl: BASE,
    getAccessToken: async () => shared.token ?? cloud.token,
    fetch: cloud.fetch,
    fileHost: fixtureFileHost(files),
    cache: createIndexedDbReadCache(idb.factory),
  });
  return { cloud, idb, files, adapters };
}

runAdapterContract("web", () => {
  const { adapters, files } = setup();
  return { adapters, files };
});

const input = (n: number, patch: Partial<SaveProjectInput> = {}): SaveProjectInput => ({
  id: testProjectId(n),
  name: `프로젝트 ${n}`,
  siteLabel: "서울 마포구",
  schemaVersion: 1,
  engineVersion: "0.1.0",
  designModel: JSON.stringify({ n }),
  expectedVersion: null,
  ...patch,
});

const nonGet = (cloud: FakeCloud) => cloud.mutating().length;

test("캐시: list·open은 IndexedDB에 읽은 것을 넣고, 서버가 안 닿으면 캐시를 돌려준다(쓰기 호출 0)", async () => {
  const { adapters, cloud, idb } = setup();
  await adapters.projects.save(input(1));
  idb.data.clear();
  const writes = nonGet(cloud);
  const list = await adapters.projects.list();
  const opened = await adapters.projects.open(testProjectId(1));
  assert.equal(list.length, 1);
  assert.ok(idb.data.has("list") && idb.data.has(`project:${testProjectId(1)}`));
  cloud.online = false;
  assert.deepEqual(await adapters.projects.list(), list);
  assert.deepEqual(await adapters.projects.open(testProjectId(1)), opened);
  assert.equal(nonGet(cloud), writes, "읽기 경로가 서버로 쓰기 요청을 보냄");
  await assert.rejects(adapters.projects.open(testProjectId(9)), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
});

test("캐시: 저장·삭제는 캐시를 근거로 하지 않는다(오래된 캐시로 저장 시도 → 서버 충돌, 업로드 0)", async () => {
  const { adapters, cloud } = setup();
  await adapters.projects.save(input(2));
  await adapters.projects.open(testProjectId(2)); // 캐시 version 1
  cloud.bump(testProjectId(2)); // 서버는 version 2
  const before = nonGet(cloud);
  await assert.rejects(adapters.projects.save(input(2, { expectedVersion: 1 })), (e) => isBridgeError(e, "VERSION_CONFLICT"));
  assert.equal(nonGet(cloud), before, "충돌인데 업로드·저장 요청이 나감");
  // 서버가 닿지 않으면 캐시가 있어도 저장은 실패한다.
  cloud.online = false;
  await assert.rejects(adapters.projects.save(input(2, { expectedVersion: 2 })), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  await assert.rejects(adapters.projects.delete(testProjectId(2), 2), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
});

test("캐시: 인증 실패(401)는 캐시로 가리지 않는다", async () => {
  const { adapters, cloud } = setup();
  await adapters.projects.save(input(3));
  await adapters.projects.list();
  cloud.rejectAuth = true;
  await assert.rejects(adapters.projects.list(), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
});

test("목록: 커서 페이지를 끝까지 따라간다", async () => {
  const { adapters } = setup({ pageSize: 2 });
  for (let n = 1; n <= 5; n++) await adapters.projects.save(input(n));
  assert.equal((await adapters.projects.list()).length, 5);
});

test("로그아웃: clearSecrets가 비밀과 IndexedDB 캐시를 모두 지운다", async () => {
  const { adapters, idb } = setup();
  await adapters.secrets.set("auth.session", "x");
  await adapters.projects.save(input(4));
  await adapters.projects.list();
  assert.ok(idb.data.size > 0);
  await adapters.clearSecrets();
  assert.equal(idb.data.size, 0);
  assert.equal(await adapters.secrets.get("auth.session"), null);
  // 로그아웃 뒤 같은 id를 다시 저장할 수 있다(묘비도 초기화).
  await adapters.projects.delete(testProjectId(4), 1);
  await adapters.clearSecrets();
  assert.equal((await adapters.projects.save(input(4))).version, 1);
});

test("로그아웃: 캐시 삭제가 실패해도 비밀은 지워지고 오류가 올라온다", async () => {
  const { adapters, idb } = setup();
  await adapters.secrets.set("auth.session", "x");
  idb.failClear = true;
  await assert.rejects(adapters.clearSecrets());
  assert.equal(await adapters.secrets.get("auth.session"), null);
});

test("토큰: Bearer는 API 요청에만, 서명 URL·저장소 요청에는 없음 / 영속 스토리지 쓰기 0", async () => {
  const spy = spyWebStorage();
  try {
    const { adapters, cloud } = setup();
    await adapters.secrets.set("auth.session", `tok.${LEAK}`);
    await adapters.projects.save(input(5));
    await adapters.projects.open(testProjectId(5));
    await adapters.entitlement.can("web_edit");
    for (const c of cloud.calls) {
      if (c.url.startsWith(STORAGE)) assert.equal(c.authorization, null, c.method);
      else assert.equal(c.authorization, `Bearer ${cloud.token}`);
    }
    assert.deepEqual(spy.writes, []);
  } finally {
    spy.restore();
  }
});

test("토큰이 없으면 서버 호출 없이 실패 닫힘", async () => {
  const cloud = createFakeCloud();
  const adapters = createWebAdapters({ baseUrl: BASE, getAccessToken: async () => null, fetch: cloud.fetch, cache: createIndexedDbReadCache(undefined) });
  await assert.rejects(adapters.projects.list(), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  assert.deepEqual(await adapters.entitlement.can("web_edit"), { allowed: false, reason: "unverified" });
  assert.equal(cloud.calls.length, 0);
});

test("서명 URL이 https가 아니면 업로드하지 않는다", async () => {
  const { adapters, cloud } = setup();
  const inner = cloud.fetch;
  const patched: typeof fetch = async (u, init) => {
    const res = await inner(u, init);
    if (String(u).endsWith("/upload-url")) {
      const body = (await res.json()) as { ok: true; data: Record<string, string> };
      return new Response(JSON.stringify({ ok: true, data: { ...body.data, signed_upload_url: "http://evil.test/up" } }));
    }
    return res;
  };
  const guarded = createWebAdapters({ baseUrl: BASE, getAccessToken: async () => cloud.token, fetch: patched, cache: createIndexedDbReadCache(undefined) });
  await assert.rejects(guarded.projects.save(input(6)), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  assert.equal(cloud.calls.filter((c) => c.url.startsWith("http://evil")).length, 0);
  void adapters;
});

test("baseUrl: https(또는 localhost http)만", () => {
  const base = { getAccessToken: async () => null };
  assert.throws(() => createWebAdapters({ ...base, baseUrl: "http://app.test" }));
  assert.throws(() => createWebAdapters({ ...base, baseUrl: "not a url" }));
  createWebAdapters({ ...base, baseUrl: "http://localhost:3000", cache: createIndexedDbReadCache(undefined) });
});

test("권리: 서버 rights·seat·products로 판정, 실패 닫힘", async () => {
  const off = setup({ rights: { view_export: true, web_edit: false }, seat: "revoked" });
  assert.deepEqual(await off.adapters.entitlement.can("web_edit"), { allowed: false, reason: "seat_revoked" });
  assert.deepEqual(await off.adapters.entitlement.can("ai_chat"), { allowed: false, reason: "unverified" });
  assert.equal((await off.adapters.entitlement.status()).state, "revoked");
  const expired = setup({ rights: { web_edit: false }, products: [{ kind: "term", term_ends_at: "2020-01-01T00:00:00Z" }] });
  assert.deepEqual(await expired.adapters.entitlement.can("web_edit"), { allowed: false, reason: "expired" });
  const fallback = setup({ rights: { web_edit: false }, products: [{ kind: "perpetual", term_ends_at: null }] });
  assert.deepEqual(await fallback.adapters.entitlement.can("web_edit"), { allowed: false, reason: "fallback" });
  const none = setup({ rights: { web_edit: false }, products: [] });
  assert.deepEqual(await none.adapters.entitlement.can("web_edit"), { allowed: false, reason: "no_product" });
  const ok = setup();
  assert.deepEqual(await ok.adapters.entitlement.can("web_edit"), { allowed: true });
  assert.equal((await ok.adapters.entitlement.status()).state, "active");
  ok.cloud.online = false;
  assert.deepEqual(await ok.adapters.entitlement.can("web_edit"), { allowed: false, reason: "offline" });
  assert.deepEqual(await ok.adapters.entitlement.can("view_export"), { allowed: true });
});

test("웹 묶음: updater 없음·license 없음·capabilities 웹 값", () => {
  const { adapters } = setup();
  assert.equal(adapters.updater, null);
  assert.equal(adapters.entitlement.license, null);
  assert.equal(adapters.capabilities.persistentSecrets, false);
});

test("계정 전환: 이전 사용자의 캐시는 오프라인 list·open에서 보이지 않고 폐기된다", async () => {
  const a = setup(undefined, { token: fakeJwt("user-a") });
  await a.adapters.projects.save(input(7));
  await a.adapters.projects.list();
  assert.equal((await a.adapters.projects.open(testProjectId(7)))?.version, 1);
  const b = setup(undefined, { cloud: a.cloud, idb: a.idb, token: fakeJwt("user-b") });
  a.cloud.online = false;
  await assert.rejects(b.adapters.projects.list(), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  await assert.rejects(b.adapters.projects.open(testProjectId(7)), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  assert.ok(![...a.idb.data.keys()].some((k) => k.startsWith("project:") || k === "list"), "이전 사용자 데이터가 남음");
  // 같은 사용자라도 org가 다르면 다른 주체.
  const c = setup(undefined, { cloud: a.cloud, idb: a.idb, token: fakeJwt("user-b", "org-2") });
  a.cloud.online = true;
  await b.adapters.projects.save(input(8));
  a.cloud.online = false;
  await assert.rejects(c.adapters.projects.list(), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
});

test("로그아웃 경합: 진행 중 요청이 끝나도 지운 캐시를 다시 채우지 않는다", async () => {
  const { adapters, cloud, idb } = setup();
  await adapters.projects.save(input(10));
  await adapters.clearSecrets();
  let release!: () => void;
  cloud.gate = new Promise<void>((r) => (release = r));
  const pending = adapters.projects.list();
  await new Promise((r) => setTimeout(r, 5));
  const logout = adapters.clearSecrets();
  release();
  cloud.gate = null;
  await Promise.allSettled([pending, logout]);
  assert.equal(idb.data.size, 0, "로그아웃 뒤 캐시에 데이터가 남음");
});

test("다운로드 상한: Content-Length는 읽기 전에, 없으면 누적 중 중단", async () => {
  let pulled = 0;
  const big = (headers: Record<string, string>) =>
    (async () =>
      new Response(
        new ReadableStream(
          {
            pull(c) {
              pulled++;
              c.enqueue(new Uint8Array(10));
              if (pulled > 100) c.close();
            },
          },
          { highWaterMark: 0 },
        ),
        { headers },
      )) as unknown as typeof fetch;
  const api = (f: typeof fetch) => new WebApi({ baseUrl: BASE, getAccessToken: async () => "t", fetch: f });
  assert.equal(await api(big({ "content-length": "1000" })).transfer(`${STORAGE}/dl/x`, { method: "GET", maxBytes: 50 }), null);
  assert.equal(pulled, 0, "선언 크기 초과인데 본문을 읽음");
  assert.equal(await api(big({})).transfer(`${STORAGE}/dl/x`, { method: "GET", maxBytes: 50 }), null);
  assert.ok(pulled < 100, "누적 초과 후에도 계속 읽음");
  const ok = await api(async () => new Response(new Uint8Array(5))).transfer(`${STORAGE}/dl/x`, { method: "GET", maxBytes: 50 });
  assert.equal((ok as Uint8Array).byteLength, 5);
});

test("서명 URL: 기본 https만, 옵션으로만 http 허용", () => {
  const mk = (allowInsecureSignedUrls?: boolean) =>
    new WebApi({ baseUrl: BASE, getAccessToken: async () => "t", ...(allowInsecureSignedUrls ? { allowInsecureSignedUrls } : {}) });
  assert.equal(mk().isSafeSignedUrl("http://localhost:54321/up"), false);
  assert.equal(mk().isSafeSignedUrl("https://s.test/up"), true);
  assert.equal(mk(true).isSafeSignedUrl("http://localhost:54321/up"), true);
});

test("저장: 서버 version이 expected+1보다 커도 성공(서버 값 반환, 캐시 갱신)", async () => {
  const { cloud, idb } = setup();
  const inner = cloud.fetch;
  const skewed: typeof fetch = async (u, init) => {
    const res = await inner(u, init);
    if (String(u).endsWith("/api/cloud-projects") && init?.method === "POST") {
      const body = (await res.json()) as { ok: true; data: { project_uuid: string; version: number } };
      return new Response(JSON.stringify({ ok: true, data: { ...body.data, version: body.data.version + 1 } }));
    }
    return res;
  };
  const a = createWebAdapters({ baseUrl: BASE, getAccessToken: async () => cloud.token, fetch: skewed, cache: createIndexedDbReadCache(idb.factory) });
  const r = await a.projects.save(input(12));
  assert.equal(r.version, 2);
  assert.equal((idb.data.get(`project:${testProjectId(12)}`) as { version: number }).version, 2);
});

// ---- 설치형 수동 업로드(AR-06-077): local_id·폴더 키 ----------------------------------------------
function cloudStore(cloud: FakeCloud) {
  return createCloudProjectStore({ baseUrl: BASE, getAccessToken: async () => cloud.token, fetch: cloud.fetch, cache: createIndexedDbReadCache(createFakeIdb().factory) });
}
const postBody = (cloud: FakeCloud) =>
  cloud.calls
    .filter((c) => c.method === "POST" && new URL(c.url).pathname === "/api/cloud-projects")
    .map((c) => JSON.parse(c.body ?? "{}") as Record<string, unknown>);

test("업로드: 새 사본만 local_id를 보내고, 폴더 키·upload-url은 항상 project_uuid", async () => {
  const cloud = createFakeCloud();
  const store = cloudStore(cloud);
  const local = testProjectId(40);
  const uuid = testProjectId(41);
  assert.equal((await store.save(input(41), { localId: local })).version, 1);
  assert.equal((await store.save(input(41, { expectedVersion: 1 }), { localId: local })).version, 2);
  const [first, second] = postBody(cloud);
  assert.equal(first!.local_id, local);
  assert.equal("local_id" in second!, false, "기존 사본에는 local_id를 보내지 않는다");
  for (const b of [first!, second!]) {
    assert.equal(b.project_uuid, uuid);
    assert.equal(String(b.storage_path).split("/")[3], uuid);
    assert.ok(!String(b.storage_path).includes(local));
  }
  const signs = cloud.calls.filter((c) => c.url.endsWith("/upload-url")).map((c) => new URL(c.url).pathname);
  assert.deepEqual(signs, [`/api/cloud-projects/${uuid}/upload-url`, `/api/cloud-projects/${uuid}/upload-url`]);
  assert.deepEqual(await store.findByLocalId(local), { projectUuid: uuid, version: 2 });
  assert.equal(await store.findByLocalId(testProjectId(49)), null);
});

test("업로드: 서명 경로의 프로젝트 폴더가 project_uuid가 아니면(local_id 폴더) 올리지도 저장하지도 않는다", async () => {
  const cloud = createFakeCloud();
  const store = cloudStore(cloud);
  cloud.signFolder = testProjectId(42);
  await assert.rejects(store.save(input(43), { localId: testProjectId(42) }), (e) => isBridgeError(e, "PROJECT_UNAVAILABLE"));
  assert.equal(cloud.blobs.size, 0);
  assert.equal(postBody(cloud).length, 0);
});

test("업로드: 같은 local_id가 이미 다른 사본이면(23505) VERSION_CONFLICT", async () => {
  const cloud = createFakeCloud();
  const store = cloudStore(cloud);
  await store.save(input(44), { localId: testProjectId(46) });
  await assert.rejects(store.save(input(45), { localId: testProjectId(46) }), (e) => isBridgeError(e, "VERSION_CONFLICT"));
  assert.equal(cloud.rows.has(testProjectId(45)), false);
});
