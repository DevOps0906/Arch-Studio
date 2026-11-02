// 웹 어댑터(AR-06-072): 계약 하네스(가짜 클라우드 API + 파일 fixture) + 웹 고유 보장
// (읽기 캐시만·편집 캐시 업로드 0, 캐시 범위 사용자·조직, 로그아웃 시 캐시 삭제·늦은 쓰기 차단, 영속 웹 스토리지 0,
// 읽기 전 크기 거부, 오류 코드 매핑). 가짜 서버는 073 서버(apps/web/src/server/cloud-projects)의 봉투·상태 코드를 흉내 낸다.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BridgeError, WEB_CAPABILITIES } from "../index.ts";
import type { SaveProjectInput } from "../adapters/project-store.ts";
import { IMPORT_MAX_BYTES } from "../adapters/file-gateway.ts";
import { createFileFixture, LEAK, runAdapterContract, testProjectId, type FileFixture } from "../testing/index.ts";
import { errorSurface, spyWebStorage, TOKEN } from "../test-helpers.ts";
import { createWebAdapters } from "./adapters.ts";
import type { WebFileHost } from "./file-gateway.ts";
import type { FetchFn } from "./http.ts";
import { IdbProjectCache, type CachedProject, type ProjectReadCache } from "./project-cache.ts";
import { SNAPSHOT_MAX_BYTES } from "./project-store.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");

interface Row {
  org: string;
  name: string;
  version: number;
  path: string;
  updatedAt: string;
}

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: Uint8Array | string | null;
}

/** 073 클라우드 API 흉내(조직별 행). `state`로 세션 조직·권한 응답·장애·내려받기 지연을 바꾼다. */
function createCloudServer() {
  const rows = new Map<string, Row>(); // key `${org}:${id}`
  const storage = new Map<string, Uint8Array>();
  const uploads = new Map<string, string>();
  const calls: Call[] = [];
  let tick = 0;
  let n = 0;
  const state = {
    org: ORG,
    entitlement: null as unknown,
    offline: false,
    pageSize: 2,
    /** 설정되면 내려받기 응답을 이 약속이 풀릴 때까지 미룬다. */
    holdDownload: null as Promise<void> | null,
    /** 경로별 응답 덮어쓰기(오류 매핑 시험). */
    override: null as ((path: string, method: string) => Response | null) | null,
  };
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
    const forced = state.override?.(url.pathname, method);
    if (forced) return forced;

    if (url.host === "storage.test") {
      if (method === "PUT") {
        const path = uploads.get(url.pathname);
        if (!path || !(body instanceof Uint8Array)) return new Response(null, { status: 400 });
        storage.set(path, body.slice());
        return new Response(null, { status: 200 });
      }
      if (state.holdDownload) await state.holdDownload;
      const bytes = storage.get(decodeURIComponent(url.pathname.slice("/download/".length)));
      return bytes ? new Response(bytes as BodyInit, { headers: { "content-length": String(bytes.byteLength) } }) : new Response(null, { status: 404 });
    }
    const req = typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {};
    const p = url.pathname;
    const org = state.org;
    if (p === "/api/entitlement") return state.entitlement ? json(200, state.entitlement) : err(500, "internal");
    if (p === "/api/cloud-projects" && method === "GET") {
      const all = [...rows.entries()].filter(([k]) => k.startsWith(`${org}:`)).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
      const start = Number(url.searchParams.get("cursor") ?? "0");
      const page = all.slice(start, start + state.pageSize);
      const next = start + state.pageSize < all.length ? String(start + state.pageSize) : null;
      return json(200, {
        items: page.map(([k, r]) => ({ project_uuid: k.slice(org.length + 1), local_id: null, name: r.name, version: r.version, bytes: 1, updated_at: r.updatedAt })),
        next,
        max: 100,
        retention_until: null,
      });
    }
    const m = /^\/api\/cloud-projects\/([^/]+)\/(upload-url|blob)$/.exec(p);
    if (m && m[2] === "upload-url" && method === "POST") {
      if (req.ext !== "arch" || typeof req.bytes !== "number" || typeof req.sha256 !== "string") return err(422, "invalid_input");
      const key = `/upload/${++n}`;
      const path = `${org}/arch/project_snapshot/${m[1]}/${n}.arch`;
      uploads.set(key, path);
      return json(200, { signed_upload_url: `https://storage.test${key}`, path, expires_at: "2026-11-02T00:00:00Z" });
    }
    if (p === "/api/cloud-projects" && method === "POST") {
      const id = String(req.project_uuid);
      const expected = Number(req.expected_version);
      const row = rows.get(`${org}:${id}`);
      if (!storage.has(String(req.storage_path))) return err(422, "23514");
      // 계약(ProjectStore): 없는 행에 expected ≥ 1은 NOT_FOUND. 실제 RPC는 AR041(로그 참조).
      if (!row && expected > 0) return err(404, "not_found");
      if (row && row.version !== expected) return err(409, "AR041", { current_version: row.version });
      rows.set(`${org}:${id}`, {
        org,
        name: String(req.name),
        version: expected + 1,
        path: String(req.storage_path),
        updatedAt: new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString(),
      });
      return json(200, { project_uuid: id, version: expected + 1 });
    }
    if (m && m[2] === "blob" && method === "GET") {
      const row = rows.get(`${org}:${m[1]}`);
      if (!row) return err(404, "not_found");
      const bytes = storage.get(row.path)!;
      return json(200, { url: `https://storage.test/download/${encodeURIComponent(row.path)}`, org_id: org, version: row.version, bytes: bytes.byteLength, sha256: sha(bytes) });
    }
    // 라우트 없음(Next 기본 404: 봉투 없음).
    return new Response("Not Found", { status: 404 });
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
  readonly items = new Map<string, CachedProject>();
  readonly ops: string[] = [];
  async get(key: string) {
    this.ops.push("get");
    return this.items.get(key) ?? null;
  }
  async put(key: string, e: CachedProject) {
    this.ops.push("put");
    this.items.set(key, e);
  }
  async delete(key: string) {
    this.ops.push("delete");
    this.items.delete(key);
  }
  async clear() {
    this.ops.push("clear");
    this.items.clear();
  }
}

function setup(cache: ProjectReadCache | null = new SpyCache()) {
  const server = createCloudServer();
  const files = createFileFixture();
  const adapters = createWebAdapters({ fetch: server.fetch, cache, files: fixtureHost(files), userId: async () => USER });
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

const isCode = (code: string) => (e: unknown) => e instanceof BridgeError && e.code === code;
const downloads = (server: ReturnType<typeof createCloudServer>) => server.calls.filter((c) => c.url.includes("/download/")).length;

runAdapterContract("web", () => {
  const { adapters, files } = setup();
  return { adapters, files, projectDelete: false, projectNameMax: 120 };
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

test("web: 이름은 trim해서 보내고, 120자 초과·제어 문자는 네트워크 전에 INVALID_INPUT", async () => {
  const { adapters, server } = setup();
  await adapters.projects.save(input(1, { name: "  공백 이름  " }));
  assert.equal(JSON.parse(server.calls[2]!.body as string).name, "공백 이름");
  const snap = new TextDecoder().decode([...server.storage.values()][0]);
  assert.equal(JSON.parse(snap).project.name, "공백 이름");
  server.calls.length = 0;
  await assert.rejects(adapters.projects.save(input(2, { name: "가".repeat(121) })), isCode("INVALID_INPUT"));
  await assert.rejects(adapters.projects.save(input(2, { name: "a\u0007b" })), isCode("INVALID_INPUT"));
  assert.equal(server.calls.length, 0);
});

test("web: 오류 매핑 — AR041·23505·AR040·AR031·401·429·402·라우트 없음 404", async () => {
  const cases: [number, string | null, string][] = [
    [409, "AR041", "VERSION_CONFLICT"],
    [409, "23505", "ALREADY_EXISTS"],
    [403, "AR040", "QUOTA_EXCEEDED"],
    [413, "AR031", "TOO_LARGE"],
    [401, "unauthorized", "UNAUTHENTICATED"],
    [429, "rate_limited", "RATE_LIMITED"],
    [402, "entitlement_expired", "AR061"],
    [404, null, "PROJECT_UNAVAILABLE"],
  ];
  for (const [status, code, want] of cases) {
    const { adapters, server } = setup();
    server.state.override = (path) =>
      path.endsWith("/upload-url")
        ? new Response(code ? JSON.stringify({ ok: false, error: { code, message: `고정 ${LEAK}` } }) : "Not Found", { status })
        : null;
    const e = await adapters.projects.save(input(1)).catch((x: unknown) => x);
    assert.ok(e instanceof BridgeError && e.code === want, `${status} ${code} → ${String(e)}`);
    assert.ok(!errorSurface(e).includes(LEAK));
  }
});

test("web: 열기 — 봉투 not_found만 null, 라우트 없음 404는 PROJECT_UNAVAILABLE", async () => {
  const { adapters, server } = setup();
  assert.equal(await adapters.projects.open(testProjectId(9)), null);
  server.state.override = (path) => (path.endsWith("/blob") ? new Response("Not Found", { status: 404 }) : null);
  await assert.rejects(adapters.projects.open(testProjectId(9)), isCode("PROJECT_UNAVAILABLE"));
});

test("web: 삭제는 NOT_SUPPORTED(서버 호출 없음)", async () => {
  const { adapters, server } = setup();
  await assert.rejects(adapters.projects.delete(testProjectId(1), 1), isCode("NOT_SUPPORTED"));
  assert.equal(server.calls.length, 0);
});

test("web: 읽기 캐시만 — save는 캐시를 읽지 않고 올리는 바이트는 입력에서만", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1));
  const key = `${USER}:${ORG}:${testProjectId(1)}`;
  const entry = cache.items.get(key)!;
  // 캐시에 서버와 다른 '편집 중' 내용이 있어도 저장은 그것을 올리지 않는다.
  cache.items.set(key, { ...entry, record: { ...entry.record, designModel: JSON.stringify({ edit: LEAK }), name: LEAK } });
  cache.ops.length = 0;
  await adapters.projects.save(input(1, { expectedVersion: 1 }));
  assert.deepEqual(cache.ops, ["put"], "save가 캐시를 읽음");
  for (const c of server.calls) assert.ok(!String(c.body instanceof Uint8Array ? new TextDecoder().decode(c.body) : c.body).includes(LEAK));
  for (const blob of server.storage.values()) assert.ok(!new TextDecoder().decode(blob).includes(LEAK));
});

test("web: 캐시 적중은 version과 서버 sha256이 둘 다 같을 때만", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1));
  await adapters.projects.open(testProjectId(1));
  assert.equal(downloads(server), 0, "방금 저장한 리비전은 캐시에서");
  const key = `${USER}:${ORG}:${testProjectId(1)}`;
  cache.items.set(key, { ...cache.items.get(key)!, blobSha256: "0".repeat(64) });
  const r = await adapters.projects.open(testProjectId(1));
  assert.equal(downloads(server), 1, "sha256 불일치면 내려받기");
  assert.equal(r?.designModel, input(1).designModel);
  assert.notEqual(cache.items.get(key)?.blobSha256, "0".repeat(64));
});

test("web: 조직이 바뀌면 이전 범위 캐시를 비우고 다른 조직 항목으로 적중하지 않는다", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1, { designModel: JSON.stringify({ org: "A" }) }));
  assert.ok(cache.items.has(`${USER}:${ORG}:${testProjectId(1)}`));
  // 같은 project_uuid가 조직 B에도 있다(다른 내용).
  server.state.org = ORG_B;
  await adapters.projects.save(input(1, { designModel: JSON.stringify({ org: "B" }) }));
  assert.equal(cache.items.has(`${USER}:${ORG}:${testProjectId(1)}`), false, "조직 A 캐시가 남음");
  const before = downloads(server);
  const r = await adapters.projects.open(testProjectId(1));
  assert.equal(r?.designModel, JSON.stringify({ org: "B" }));
  assert.equal(downloads(server), before, "B 리비전은 B 범위 캐시에서");
  assert.deepEqual([...cache.items.keys()], [`${USER}:${ORG_B}:${testProjectId(1)}`]);
});

test("web: 사용자 id를 모르면 캐시를 쓰지 않는다", async () => {
  const server = createCloudServer();
  const cache = new SpyCache();
  const adapters = createWebAdapters({ fetch: server.fetch, cache, files: fixtureHost(createFileFixture()) });
  await adapters.projects.save(input(1));
  await adapters.projects.open(testProjectId(1));
  assert.equal(cache.items.size, 0);
  assert.equal(downloads(server), 1);
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

test("web: 내려받기 중 로그아웃하면 늦게 끝난 열기가 캐시를 되살리지 않는다", async () => {
  const cache = new SpyCache();
  const { adapters, server } = setup(cache);
  await adapters.projects.save(input(1));
  cache.items.clear();
  let release!: () => void;
  server.state.holdDownload = new Promise<void>((r) => (release = r));
  const opening = adapters.projects.open(testProjectId(1));
  while (!server.calls.some((c) => c.url.includes("/download/"))) await new Promise((r) => setImmediate(r));
  await adapters.clearSecrets();
  release();
  await opening;
  assert.equal(cache.items.size, 0, "로그아웃 뒤 캐시에 다시 씀");
  // 로그아웃 뒤 createdAt도 비워져 다음 저장은 서버에서 다시 읽는다.
  server.state.holdDownload = null;
  server.calls.length = 0;
  await adapters.projects.save(input(1, { expectedVersion: 1 }));
  assert.ok(server.calls.some((c) => c.url.endsWith("/blob")));
});

test("web: 저장 중 로그아웃해도 캐시에 쓰지 않는다", async () => {
  const cache = new SpyCache();
  const server = createCloudServer();
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const base = server.fetch;
  const slow = createWebAdapters({
    fetch: async (url, init) => {
      if (url === "/api/cloud-projects" && init?.method === "POST") await hold;
      return base(url, init);
    },
    cache,
    files: fixtureHost(createFileFixture()),
    userId: async () => USER,
  });
  const saving = slow.projects.save(input(1));
  while (!server.calls.some((c) => c.method === "PUT")) await new Promise((r) => setImmediate(r));
  await slow.clearSecrets();
  release();
  await saving;
  assert.equal(cache.items.size, 0);
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
    await adapters.secrets.set("auth.session", JSON.stringify({ access_token: TOKEN, user: { id: USER } }));
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
  await assert.rejects(adapters.files.openImport("dxf"), isCode("AR055"));
  assert.equal(read, 0);
});

const blobMeta = (patch: Record<string, unknown>) =>
  new Response(
    JSON.stringify({ ok: true, data: { url: "https://storage.test/download/x", org_id: ORG, version: 1, bytes: 10, sha256: "a".repeat(64), ...patch } }),
  );

test("web: 스냅숏 메타 — 상한 초과·sha256 없음은 내려받지 않는다", async () => {
  for (const patch of [{ bytes: SNAPSHOT_MAX_BYTES + 1 }, { sha256: undefined }, { sha256: "XYZ" }, { org_id: "x" }]) {
    const { adapters, server } = setup();
    server.state.override = (path) => (path.endsWith("/blob") ? blobMeta(patch) : null);
    await assert.rejects(adapters.projects.open(testProjectId(1)), isCode("PROJECT_UNAVAILABLE"));
    assert.equal(downloads(server), 0);
  }
});

test("web: 내려받기는 누적 길이가 meta.bytes를 넘는 순간 중단(content-length 없어도)", async () => {
  const { adapters, server } = setup();
  let pulled = 0;
  server.state.override = (path) => {
    if (path.endsWith("/blob")) return blobMeta({ bytes: 10 });
    if (path.startsWith("/download/")) {
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          pulled++;
          if (pulled > 100) c.close();
          else c.enqueue(new Uint8Array(8));
        },
      });
      return new Response(stream);
    }
    return null;
  };
  await assert.rejects(adapters.projects.open(testProjectId(1)), isCode("PROJECT_UNAVAILABLE"));
  assert.ok(pulled <= 3, `너무 많이 읽음: ${pulled}`);
});

test("web: 바이트 길이 불일치·sha256 불일치는 PROJECT_UNAVAILABLE", async () => {
  const { adapters, server } = setup(null);
  await adapters.projects.save(input(1));
  const real = [...server.storage.values()][0]!;
  for (const patch of [{ bytes: real.byteLength + 1, sha256: sha(real) }, { bytes: real.byteLength, sha256: "b".repeat(64) }]) {
    server.state.override = (path) =>
      path.endsWith("/blob") ? blobMeta({ ...patch, url: `https://storage.test/download/${encodeURIComponent([...server.storage.keys()][0]!)}` }) : null;
    await assert.rejects(adapters.projects.open(testProjectId(1)), isCode("PROJECT_UNAVAILABLE"));
  }
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
  assert.equal(server.calls.filter((c) => c.url === "/api/entitlement").length, 1, "세션 동안 한 번 조회");
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
    put: (v: unknown, k: string) => req(() => void data.set(k, structuredClone(v))),
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
