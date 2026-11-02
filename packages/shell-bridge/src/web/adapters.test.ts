// 웹 어댑터(AR-06-072): 계약 하네스(가짜 클라우드 API + 파일 fixture) + 웹 고유 보장
// (읽기 캐시만·편집 캐시 업로드 0, 로그아웃 시 캐시 삭제, 영속 웹 스토리지 0, 읽기 전 크기 거부, AR041 → VERSION_CONFLICT).
// 가짜 서버는 073 서버(apps/web/src/server/cloud-projects)의 응답 봉투·상태 코드를 흉내 낸다. DELETE·blob GET은 072 제안 라우트.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BridgeError, WEB_CAPABILITIES } from "../index.ts";
import type { ProjectRecord, SaveProjectInput } from "../adapters/project-store.ts";
import { IMPORT_MAX_BYTES } from "../adapters/file-gateway.ts";
import { createFileFixture, LEAK, runAdapterContract, testProjectId, type FileFixture } from "../testing/index.ts";
import { errorSurface, spyWebStorage, TOKEN } from "../test-helpers.ts";
import { createWebAdapters } from "./adapters.ts";
import type { WebFileHost } from "./file-gateway.ts";
import type { FetchFn } from "./http.ts";
import { IdbProjectCache, type ProjectReadCache } from "./project-cache.ts";
import { SNAPSHOT_MAX_BYTES } from "./project-store.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");

interface Row {
  name: string;
  version: number;
  path: string;
  deleted: boolean;
  updatedAt: string;
}

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: Uint8Array | string | null;
}

/** 073 클라우드 API 흉내. `entitlement`로 `GET /api/entitlement` 응답을 바꾼다. */
function createCloudServer() {
  const rows = new Map<string, Row>();
  const storage = new Map<string, Uint8Array>();
  const uploads = new Map<string, string>();
  const calls: Call[] = [];
  let tick = 0;
  let n = 0;
  const state = { entitlement: null as unknown, offline: false, pageSize: 2 };
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(status < 300 ? { ok: true, data } : { ok: false, error: data }), { status });
  const err = (status: number, code: string, details?: unknown) => json(status, { code, message: "고정 문구", details });

  const fetch: FetchFn = async (input, init = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body instanceof Uint8Array ? init.body : typeof init.body === "string" ? init.body : null;
    calls.push({ method, url: input, auth: headers.authorization ?? null, body });
    if (state.offline) throw new TypeError(`network ${LEAK}`);
    const url = new URL(input, "https://app.test");

    if (url.host === "storage.test") {
      if (method === "PUT") {
        const path = uploads.get(url.pathname);
        if (!path || !(body instanceof Uint8Array)) return new Response(null, { status: 400 });
        storage.set(path, body.slice());
        return new Response(null, { status: 200 });
      }
      const bytes = storage.get(decodeURIComponent(url.pathname.slice("/download/".length)));
      return bytes ? new Response(bytes as BodyInit, { headers: { "content-length": String(bytes.byteLength) } }) : new Response(null, { status: 404 });
    }
    const req = typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {};
    const p = url.pathname;
    if (p === "/api/entitlement") return state.entitlement ? json(200, state.entitlement) : err(500, "internal");
    if (p === "/api/cloud-projects" && method === "GET") {
      const all = [...rows.entries()].filter(([, r]) => !r.deleted).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const page = all.slice(start, start + state.pageSize);
      const next = start + state.pageSize < all.length ? String(start + state.pageSize) : null;
      return json(200, {
        items: page.map(([id, r]) => ({ project_uuid: id, local_id: null, name: r.name, version: r.version, bytes: 1, updated_at: r.updatedAt })),
        next,
        max: 100,
        retention_until: null,
      });
    }
    const m = /^\/api\/cloud-projects\/([^/]+)(\/upload-url|\/blob)?$/.exec(p);
    if (m && m[2] === "/upload-url" && method === "POST") {
      if (req.ext !== "arch" || typeof req.bytes !== "number" || typeof req.sha256 !== "string") return err(422, "invalid_input");
      const key = `/upload/${++n}`;
      const path = `${ORG}/arch/project_snapshot/${m[1]}/${n}.arch`;
      uploads.set(key, path);
      return json(200, { signed_upload_url: `https://storage.test${key}`, path, expires_at: "2026-11-02T00:00:00Z" });
    }
    if (p === "/api/cloud-projects" && method === "POST") {
      const id = String(req.project_uuid);
      const expected = Number(req.expected_version);
      const row = rows.get(id);
      if (!storage.has(String(req.storage_path))) return err(422, "23514");
      if (row?.deleted || (!row && expected > 0)) return err(404, "not_found");
      if (row && row.version !== expected) return err(409, "AR041", { current_version: row.version });
      const next: Row = { name: String(req.name), version: expected + 1, path: String(req.storage_path), deleted: false, updatedAt: new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString() };
      rows.set(id, next);
      return json(200, { project_uuid: id, version: next.version });
    }
    if (m && m[2] === "/blob" && method === "GET") {
      const row = rows.get(m[1]!);
      if (!row || row.deleted) return err(404, "not_found");
      const bytes = storage.get(row.path)!;
      return json(200, { url: `https://storage.test/download/${encodeURIComponent(row.path)}`, version: row.version, bytes: bytes.byteLength, sha256: sha(bytes), schema_version: 1 });
    }
    if (m && !m[2] && method === "DELETE") {
      const row = rows.get(m[1]!);
      if (!row || row.deleted) return err(404, "not_found");
      if (row.version !== Number(url.searchParams.get("expected_version"))) return err(409, "AR041", { current_version: row.version });
      row.deleted = true;
      return json(200, { project_uuid: m[1], deleted: true });
    }
    return err(404, "not_found");
  };
  return { fetch, rows, storage, calls, state };
}

/** 계약 하네스의 파일 fixture를 브라우저 대화상자 자리에 꽂는다(File.size는 읽기 전, arrayBuffer가 실제 읽기). */
function fixtureHost(fx: FileFixture): WebFileHost {
  return {
    async pickOpen() {
      const f = fx.takeImport();
      if (!f) return null;
      return { name: f.name, size: f.size, arrayBuffer: async () => fx.read(f).slice().buffer as ArrayBuffer };
    },
    async pickSave(format) {
      const t = fx.takeSaveTarget(format);
      if (!t) return null;
      return {
        name: t.path,
        async write(data) {
          if (t.failWith) throw new Error(`disk ${t.path}`);
          fx.write(t.path, data);
        },
      };
    },
  };
}

class SpyCache implements ProjectReadCache {
  readonly items = new Map<string, ProjectRecord>();
  readonly ops: string[] = [];
  async get(id: string) {
    this.ops.push("get");
    return this.items.get(id) ?? null;
  }
  async put(r: ProjectRecord) {
    this.ops.push("put");
    this.items.set(r.id, r);
  }
  async delete(id: string) {
    this.ops.push("delete");
    this.items.delete(id);
  }
  async clear() {
    this.ops.push("clear");
    this.items.clear();
  }
}

function setup(cache: ProjectReadCache | null = new SpyCache()) {
  const server = createCloudServer();
  const files = createFileFixture();
  const adapters = createWebAdapters({ fetch: server.fetch, cache, files: fixtureHost(files) });
  return { server, files, adapters, cache };
}

const input = (n: number, patch: Partial<SaveProjectInput> = {}): SaveProjectInput => ({
  id: testProjectId(n),
  name: `p${n}`,
  schemaVersion: 1,
  engineVersion: "0.1.0",
  designModel: JSON.stringify({ n }),
  expectedVersion: null,
  ...patch,
});

runAdapterContract("web", () => {
  const { adapters, files } = setup();
  return { adapters, files };
});

test("web: capabilities·updater 없음·license 없음·래스터화 없음", () => {
  const { adapters } = setup();
  assert.equal(adapters.capabilities, WEB_CAPABILITIES);
  assert.equal(adapters.updater, null);
  assert.equal(adapters.entitlement.license, null);
  assert.equal(adapters.rasterizer, undefined);
});

test("web: 저장 순서 upload-url → 서명 PUT → POST, Bearer는 메모리 세션에서, 서명 URL엔 인증 없음", async () => {
  const { adapters, server } = setup();
  await adapters.secrets.set("auth.session", JSON.stringify({ access_token: TOKEN, refresh_token: "r" }));
  await adapters.projects.save(input(1));
  const seq = server.calls.map((c) => `${c.method} ${new URL(c.url, "https://app.test").pathname}`);
  assert.deepEqual(seq, [`POST /api/cloud-projects/${testProjectId(1)}/upload-url`, "PUT /upload/1", "POST /api/cloud-projects"]);
  assert.equal(server.calls[0]!.auth, `Bearer ${TOKEN}`);
  assert.equal(server.calls[1]!.auth, null);
  assert.equal(JSON.parse(server.calls[2]!.body as string).expected_version, 0);
});

test("web: 409 AR041은 VERSION_CONFLICT(서버 문구·버전 값 없음)", async () => {
  const { adapters } = setup();
  await adapters.projects.save(input(1));
  await adapters.projects.save(input(1, { expectedVersion: 1 }));
  const e = await adapters.projects.save(input(1, { expectedVersion: 1 })).catch((x: unknown) => x);
  assert.ok(e instanceof BridgeError && e.code === "VERSION_CONFLICT");
  assert.ok(!errorSurface(e).includes("고정 문구"));
});

test("web: 읽기 캐시만 — save는 캐시를 읽지 않고 올리는 바이트는 입력에서만", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1));
  // 캐시에 서버와 다른 '편집 중' 내용이 있어도 저장은 그것을 올리지 않는다.
  const opened = (await adapters.projects.open(testProjectId(1)))!;
  cache.items.set(opened.id, { ...opened, designModel: JSON.stringify({ edit: LEAK }), name: LEAK });
  cache.ops.length = 0;
  await adapters.projects.save(input(1, { expectedVersion: 1 }));
  assert.deepEqual(cache.ops, ["put"], "save가 캐시를 읽음");
  for (const c of server.calls) assert.ok(!String(c.body instanceof Uint8Array ? new TextDecoder().decode(c.body) : c.body).includes(LEAK));
  for (const blob of server.storage.values()) assert.ok(!new TextDecoder().decode(blob).includes(LEAK));
});

test("web: 열기는 같은 version이면 캐시, 다르면 내려받아 캐시 갱신", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1));
  const downloads = () => server.calls.filter((c) => c.url.includes("/download/")).length;
  await adapters.projects.open(testProjectId(1));
  assert.equal(downloads(), 0, "방금 저장한 리비전은 캐시에서");
  cache.items.clear();
  const r = await adapters.projects.open(testProjectId(1));
  assert.equal(downloads(), 1);
  assert.equal(r?.designModel, input(1).designModel);
  assert.equal(cache.items.get(testProjectId(1))?.version, 1);
});

test("web: 로그아웃(clearSecrets)은 비밀과 읽기 캐시를 모두 지운다(IndexedDB 구현 포함)", async () => {
  const idb = createFakeIdb();
  const { adapters } = setup(new IdbProjectCache(idb.factory));
  await adapters.secrets.set("auth.session", TOKEN);
  await adapters.projects.save(input(1));
  assert.equal(idb.size(), 1);
  await adapters.clearSecrets();
  assert.equal(idb.size(), 0);
  assert.equal(await adapters.secrets.get("auth.session"), null);
});

test("web: 캐시 삭제가 실패해도 비밀은 지우고 오류를 알린다", async () => {
  const cache = new SpyCache();
  cache.clear = async () => {
    throw new Error("idb");
  };
  const { adapters } = setup(cache);
  await adapters.secrets.set("auth.session", TOKEN);
  await assert.rejects(adapters.clearSecrets());
  assert.equal(await adapters.secrets.get("auth.session"), null);
});

test("web: 전체 흐름에서 localStorage·sessionStorage·indexedDB 전역 접근 0건", async () => {
  const spy = spyWebStorage();
  try {
    const { adapters, files } = setup(new SpyCache());
    await adapters.secrets.set("auth.session", JSON.stringify({ access_token: TOKEN }));
    await adapters.projects.save(input(1));
    await adapters.projects.list();
    await adapters.projects.open(testProjectId(1));
    files.offerImport({ name: "a.dxf", size: 3 });
    await adapters.files.openImport("dxf");
    await adapters.entitlement.can("web_edit");
    await adapters.clearSecrets();
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.writes, []);
});

test("web: 가져오기 상한 초과는 arrayBuffer를 부르지 않고 AR055", async () => {
  let read = 0;
  const adapters = createWebAdapters({
    fetch: createCloudServer().fetch,
    cache: null,
    files: {
      pickOpen: async () => ({ name: "big.dxf", size: IMPORT_MAX_BYTES.dxf + 1, arrayBuffer: async () => (read++, new ArrayBuffer(0)) }),
      pickSave: async () => null,
    },
  });
  const e = await adapters.files.openImport("dxf").catch((x: unknown) => x);
  assert.ok(e instanceof BridgeError && e.code === "AR055");
  assert.equal(read, 0);
});

test("web: 스냅숏 메타 크기가 상한을 넘으면 내려받지 않는다", async () => {
  const server = createCloudServer();
  const base = server.fetch;
  const fetch: FetchFn = async (url, init) => {
    if (url.endsWith("/blob")) {
      server.calls.push({ method: "GET", url, auth: null, body: null });
      return new Response(JSON.stringify({ ok: true, data: { url: "https://storage.test/download/x", version: 1, bytes: SNAPSHOT_MAX_BYTES + 1 } }));
    }
    return base(url, init);
  };
  const adapters = createWebAdapters({ fetch, cache: null, files: fixtureHost(createFileFixture()) });
  await assert.rejects(adapters.projects.open(testProjectId(1)), (e: unknown) => e instanceof BridgeError && e.code === "PROJECT_UNAVAILABLE");
  assert.equal(server.calls.filter((c) => c.url.includes("/download/")).length, 0);
});

test("web: 목록은 커서를 끝까지 따라간다", async () => {
  const { adapters, server } = setup();
  for (const i of [1, 2, 3, 4, 5]) await adapters.projects.save(input(i));
  const list = await adapters.projects.list();
  assert.equal(list.length, 5);
  assert.equal(server.calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/cloud-projects")).length, 3);
});

test("web: 네트워크 실패는 PROJECT_UNAVAILABLE, 권한 판정은 offline(값 없음)", async () => {
  const { adapters, server } = setup();
  server.state.offline = true;
  const e = await adapters.projects.list().catch((x: unknown) => x);
  assert.ok(e instanceof BridgeError && e.code === "PROJECT_UNAVAILABLE");
  assert.ok(!errorSurface(e).includes(LEAK));
  assert.deepEqual(await adapters.entitlement.can("web_edit"), { allowed: false, reason: "offline" });
  assert.deepEqual(await adapters.entitlement.can("view_export"), { allowed: true });
});

test("web: 402(web_edit 없음) 저장은 AR061(읽기 전용)", async () => {
  const server = createCloudServer();
  const fetch: FetchFn = async (url, init) =>
    url.endsWith("/upload-url")
      ? new Response(JSON.stringify({ ok: false, error: { code: "entitlement_expired", details: { reason: "expired" } } }), { status: 402 })
      : server.fetch(url, init);
  const adapters = createWebAdapters({ fetch, cache: null, files: fixtureHost(createFileFixture()) });
  await assert.rejects(adapters.projects.save(input(1)), (e: unknown) => e instanceof BridgeError && e.code === "AR061");
});

test("web: 권한은 서버 rights, 거부 사유는 좌석·상태에서, 서버에 없는 권리는 unverified", async () => {
  const { adapters, server } = setup();
  server.state.entitlement = {
    state: "licensed_fallback",
    products: [{ kind: "perpetual", term_ends_at: null, updates_until: "2026-01-01" }],
    seat: { state: "assigned", seats_total: 1, seats_used: 1 },
    rights: { web_edit: false, desktop_edit: true, view_export: true, ai_render: true, cloud_review: false, devices_max: 2 },
    retention_until: null,
  };
  assert.deepEqual(await adapters.entitlement.can("desktop_edit"), { allowed: true });
  assert.deepEqual(await adapters.entitlement.can("web_edit"), { allowed: false, reason: "fallback" });
  assert.deepEqual(await adapters.entitlement.can("ai_chat"), { allowed: false, reason: "unverified" });
  assert.deepEqual(await adapters.entitlement.status(), { state: "active", offlineValidUntil: null });
  const gets = server.calls.filter((c) => c.url === "/api/entitlement").length;
  assert.equal(gets, 1, "세션 동안 한 번 조회");
  server.state.entitlement = { state: "subscribed", products: [], seat: { state: "revoked" }, rights: { web_edit: false } };
  await adapters.clearSecrets();
  assert.deepEqual(await adapters.entitlement.can("web_edit"), { allowed: false, reason: "seat_revoked" });
  assert.equal((await adapters.entitlement.status()).state, "revoked");
});

// ---- 최소 IndexedDB 흉내(IdbProjectCache가 쓰는 부분만) --------------------------------------------
function createFakeIdb() {
  const data = new Map<string, unknown>();
  const req = <T>(fn: () => T) => {
    const r: { result?: T; onsuccess?: () => void; onerror?: () => void } = {};
    queueMicrotask(() => {
      r.result = fn();
      r.onsuccess?.();
    });
    return r;
  };
  const store = {
    get: (k: string) => req(() => structuredClone(data.get(k))),
    put: (v: { id: string }) => req(() => void data.set(v.id, structuredClone(v))),
    delete: (k: string) => req(() => void data.delete(k)),
    clear: () => req(() => data.clear()),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
  };
  const factory = {
    open: () => {
      const r: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = {};
      queueMicrotask(() => {
        r.result = db;
        r.onupgradeneeded?.();
        r.onsuccess?.();
      });
      return r;
    },
  } as unknown as IDBFactory;
  return { factory, size: () => data.size };
}
