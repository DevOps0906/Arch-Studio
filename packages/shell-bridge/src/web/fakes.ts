// 웹 어댑터 테스트용 가짜 서버·가짜 IDB 팩토리. *.test.ts에서만 import한다(릴리스 번들에 안 들어감: index에서 내보내지 않음).

export const BASE = "https://app.test";
export const STORAGE = "https://storage.test";
/** 서명 없는 JWT 모양 토큰(sub·org_id 클레임만). */
export function fakeJwt(sub: string, org = "org-1"): string {
  const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b({ alg: "none" })}.${b({ sub, app_metadata: { org_id: org } })}.sig`;
}

export const ORG ="00000000-0000-4000-8000-0000000000aa";

export interface FakeCall {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string | null;
}

export interface FakeRow {
  version: number;
  name: string;
  path: string;
  /** 설치형에서 올린 사본이면 로컬 id(AR-06-077). */
  localId?: string | null;
}

export interface FakeCloudOptions {
  pageSize?: number;
  rights?: Record<string, boolean>;
  seat?: string;
  products?: { kind: string; term_ends_at: string | null }[];
}

export interface FakeCloud {
  readonly fetch: typeof fetch;
  readonly calls: FakeCall[];
  readonly rows: Map<string, FakeRow>;
  readonly blobs: Map<string, Uint8Array>;
  online: boolean;
  /** true면 모든 API 요청에 401(만료된 세션). */
  rejectAuth: boolean;
  /** 설정하면 API 응답이 이 Promise가 끝날 때까지 대기(진행 중 요청 중 로그아웃 경합 재현). */
  gate: Promise<void> | null;
  /** 올바른 Bearer 토큰(다르면 401). */
  token: string;
  rights: Record<string, boolean>;
  seat: string;
  products: { kind: string; term_ends_at: string | null }[];
  /** 설정하면 upload-url이 이 폴더로 서명한다(잘못된 서명기 재현: 예 local_id 폴더). */
  signFolder: string | null;
  /** 다른 사람이 먼저 저장한 것처럼 서버 version을 올린다. */
  bump(id: string): void;
  mutating(): FakeCall[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (data: unknown) => json(200, { ok: true, data });
const err = (status: number, code: string) => json(status, { ok: false, error: { code, message: "x" } });

export function createFakeCloud(opts: FakeCloudOptions = {}): FakeCloud {
  const calls: FakeCall[] = [];
  const rows = new Map<string, FakeRow>();
  const blobs = new Map<string, Uint8Array>();
  const state: FakeCloud = {
    calls,
    rows,
    blobs,
    online: true,
    rejectAuth: false,
    gate: null,
    signFolder: null,
    token: fakeJwt("user-a"),
    rights: opts.rights ?? { view_export: true, desktop_edit: true, web_edit: true, ai_render: true, cloud_review: true },
    seat: opts.seat ?? "assigned",
    products: opts.products ?? [{ kind: "sub", term_ends_at: null }],
    bump(id) {
      const r = rows.get(id);
      if (r) r.version += 1;
    },
    mutating: () => calls.filter((c) => c.method !== "GET"),
    fetch: (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : init?.body ? "<binary>" : null;
      calls.push({ method, url: input, authorization: headers.get("authorization"), body });
      if (!state.online) throw new TypeError("network");

      if (url.origin === STORAGE) {
        const key = url.pathname.slice(4); // /up/<path> 또는 /dl/<path>
        if (url.pathname.startsWith("/up/") && method === "PUT") {
          blobs.set(decodeURIComponent(key), new Uint8Array(init?.body as Uint8Array));
          return new Response(null, { status: 200 });
        }
        const data = blobs.get(decodeURIComponent(key));
        return url.pathname.startsWith("/dl/") && data ? new Response(data.slice()) : new Response(null, { status: 404 });
      }

      if (state.gate) await state.gate;
      if (state.rejectAuth || !headers.get("authorization")?.startsWith("Bearer ")) return err(401, "unauthorized");
      const p = url.pathname;
      if (p === "/api/entitlement") {
        return ok({ products: state.products, seat: { state: state.seat }, rights: state.rights });
      }
      if (p === "/api/cloud-projects" && method === "GET") {
        const size = opts.pageSize ?? 50;
        const all = [...rows.entries()];
        const from = Number(url.searchParams.get("cursor") ?? 0);
        const page = all.slice(from, from + size);
        return ok({
          items: page.map(([id, r]) => ({ project_uuid: id, local_id: r.localId ?? null, name: r.name, version: r.version, bytes: 1, updated_at: "2026-11-02T00:00:00Z" })),
          next: from + size < all.length ? String(from + size) : null,
          max: 3,
          retention_until: null,
        });
      }
      if (p === "/api/cloud-projects" && method === "POST") {
        const b = JSON.parse(body ?? "{}") as {
          project_uuid: string;
          local_id?: string;
          name: string;
          storage_path: string;
          expected_version: number;
        };
        // 서버 isOwnSnapshotPath: 프로젝트 폴더 = project_uuid(local_id 폴더면 422 23514).
        if (!b.storage_path.startsWith(`${ORG}/arch/project_snapshot/${b.project_uuid}/`)) return err(422, "23514");
        const row = rows.get(b.project_uuid);
        if ((row?.version ?? 0) !== b.expected_version) return err(409, "AR041");
        if (!blobs.has(b.storage_path)) return err(422, "23514");
        // arch.save_cloud_project: local_id는 조직 안에서 유일(23505), 기존 행의 다른 값으로 바꾸기는 22023.
        if (b.local_id !== undefined) {
          if (row?.localId && row.localId !== b.local_id) return err(422, "22023");
          if ([...rows.entries()].some(([k, r]) => k !== b.project_uuid && r.localId === b.local_id)) return err(409, "23505");
        }
        const version = b.expected_version + 1;
        rows.set(b.project_uuid, { version, name: b.name, path: b.storage_path, localId: row?.localId ?? b.local_id ?? null });
        return ok({ project_uuid: b.project_uuid, version });
      }
      const m = /^\/api\/cloud-projects\/([^/]+)(\/upload-url|\/blob)?$/.exec(p);
      if (m) {
        const id = m[1] as string;
        if (m[2] === "/upload-url" && method === "POST") {
          const path = `${ORG}/arch/project_snapshot/${state.signFolder ?? id}/${crypto.randomUUID()}.arch`;
          return ok({ signed_upload_url: `${STORAGE}/up/${encodeURIComponent(path)}`, path, expires_at: "2026-11-02T01:00:00Z" });
        }
        const row = rows.get(id);
        if (m[2] === "/blob" && method === "GET") {
          if (!row) return err(404, "not_found");
          return ok({
            url: `${STORAGE}/dl/${encodeURIComponent(row.path)}`,
            version: row.version,
            bytes: blobs.get(row.path)?.byteLength ?? 0,
            schema_version: 1,
          });
        }
        if (!m[2] && method === "DELETE") {
          if (!row) return err(404, "not_found");
          const expected = url.searchParams.get("expected_version");
          if (expected !== null && Number(expected) !== row.version) return err(409, "AR041");
          rows.delete(id);
          blobs.delete(row.path);
          return ok({ project_uuid: id, deleted: true });
        }
      }
      return err(404, "not_found");
    }) as typeof fetch,
  };
  return state;
}

/** IDBFactory의 쓰는 부분만 흉내(open·transaction·get/put/delete/clear). `failClear`면 clear가 실패. */
export function createFakeIdb(): { factory: IDBFactory; data: Map<string, unknown>; failClear: boolean; writes: number } {
  const data = new Map<string, unknown>();
  const state = { factory: null as unknown as IDBFactory, data, failClear: false, writes: 0 };
  const later = (fn: () => void) => queueMicrotask(fn);
  const request = (run: () => unknown, tx: { oncomplete: (() => void) | null; onerror: (() => void) | null }, fail = false) => {
    const req = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
    later(() => {
      if (fail) {
        req.onerror?.();
        tx.onerror?.();
        return;
      }
      req.result = run();
      req.onsuccess?.();
      later(() => tx.oncomplete?.());
    });
    return req;
  };
  const db = () => ({
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, objectStore: () => store };
      const store = {
        get: (k: string) => request(() => data.get(k), tx),
        put: (v: unknown, k: string) => request(() => (state.writes++, data.set(k, structuredClone(v)), k), tx),
        delete: (k: string) => request(() => (data.delete(k), undefined), tx),
        clear: () => request(() => (data.clear(), undefined), tx, state.failClear),
      };
      return tx;
    },
  });
  state.factory = {
    open: () => {
      const req = { result: db(), onupgradeneeded: null as (() => void) | null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      later(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return state;
}
