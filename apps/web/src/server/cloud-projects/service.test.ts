// 클라우드 사본 API(목 저장소): 입력 strict·본문 상한·AR040·AR041(저장 안 됨)·조직 격리·402 예외·로그 가리기·upload-url 별칭.
// 목 저장소는 arch.save_cloud_project(04_API 3장 새 시그니처) 규칙을 그대로 흉내 낸다: 새 사본 expected 0 + 상한, 기존은 version 일치만.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { CloudApiError, CloudDbError, mapCloudDbError } from "./errors.ts";
import { sanitizeCloudLog } from "./log.ts";
import {
  handleCloudUploadUrl,
  handleListCloudProjects,
  handleSaveCloudProject,
  isOwnSnapshotPath,
  SAVE_MAX_BODY,
  SNAPSHOT_MAX_BYTES,
  type CloudDeps,
  type CloudProjectRepo,
  type CloudProjectRow,
  type SaveCloudProjectArgs,
} from "./service.ts";
import { decodeCursor, encodeCursor, toCloudDbError } from "./supabase-repo.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const LOCAL = "0192f0a0-1c00-7a01-8a01-000000000001";
const OBJ = "99999999-9999-4999-8999-999999999999";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const TOKEN = "user-access-token-value-0123456789";
const SECRET_NAME = "기밀 프로젝트 홍길동 주택";
const pathFor = (org: string, folder: string) => `${org}/arch/project_snapshot/${folder}/${OBJ}.arch`;

interface World {
  session: GatewaySession | GatewayError;
  rows: Map<string, CloudProjectRow>;
  max: number;
  objects: Map<string, number>;
  saves: SaveCloudProjectArgs[];
  signed: Request[];
  webEdit?: "allowed" | "fallback" | "denied";
  /** 저장소 이상 동작 흉내. */
  saveOverride?: (args: SaveCloudProjectArgs) => Promise<{ project_uuid: string; version: number; previous_path?: string | null }>;
  leakRows?: CloudProjectRow[];
  removed: string[];
  removeFails?: boolean;
}

function row(org: string, uuid: string, version: number, over: Partial<CloudProjectRow> = {}): CloudProjectRow {
  return { org_id: org, project_uuid: uuid, local_id: null, name: "사본", version, bytes: 1000, updated_at: "2026-10-28T00:00:00.000Z", ...over };
}

function world(over: Partial<World> = {}): World {
  const w: World = {
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: TOKEN },
    rows: new Map(),
    max: 3,
    objects: new Map([[pathFor(ORG, P1), 5000], [pathFor(ORG, P2), 5000], [pathFor(ORG, LOCAL), 5000]]),
    saves: [],
    signed: [],
    removed: [],
    ...over,
  };
  return w;
}

/** arch.save_cloud_project 규칙(04_API 3장)을 따르는 메모리 저장소. 조직은 인자로만(세션 조직). */
function fakeRepo(w: World): CloudProjectRepo {
  return {
    async list(orgId) {
      const rows = [...w.rows.values()].filter((r) => r.org_id === orgId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return { rows: [...rows, ...(w.leakRows ?? [])], next: null };
    },
    async usage(orgId) {
      return { count: [...w.rows.values()].filter((r) => r.org_id === orgId).length, max: w.max, retentionUntil: null };
    },
    async find(orgId, uuid) {
      const r = w.rows.get(`${orgId}:${uuid}`);
      return r ? { version: r.version } : null;
    },
    async save(args) {
      w.saves.push(args);
      if (w.saveOverride) return w.saveOverride(args);
      const key = `${args.orgId}:${args.projectUuid}`;
      const cur = w.rows.get(key);
      if (!cur) {
        if (args.expectedVersion !== 0) throw new CloudDbError("AR041", { currentVersion: 0 });
        const count = [...w.rows.values()].filter((r) => r.org_id === args.orgId).length;
        if (count >= w.max) throw new CloudDbError("AR040", { max: w.max });
        w.rows.set(key, row(args.orgId, args.projectUuid, 1, { name: args.name, local_id: args.localId }));
        return { project_uuid: args.projectUuid, version: 1 };
      }
      if (cur.version !== args.expectedVersion) throw new CloudDbError("AR041", { currentVersion: cur.version });
      w.rows.set(key, { ...cur, name: args.name, version: cur.version + 1 });
      return { project_uuid: args.projectUuid, version: cur.version + 1 };
    },
  };
}

function deps(w: World, rate = new MemoryRateLimitStore()): CloudDeps {
  return {
    ...(w.webEdit ? { webEdit: async () => w.webEdit as "allowed" | "fallback" | "denied" } : {}),
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    repo: () => fakeRepo(w),
    snapshots: () => ({
      inspect: async (p) => (w.objects.has(p) ? { bytes: w.objects.get(p) as number } : null),
      remove: async (p) => {
        if (w.removeFails) throw new Error(`remove failed ${p}`);
        w.removed.push(p);
      },
    }),
    signUpload: async (req) => {
      w.signed.push(req);
      return new Response(JSON.stringify({ ok: true, data: { signed_upload_url: "https://x/sign", path: "p", expires_at: "t" } }), { status: 200 });
    },
    rateLimit: rate,
    now: () => NOW,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
type Json = Record<string, any>;
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function save(w: World, body: unknown, rate?: MemoryRateLimitStore) {
  const res = await handleSaveCloudProject(
    new Request("https://web.example/api/cloud-projects", { method: "POST", headers: H, body: typeof body === "string" ? body : JSON.stringify(body) }),
    deps(w, rate),
  );
  return { status: res.status, json: (await res.json()) as Json, raw: res };
}

async function list(w: World, qs = "") {
  const res = await handleListCloudProjects(new Request(`https://web.example/api/cloud-projects${qs}`, { headers: H }), deps(w));
  return { status: res.status, json: (await res.json()) as Json };
}

async function uploadUrl(w: World, id: string, body: unknown) {
  const res = await handleCloudUploadUrl(
    new Request(`https://web.example/api/cloud-projects/${id}/upload-url`, { method: "POST", headers: H, body: JSON.stringify(body) }),
    id,
    deps(w),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

function spy(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

const newBody = (over: Record<string, unknown> = {}) => ({ project_uuid: P1, name: SECRET_NAME, storage_path: pathFor(ORG, P1), expected_version: 0, ...over });

test("저장: 새 사본 expected_version 0 → v1, 같은 expected로 다시 보내면 AR041(409)·저장 안 됨", async () => {
  const w = world();
  const first = await save(w, newBody());
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { ok: true, data: { project_uuid: P1, version: 1 } });
  const again = await save(w, newBody());
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "AR041");
  assert.equal(again.json.error.details.current_version, 1);
  assert.equal(w.rows.get(`${ORG}:${P1}`)?.version, 1, "충돌이면 버전이 그대로");
});

test("저장: 기존 사본은 expected_version 일치일 때만 version+1, 낡은 버전은 AR041로 거절되고 이름·버전이 바뀌지 않는다", async () => {
  const w = world();
  w.rows.set(`${ORG}:${P1}`, row(ORG, P1, 3, { name: "원래 이름" }));
  const stale = await save(w, newBody({ expected_version: 2, name: "내 변경" }));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "AR041");
  assert.equal(stale.json.error.details.current_version, 3);
  assert.equal(w.rows.get(`${ORG}:${P1}`)?.name, "원래 이름");
  assert.equal(w.rows.get(`${ORG}:${P1}`)?.version, 3);
  const ok = await save(w, newBody({ expected_version: 3, name: "새 이름" }));
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.version, 4);
  // 충돌 대화상자 "내 변경을 사본으로 저장" = 새 project_uuid + expected 0 → 새 행.
  const copy = await save(w, newBody({ project_uuid: P2, storage_path: pathFor(ORG, P2), name: "새 이름 (내 변경)" }));
  assert.equal(copy.status, 200);
  assert.equal(copy.json.data.version, 1);
  // "서버 최신 열기" = GET 목록의 최신 version.
  const l = await list(w);
  assert.deepEqual(
    l.json.data.items.map((i: Json) => [i.project_uuid, i.version]).sort(),
    [
      [P1, 4],
      [P2, 1],
    ],
  );
});

test("저장: 조직 상한에 닿으면 새 사본은 AR040(403, max)·저장 안 됨, 기존 사본 갱신은 된다", async () => {
  const w = world({ max: 1 });
  w.rows.set(`${ORG}:${P1}`, row(ORG, P1, 1));
  const r = await save(w, newBody({ project_uuid: P2, storage_path: pathFor(ORG, P2) }));
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "AR040");
  assert.equal(r.json.error.details.max, 1);
  assert.equal(w.rows.size, 1);
  assert.equal((await save(w, newBody({ expected_version: 1 }))).status, 200);
});

test("저장: 입력 strict — org_id·모르는 키·이름 공백/121자/줄바꿈·음수 버전·uuid 아님은 422, 저장소 호출 0", async () => {
  const w = world();
  for (const body of [
    newBody({ org_id: OTHER_ORG }),
    newBody({ user_id: USER }),
    newBody({ extra: 1 }),
    newBody({ name: "   " }),
    newBody({ name: "가".repeat(121) }),
    newBody({ name: "줄\n바꿈" }),
    newBody({ expected_version: -1 }),
    newBody({ expected_version: 1.5 }),
    newBody({ project_uuid: "not-a-uuid" }),
    newBody({ local_id: "../x" }),
  ]) {
    const r = await save(w, body);
    assert.equal(r.status, 422, JSON.stringify(Object.keys(body)));
    assert.equal(r.json.error.code, "invalid_input");
  }
  assert.equal((await save(w, "{")).status, 400);
  assert.equal(w.saves.length, 0);
});

test("저장: 본문 상한(4KB) 초과 413, 저장소 호출 0", async () => {
  const w = world();
  const r = await save(w, newBody({ name: "가".repeat(SAVE_MAX_BODY) }));
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "payload_too_large");
  assert.equal(w.saves.length, 0);
});

test("저장: 업로드 경로 — 다른 조직 폴더·다른 프로젝트 폴더·서버 형식 밖·없는 객체는 23514(422), 상한 초과 객체는 AR031(413)", async () => {
  const w = world();
  const cases: [Record<string, unknown>, number, string][] = [
    [{ storage_path: pathFor(OTHER_ORG, P1) }, 422, "23514"],
    [{ storage_path: pathFor(ORG, P2) }, 422, "23514"],
    [{ storage_path: `${ORG}/arch/project_snapshot/${P1}/../${OBJ}.arch` }, 422, "23514"],
    [{ storage_path: `${ORG}/arch/render_input/${OBJ}.png` }, 422, "23514"],
    [{ storage_path: `${ORG}/arch/project_snapshot/${P1}/${OBJ}.exe` }, 422, "23514"],
    [{ storage_path: `${ORG}/arch/project_snapshot/${P1}/88888888-8888-4888-8888-888888888888.arch` }, 422, "23514"],
  ];
  for (const [over, status, code] of cases) {
    const r = await save(w, newBody(over));
    assert.equal(r.status, status, String(over.storage_path));
    assert.equal(r.json.error.code, code);
  }
  w.objects.set(pathFor(ORG, P1), SNAPSHOT_MAX_BYTES + 1);
  const big = await save(w, newBody());
  assert.equal(big.status, 413);
  assert.equal(big.json.error.code, "AR031");
  assert.equal(w.saves.length, 0);
  // 설치형에서 올린 사본도 경로 폴더 = project_uuid(local_id 폴더는 422, 저장소 호출 0).
  const local = await save(world(), newBody({ local_id: LOCAL }));
  assert.equal(local.status, 200);
  const wl = world();
  const byLocal = await save(wl, newBody({ local_id: LOCAL, storage_path: pathFor(ORG, LOCAL) }));
  assert.equal(byLocal.status, 422);
  assert.equal(wl.saves.length, 0);
  assert.ok(isOwnSnapshotPath(ORG, P1, pathFor(ORG, P1)));
  assert.ok(!isOwnSnapshotPath(ORG, P1, pathFor(OTHER_ORG, P1)));
});

test("저장: 권리 — viewer 403, entitled=false 402(can_download), web_edit 폴백 402(reason fallback), 저장소 호출 0", async () => {
  const viewer = world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: TOKEN } });
  assert.equal((await save(viewer, newBody())).status, 403);
  const expired = world({ session: { userId: USER, orgId: ORG, role: "owner", entitled: false, accessToken: TOKEN } });
  const e = await save(expired, newBody());
  assert.equal(e.status, 402);
  assert.equal(e.json.error.details.can_download, true);
  const fb = world({ webEdit: "fallback" });
  const f = await save(fb, newBody());
  assert.equal(f.status, 402);
  assert.equal(f.json.error.details.reason, "fallback");
  const denied = world({ webEdit: "denied" });
  assert.equal((await save(denied, newBody())).status, 402);
  for (const w of [viewer, expired, fb, denied]) assert.equal(w.saves.length, 0);
  const unauth = world({ session: new GatewayError("unauthorized") });
  assert.equal((await save(unauth, newBody())).status, 401);
});

test("저장: 저장소가 다른 행·버전을 돌려주면 성공으로 알리지 않는다(500), 원문 예외는 응답·로그에 없다", async (t) => {
  const lines = spy(t);
  const skip = world({ saveOverride: async (a) => ({ project_uuid: a.projectUuid, version: a.expectedVersion + 2 }) });
  assert.equal((await save(skip, newBody())).status, 500);
  const other = world({ saveOverride: async (a) => ({ project_uuid: P2, version: a.expectedVersion + 1 }) });
  assert.equal((await save(other, newBody())).status, 500);
  const boom = world({
    saveOverride: async () => {
      throw new Error(`duplicate key ${SECRET_NAME} at ${pathFor(ORG, P1)} service_role=sk-live`);
    },
  });
  const r = await save(boom, newBody());
  assert.equal(r.status, 500);
  const text = JSON.stringify(r.json) + lines.join("\n");
  for (const leak of [SECRET_NAME, OBJ, "sk-live", TOKEN, "duplicate key"]) assert.ok(!text.includes(leak), leak);
});

test("저장: 레이트 리밋(조직 60회/분) 초과 429 + retry-after", async () => {
  const w = world();
  const rate = new MemoryRateLimitStore();
  for (let i = 0; i < 60; i++) await save(w, newBody({ expected_version: i }), rate);
  const r = await save(w, newBody(), rate);
  assert.equal(r.status, 429);
  assert.ok(Number(r.raw.headers.get("retry-after")) >= 1);
});

test("저장 로그: 이름·경로·토큰 0, 코드·project_uuid·version만", async (t) => {
  const lines = spy(t);
  const w = world();
  await save(w, newBody());
  await save(w, newBody());
  await save(w, newBody({ storage_path: pathFor(OTHER_ORG, P1) }));
  const text = lines.join("\n");
  assert.ok(lines.length >= 3);
  for (const leak of [SECRET_NAME, OBJ, TOKEN, OTHER_ORG, "project_snapshot"]) assert.ok(!text.includes(leak), leak);
  assert.match(text, /"code":"AR041"/);
  assert.match(text, /"version":1/);
});

test("목록: 세션 조직 행만, 다른 조직 행이 섞여 와도 버린다(org_id는 응답에 없음), 402 예외로 entitled=false도 허용", async (t) => {
  const lines = spy(t);
  const w = world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: TOKEN } });
  w.rows.set(`${ORG}:${P1}`, row(ORG, P1, 2, { local_id: LOCAL }));
  w.rows.set(`${OTHER_ORG}:${P2}`, row(OTHER_ORG, P2, 5, { name: SECRET_NAME }));
  w.leakRows = [row(OTHER_ORG, P2, 5, { name: SECRET_NAME })];
  const r = await list(w);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data, {
    items: [{ project_uuid: P1, local_id: LOCAL, name: "사본", version: 2, bytes: 1000, updated_at: "2026-10-28T00:00:00.000Z" }],
    next: null,
    max: 3,
    retention_until: null,
  });
  assert.ok(!JSON.stringify(r.json).includes(OTHER_ORG));
  assert.ok(!lines.join("\n").includes(SECRET_NAME));
  assert.match(lines.join("\n"), /rows_dropped.*"count":1/);
});

test("목록: 모르는 쿼리·깨진 커서 422, viewer 403, 미인증 401", async () => {
  assert.equal((await list(world(), "?org_id=x")).status, 422);
  assert.equal((await list(world(), "?cursor=../../etc")).status, 422);
  assert.equal((await list(world(), "?cursor=abc_DEF-123")).status, 200);
  assert.equal((await list(world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: TOKEN } }))).status, 403);
  assert.equal((await list(world({ session: new GatewayError("unauthorized") }))).status, 401);
});

test("upload-url: 새 사본이 상한이면 AR040·서명 0, 기존 사본·여유 있으면 uploads/sign(project_snapshot, project_ref=id)로 넘긴다", async () => {
  const body = { ext: "arch", bytes: 2000, sha256: "a".repeat(64) };
  const full = world({ max: 1 });
  full.rows.set(`${ORG}:${P1}`, row(ORG, P1, 1));
  const r = await uploadUrl(full, P2, body);
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "AR040");
  assert.equal(full.signed.length, 0);

  const ok = await uploadUrl(full, P1, body);
  assert.equal(ok.status, 200);
  assert.equal(full.signed.length, 1);
  const forwarded = full.signed[0] as Request;
  assert.equal(new URL(forwarded.url).pathname, "/api/uploads/sign");
  assert.equal(forwarded.headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.deepEqual(await forwarded.json(), { purpose: "project_snapshot", project_ref: P1, ...body });

  for (const bad of [{ ...body, ext: "png" }, { ...body, purpose: "render_input" }, { ...body, path: "x" }, { ...body, sha256: "z" }]) {
    assert.equal((await uploadUrl(world(), P1, bad)).status, 422);
  }
  assert.equal((await uploadUrl(world(), "../x", body)).status, 422);
  const expired = world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: TOKEN } });
  assert.equal((await uploadUrl(expired, P1, body)).status, 402);
  assert.equal(expired.signed.length, 0);
});

test("조직 격리: 다른 조직에 같은 project_uuid가 있어도 내 조직 기준으로 새 사본·상한을 판정한다", async () => {
  const w = world({ max: 1 });
  w.rows.set(`${OTHER_ORG}:${P1}`, row(OTHER_ORG, P1, 7));
  const r = await save(w, newBody());
  assert.equal(r.status, 200);
  assert.equal(r.json.data.version, 1);
  assert.equal(w.rows.get(`${OTHER_ORG}:${P1}`)?.version, 7, "다른 조직 행은 그대로");
  assert.ok(w.saves.every((s) => s.orgId === ORG));
});

test("DB 오류 매핑·로그 허용 목록", () => {
  assert.equal(mapCloudDbError({ code: "AR041" }), "AR041");
  assert.equal(mapCloudDbError({ code: "AR040" }), "AR040");
  assert.equal(mapCloudDbError({ code: "P0002" }), "not_found");
  assert.equal(mapCloudDbError({ code: "XX000", message: SECRET_NAME }), "internal");
  assert.equal(mapCloudDbError(null), "internal");
  assert.deepEqual(
    sanitizeCloudLog({ route: "cloud_projects_save", code: "AR041", project_uuid: P1, version: 2, reason: SECRET_NAME, count: 1.5 } as never),
    { route: "cloud_projects_save", code: "AR041", project_uuid: P1, version: 2 },
  );
  assert.deepEqual(sanitizeCloudLog({ route: "x" as never, project_uuid: pathFor(ORG, P1) }), { route: "unknown" });
});

test("저장: 교체된 이전 객체를 지운다(같은 프로젝트 폴더만), 삭제 실패해도 200·경로 로그 0", async (t) => {
  const OLD = `${ORG}/arch/project_snapshot/${P1}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.arch`;
  const ok = world({ saveOverride: async () => ({ project_uuid: P1, version: 1, previous_path: OLD }) });
  assert.equal((await save(ok, newBody())).status, 200);
  assert.deepEqual(ok.removed, [OLD]);

  const foreign = world({ saveOverride: async () => ({ project_uuid: P1, version: 1, previous_path: pathFor(OTHER_ORG, P1) }) });
  assert.equal((await save(foreign, newBody())).status, 200);
  assert.deepEqual(foreign.removed, [], "다른 조직 경로는 지우지 않는다");
  const same = world({ saveOverride: async () => ({ project_uuid: P1, version: 1, previous_path: pathFor(ORG, P1) }) });
  assert.equal((await save(same, newBody())).status, 200);
  assert.deepEqual(same.removed, [], "새 경로와 같으면 지우지 않는다");

  const lines = spy(t);
  const fail = world({ removeFails: true, saveOverride: async () => ({ project_uuid: P1, version: 1, previous_path: OLD }) });
  const r = await save(fail, newBody());
  assert.equal(r.status, 200);
  assert.ok(lines.some((l) => l.includes("previous_remove_failed")));
  assert.ok(lines.every((l) => !l.includes(OLD) && !l.includes(`${ORG}/`)));
});

test("저장: DB 23505(같은 local_id·다른 project_uuid) 409, DB AR031 413", async () => {
  const dup = world({
    saveOverride: async () => {
      throw new CloudDbError("23505");
    },
  });
  const r = await save(dup, newBody({ local_id: LOCAL }));
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "23505");
  const big = world({
    saveOverride: async () => {
      throw new CloudDbError("AR031");
    },
  });
  assert.equal((await save(big, newBody())).status, 413);
});

test("supabase 저장소: 커서 왕복·깨진 커서 invalid_input, PostgREST 오류 detail → current_version·max", () => {
  const c = encodeCursor("2026-11-02T01:02:03.123456+00:00", P1);
  assert.match(c, /^[A-Za-z0-9_-]{1,200}$/);
  assert.deepEqual(decodeCursor(c), { updatedAt: "2026-11-02T01:02:03.123456+00:00", id: P1 });
  const injected = Buffer.from(JSON.stringify(["2026-11-02T00:00:00Z\",id.gt.0", P1])).toString("base64url");
  for (const bad of ["xx", Buffer.from('["x","y"]').toString("base64url"), injected]) {
    assert.throws(() => decodeCursor(bad), (e: unknown) => e instanceof CloudApiError && e.code === "invalid_input");
  }
  const conflict = toCloudDbError({ code: "AR041", message: "save_cloud_project: version conflict", details: '{"current_version": 3}' });
  assert.equal(conflict.code, "AR041");
  assert.equal(conflict.currentVersion, 3);
  assert.equal(toCloudDbError({ code: "AR040", details: '{"max": 3}' }).max, 3);
  assert.equal(toCloudDbError({ code: "AR041", details: "not json" }).currentVersion, undefined);
  assert.equal(toCloudDbError({ code: "23505" }).code, "23505");
  assert.equal(toCloudDbError({ code: "AR031" }).code, "AR031");
  assert.equal(toCloudDbError({ code: "XX000", details: SECRET_NAME }).code, "internal");
});
