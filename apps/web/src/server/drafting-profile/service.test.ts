// GET|PUT /api/drafting-profile·로고 URL(목): AR042·IDOR·키 검증·제어문자·길이·감사(RPC 호출)·로고 정책·로그 가리기(계획 공격 P1~P11).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { pngBytes } from "./test-helpers.ts";
import { handleGetProfile, handleLogoUploadUrl, handlePutProfile, PROFILE_MAX_BODY, PROFILE_RATE, type DraftingProfileDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OBJ = "99999999-9999-4999-8999-999999999999";
const LOGO = `${ORG}/arch/drafting-logo/${OBJ}.png`;
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 7200 })).toString("base64url")}.c2ln`;

interface World {
  session: GatewaySession | GatewayError;
  row: Record<string, unknown> | null;
  upserts: { payload: Record<string, unknown>; orgId: string }[];
  gets: string[];
  objects: Record<string, Uint8Array>;
  signed: string[];
  dbError?: string;
  storageFails?: boolean;
}

function world(over: Partial<World> = {}): World {
  return {
    session: { userId: USER, orgId: ORG, role: "owner", entitled: true, accessToken: "user-access-token-value-0123456789" },
    row: null,
    upserts: [],
    gets: [],
    objects: {},
    signed: [],
    ...over,
  };
}

const role = (r: string, entitled = true): GatewaySession => ({ userId: USER, orgId: ORG, role: r, entitled, accessToken: "user-access-token-value-0123456789" });

function deps(w: World, rate = new MemoryRateLimitStore()): DraftingProfileDeps {
  return {
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    repo: () => ({
      async get(orgId) {
        w.gets.push(orgId);
        return w.row;
      },
      async upsert(payload, orgId) {
        if (w.dbError) throw Object.assign(new Error(`db error ${w.dbError} SELECT secret FROM arch.x`), { code: w.dbError });
        w.upserts.push({ payload, orgId });
        w.row = { ...payload, org_id: orgId, updated_by: USER, updated_at: "2026-10-29T03:00:00Z", logo_storage_path: payload.logo_storage_path || null };
        return w.row;
      },
    }),
    logos: () => ({
      async createSignedUploadUrl(path) {
        if (w.storageFails) throw new Error(`storage 500 ${path} service_role_key=abc`);
        w.signed.push(path);
        return { signedUrl: `https://proj.supabase.co/storage/v1/object/upload/sign/arch-user/${path}?token=${TOKEN}`, token: TOKEN };
      },
      async createSignedReadUrl(path) {
        return `https://proj.supabase.co/storage/v1/object/sign/arch-user/${path}?token=read`;
      },
      async read(path) {
        return w.objects[path] ?? null;
      },
    }),
    rateLimit: rate,
    now: () => NOW,
    randomUUID: () => OBJ,
  };
}

const good = {
  office_name: "나무건축사사무소",
  architect_name: "홍길동",
  contact: "02-000-0000",
  layer_map: { "A-SITE-BNDY": "SITE_BND", "A-ENVL": "LAW-LINE" },
  default_paper: "A3",
  default_text_height_mm: 2.5,
  font_family: "Noto Sans KR",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
type Json = Record<string, any>;

async function put(w: World, body: unknown = good, rate?: MemoryRateLimitStore) {
  const res = await handlePutProfile(
    new Request("https://web.example/api/drafting-profile", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }),
    deps(w, rate),
  );
  return { status: res.status, json: (await res.json()) as Json };
}
async function get(w: World) {
  const res = await handleGetProfile(new Request("https://web.example/api/drafting-profile"), deps(w));
  return { status: res.status, json: (await res.json()) as Json };
}
async function logoUrl(w: World, body: unknown = { ext: "png", bytes: 1000, sha256: "a".repeat(64) }) {
  const res = await handleLogoUploadUrl(new Request("https://web.example/api/drafting-profile/logo-upload-url", { method: "POST", body: JSON.stringify(body) }), deps(w));
  return { status: res.status, json: (await res.json()) as Json };
}

function spy(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

test("P1 member·viewer PUT·로고 URL → AR042 403, RPC·서명 호출 0", async (t) => {
  spy(t);
  for (const r of ["member", "viewer", "guest"]) {
    const w = world({ session: role(r) });
    const a = await put(w);
    assert.equal(a.status, 403);
    assert.equal(a.json.error.code, "AR042");
    assert.equal(a.json.error.message, "표제란 설정은 조직 owner·admin만 저장합니다.");
    const b = await logoUrl(w);
    assert.equal(b.json.error.code, "AR042");
    assert.equal(w.upserts.length + w.signed.length, 0);
  }
});

test("P1 DB가 AR042로 거부해도(역할 경합) AR042 403", async (t) => {
  spy(t);
  const w = world({ dbError: "AR042" });
  const r = await put(w);
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "AR042");
});

test("owner·admin 저장 성공: RPC 1회(감사 행은 RPC 안), p_org = 세션 조직, 8개 키 전부", async (t) => {
  spy(t);
  for (const r of ["owner", "admin"]) {
    const w = world({ session: role(r) });
    const res = await put(w);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(w.upserts.length, 1);
    assert.equal(w.upserts[0]?.orgId, ORG);
    assert.deepEqual(Object.keys(w.upserts[0]?.payload ?? {}).sort(), [
      "architect_name",
      "contact",
      "default_paper",
      "default_text_height_mm",
      "font_family",
      "layer_map",
      "logo_storage_path",
      "office_name",
    ]);
    assert.equal(res.json.data.profile.office_name, "나무건축사사무소");
    assert.equal(res.json.data.can_edit, true);
    // 응답에 내부 정보 없음
    assert.equal(JSON.stringify(res.json).includes(ORG), false);
    assert.equal("org_id" in res.json.data.profile || "updated_by" in res.json.data.profile, false);
  }
});

test("엔타이틀먼트 없음 402, 미인증 401(저장 0)", async (t) => {
  spy(t);
  const w = world({ session: role("owner", false) });
  assert.equal((await put(w)).status, 402);
  const u = world({ session: new GatewayError("unauthorized") });
  assert.equal((await put(u)).status, 401);
  assert.equal((await get(u)).status, 401);
  assert.equal(w.upserts.length + u.upserts.length, 0);
});

test("P2 IDOR: 본문 org_id·추가 키 → 422, GET은 세션 조직만 조회", async (t) => {
  spy(t);
  const w = world();
  for (const extra of [{ org_id: OTHER_ORG }, { p_org: OTHER_ORG }, { client_name: "건축주" }, { updated_by: USER }]) {
    const r = await put(w, { ...good, ...extra });
    assert.equal(r.status, 422, JSON.stringify(extra));
  }
  assert.equal(w.upserts.length, 0);
  await get(w);
  assert.deepEqual(w.gets, [ORG]);
});

test("P3 layer_map 키 주입 → 422", async (t) => {
  spy(t);
  const w = world();
  for (const lm of ['{"__proto__":"X"}', '{"constructor":"X"}', '{"a-wall":"X"}', '{"A-WALL ":"X"}', '{"X-NEW":"X"}', "[]", '"A-WALL"']) {
    const r = await put(w, `{"office_name":"A","layer_map":${lm},"default_paper":"A3","default_text_height_mm":2.5,"font_family":"Noto Sans KR"}`);
    assert.equal(r.status, 422, lm);
  }
  assert.equal(w.upserts.length, 0);
});

test("P4 layer_map 값: 제어문자·64자 초과·비문자열 422 / 금지 문자·한글은 표준 유지 + 경고(저장 map에서 빠짐)", async (t) => {
  spy(t);
  const w = world();
  for (const v of ["a\nb", "x\r\n0\r\nSECTION", "x\u202ey", "A".repeat(65), 7]) {
    const r = await put(w, { ...good, layer_map: { "A-WALL": v } });
    assert.equal(r.status, 422, String(v));
  }
  assert.equal(w.upserts.length, 0);
  const ok = await put(w, { ...good, layer_map: { "A-WALL": "W/1", "A-DOOR": "문", "A-GLAZ": "GLAZ", "A-AREA": "glaz" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(w.upserts[0]?.payload.layer_map, { "A-GLAZ": "GLAZ", "A-AREA": "glaz" });
  assert.deepEqual(
    ok.json.data.layer_warnings.map((x: Json) => `${x.kind}:${x.key}`),
    ["invalid_name:A-WALL", "unsupported_name:A-DOOR", "name_conflict:A-AREA"],
  );
});

test("P6 표제란 문자열: 제어문자·DXF 그룹 코드 주입·bidi·길이·빈 사무소명·글꼴 정규식·글자 높이 범위 → 422", async (t) => {
  spy(t);
  const w = world();
  const bad: Json[] = [
    { office_name: "A\n0\nSECTION\n2\nENTITIES" },
    { office_name: "A\u0000" },
    { office_name: "관리자\u202e" },
    { office_name: "   " },
    { office_name: "가".repeat(101) },
    { architect_name: "가".repeat(51) },
    { contact: "1".repeat(101) },
    { contact: "a\tb" },
    { font_family: "Noto<script>" },
    { font_family: "" },
    { default_text_height_mm: 1.9 },
    { default_text_height_mm: 5.1 },
    { default_text_height_mm: 2.55 },
    { default_paper: "A4" },
    { office_name: 1 },
  ];
  for (const b of bad) {
    const r = await put(w, { ...good, ...b });
    assert.equal(r.status, 422, JSON.stringify(b));
  }
  assert.equal(w.upserts.length, 0);
  // 경계 값 통과, <script>는 문자열로 저장(표시는 React·SVG 이스케이프)
  const ok = await put(w, { ...good, office_name: "<script>alert(1)</script>", architect_name: "가".repeat(50), default_text_height_mm: 5 });
  assert.equal(ok.status, 200);
});

test("P10 본문 16KB 초과 413, 깨진 JSON 400, 61번째 요청 429", async (t) => {
  spy(t);
  const w = world();
  assert.equal((await put(w, { ...good, office_name: "가".repeat(PROFILE_MAX_BODY) })).status, 413);
  assert.equal((await put(w, "{not json")).status, 400);
  const rate = new MemoryRateLimitStore();
  let last = 0;
  for (let i = 0; i <= PROFILE_RATE.limit; i++) last = (await put(w, good, rate)).status;
  assert.equal(last, 429);
});

test("P5 로고 URL: png·1MB 이하만, 경로는 서버가 생성(자기 조직), 응답에 서명 URL·경로·만료", async (t) => {
  spy(t);
  const w = world();
  const ok = await logoUrl(w);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.path, LOGO);
  assert.deepEqual(w.signed, [LOGO]);
  assert.equal(ok.json.data.expires_at, new Date(NOW + 7200_000).toISOString());
  assert.equal((await logoUrl(w, { ext: "svg", bytes: 10, sha256: "a".repeat(64) })).status, 415);
  assert.equal((await logoUrl(w, { ext: "html", bytes: 10, sha256: "a".repeat(64) })).status, 415);
  assert.equal((await logoUrl(w, { ext: "png", bytes: 1024 * 1024 + 1, sha256: "a".repeat(64) })).json.error.code, "AR031");
  assert.equal((await logoUrl(w, { ext: "png", bytes: 10, sha256: "a".repeat(64), path: "../x.png" })).status, 422);
  assert.equal((await logoUrl(w, { ext: "png", bytes: 10, sha256: "a".repeat(64), org_id: OTHER_ORG })).status, 422);
  assert.equal(w.signed.length, 1);
  const fail = await logoUrl(world({ storageFails: true }));
  assert.equal(fail.status, 503);
  assert.equal(JSON.stringify(fail.json).includes("service_role"), false);
});

test("P5 PUT 로고: 다른 조직·형식 밖 경로 23514, 객체 없음 23514, SVG·메타데이터 PNG 415, 큰 파일 AR031, 정상 PNG 저장", async (t) => {
  spy(t);
  const w = world();
  for (const p of [`${OTHER_ORG}/arch/drafting-logo/${OBJ}.png`, `${ORG}/arch/render_input/${OBJ}.png`, `${ORG}/arch/drafting-logo/${OBJ}.svg`]) {
    const r = await put(w, { ...good, logo_storage_path: p });
    assert.equal(r.status, 422, p);
    assert.equal(r.json.error.code, "23514");
  }
  assert.equal((await put(w, { ...good, logo_storage_path: LOGO })).json.error.code, "23514"); // 객체 없음
  w.objects[LOGO] = new TextEncoder().encode("<svg><script>x</script></svg>");
  assert.equal((await put(w, { ...good, logo_storage_path: LOGO })).status, 415);
  const meta = pngBytes();
  const exif = Uint8Array.from([...meta.slice(0, 33), 0, 0, 0, 1, ...[..."eXIf"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, ...meta.slice(33)]);
  w.objects[LOGO] = exif;
  assert.equal((await put(w, { ...good, logo_storage_path: LOGO })).status, 415);
  w.objects[LOGO] = new Uint8Array(1024 * 1024 + 1);
  assert.equal((await put(w, { ...good, logo_storage_path: LOGO })).json.error.code, "AR031");
  assert.equal(w.upserts.length, 0);
  w.objects[LOGO] = pngBytes();
  const ok = await put(w, { ...good, logo_storage_path: LOGO });
  assert.equal(ok.status, 200);
  assert.equal(w.upserts[0]?.payload.logo_storage_path, LOGO);
  assert.match(ok.json.data.logo_url, /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/sign\//);
  // 같은 경로로 다시 저장하면 객체를 다시 받지 않는다(이미 저장된 값)
  delete w.objects[LOGO];
  assert.equal((await put(w, { ...good, logo_storage_path: LOGO })).status, 200);
});

test("GET: 없으면 profile null, member는 can_edit false, viewer 403, 저장된 충돌 경고 포함", async (t) => {
  spy(t);
  const empty = await get(world({ session: role("member") }));
  assert.equal(empty.status, 200);
  assert.equal(empty.json.data.profile, null);
  assert.equal(empty.json.data.can_edit, false);
  assert.equal((await get(world({ session: role("viewer") }))).status, 403);
  const w = world({
    row: { ...good, org_id: ORG, updated_by: USER, layer_map: { "A-GLAZ": "G", "A-AREA": "g" }, default_text_height_mm: "2.5", updated_at: "2026-10-29T03:00:00Z" },
  });
  const r = await get(w);
  assert.equal(r.json.data.profile.default_text_height_mm, 2.5);
  assert.deepEqual(r.json.data.layer_warnings, [{ kind: "name_conflict", key: "A-AREA", name: "g" }]);
  assert.equal("org_id" in r.json.data.profile, false);
});

test("DB 오류 원문 미노출: 22023 → 422, 모르는 코드 → 500 고정 문구", async (t) => {
  spy(t);
  const a = await put(world({ dbError: "22023" }));
  assert.equal(a.status, 422);
  const b = await put(world({ dbError: "XX000" }));
  assert.equal(b.status, 500);
  assert.equal(JSON.stringify(b.json).includes("SELECT"), false);
});

test("P7·P11 로그: 값·경로·토큰·서명 URL 없음, 키 이름·코드만", async (t) => {
  const lines = spy(t);
  const w = world();
  w.objects[LOGO] = pngBytes();
  await put(w, { ...good, logo_storage_path: LOGO, office_name: "비밀사무소" });
  await put(world({ session: role("member") }), { ...good, contact: "010-1234-5678" });
  await logoUrl(w);
  await put(w, { ...good, office_name: "X\n0\nSECTION" });
  const all = lines.join("\n");
  for (const s of ["비밀사무소", "010-1234-5678", "나무건축사사무소", OBJ, "token", "SITE_BND", "SECTION", USER, ORG]) assert.equal(all.includes(s), false, s);
  assert.match(all, /drafting_profile\.updated/);
  assert.match(all, /"code":"AR042"/);
  assert.match(all, /"field":"office_name"/);
});
