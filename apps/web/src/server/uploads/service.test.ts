// POST /api/uploads/sign·경로 생성: 경로 조작 전수·목적·확장자·크기·조직·로그(tasks/logs/AR-06-047.md P7·P8·P9·P12).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../ai/gateway/http.ts";
import type { GatewaySession } from "../ai/gateway/session.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { buildUploadPath, isServerUploadPath, PURPOSE_POLICIES, UPLOAD_PURPOSES, type UploadPurpose } from "./policy.ts";
import { handleUploadSign, tokenExpiry, type UploadDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OBJ = "99999999-9999-4999-8999-999999999999";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const SHA = "a".repeat(64);
const STORAGE_TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 7200, url: "x" })).toString("base64url")}.c2ln`;

interface World {
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  signed: { bucket: string; path: string }[];
  storageFails?: boolean;
  webEdit?: "allowed" | "fallback" | "denied";
}

function world(over: Partial<World> = {}): World {
  return {
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    features: { ai_render: true, ai_intake: true },
    signed: [],
    ...over,
  };
}

function deps(w: World, rate = new MemoryRateLimitStore()): UploadDeps {
  return {
    ...(w.webEdit ? { webEdit: async () => w.webEdit as "allowed" | "fallback" | "denied" } : {}),
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    features: () => ({ orgFeatures: async () => w.features }),
    signer: () => ({
      async createSignedUploadUrl(bucket, path) {
        if (w.storageFails) throw new Error(`storage 500 at https://proj.supabase.co/storage/v1/object/${path} key=service`);
        w.signed.push({ bucket, path });
        return { signedUrl: `https://proj.supabase.co/storage/v1/object/upload/sign/${bucket}/${path}?token=${STORAGE_TOKEN}`, token: STORAGE_TOKEN };
      },
    }),
    rateLimit: rate,
    now: () => NOW,
    randomUUID: () => OBJ,
  };
}

const okBody = { purpose: "render_input", ext: "png", bytes: 1000, sha256: SHA };

async function call(w: World, body: unknown = okBody, rate?: MemoryRateLimitStore) {
  const res = await handleUploadSign(
    new Request("https://web.example/api/uploads/sign", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }),
    deps(w, rate),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 테스트: 응답 JSON 탐색
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

function spy(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

test("경로 생성: 목적×허용 확장자 전부 서버 형식이고 DB 정규식(valid_user_path) 모양과 같다", () => {
  for (const purpose of UPLOAD_PURPOSES) {
    for (const ext of PURPOSE_POLICIES[purpose].exts) {
      const r = buildUploadPath({ orgId: ORG, purpose, ext, projectRef: PROJECT, objectId: OBJ });
      assert.ok(r.ok, `${purpose}.${ext}`);
      const expected = purpose === "project_snapshot" ? `${ORG}/arch/${purpose}/${PROJECT}/${OBJ}.${ext}` : `${ORG}/arch/${purpose}/${OBJ}.${ext}`;
      assert.equal(r.path, expected);
      // 2400_arch.sql arch.valid_user_path 정규식 그대로
      const db = new RegExp(`^${ORG}/arch/${purpose}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.[a-z0-9]{1,8}$`);
      assert.match(r.path, db);
      assert.ok(r.path.length <= 300);
    }
  }
});

test("경로 생성 거부 전수: 목적·확장자·project_ref·org·object id 조작", () => {
  const cases: [Partial<Parameters<typeof buildUploadPath>[0]>, string][] = [
    [{ purpose: "render" }, "purpose"],
    [{ purpose: "drafting-logo" }, "purpose"],
    [{ purpose: "__proto__" }, "purpose"],
    [{ purpose: "constructor" }, "purpose"],
    [{ purpose: "../render_input" }, "purpose"],
    [{ purpose: "RENDER_INPUT" }, "purpose"],
    [{ ext: "svg" }, "ext"],
    [{ ext: "PNG" }, "ext"],
    [{ ext: "png/../../x" }, "ext"],
    [{ ext: "png.html" }, "ext"],
    [{ ext: "" }, "ext"],
    [{ ext: "pn%67" }, "ext"],
    [{ ext: "png\u0000" }, "ext"],
    [{ projectRef: "../../other" }, "project_ref"],
    [{ projectRef: `${OTHER_ORG}/x` }, "project_ref"],
    [{ orgId: `${OTHER_ORG}/../${ORG}` }, "org"],
    [{ orgId: "" }, "org"],
    [{ objectId: "../x" }, "object_id"],
    [{ objectId: OBJ.toUpperCase().replace(/9/g, "A") }, "object_id"],
  ];
  for (const [over, reason] of cases) {
    const r = buildUploadPath({ orgId: ORG, purpose: "render_input", ext: "png", objectId: OBJ, ...over });
    assert.deepEqual(r, { ok: false, reason }, JSON.stringify(over));
  }
  assert.deepEqual(buildUploadPath({ orgId: ORG, purpose: "project_snapshot", ext: "arch", objectId: OBJ }), { ok: false, reason: "project_ref" });
});

test("isServerUploadPath: 다른 조직 접두·다른 목적 폴더·이중 확장자·상위 경로는 거짓", () => {
  const good = `${ORG}/arch/render_input/${OBJ}.png`;
  assert.ok(isServerUploadPath(ORG, "render_input", good));
  for (const p of [
    `${OTHER_ORG}/arch/render_input/${OBJ}.png`,
    `${ORG}/arch/proposal_sheet/${OBJ}.png`,
    `${ORG}/arch/render_input/${OBJ}.svg`,
    `${ORG}/arch/render_input/${OBJ}.png.svg`,
    `${ORG}/arch/render_input/../${OBJ}.png`,
    `/${good}`,
    `${good}\n`,
    `${ORG}/arch/render_input/${PROJECT}/${OBJ}.png`,
  ]) {
    assert.equal(isServerUploadPath(ORG, "render_input", p), false, p);
  }
  assert.equal(isServerUploadPath(ORG, "project_snapshot" as UploadPurpose, `${ORG}/arch/project_snapshot/${OBJ}.arch`), false);
});

test("서명: 서버 경로·버킷(consult_audio만 voice-audio)·응답 형식·expires_at = Storage 토큰 exp", async (t) => {
  spy(t);
  const w = world();
  const r = await call(w);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.data).sort(), ["expires_at", "path", "signed_upload_url"]);
  assert.equal(r.json.data.path, `${ORG}/arch/render_input/${OBJ}.png`);
  assert.equal(r.json.data.expires_at, new Date(NOW + 7200_000).toISOString());
  assert.deepEqual(w.signed, [{ bucket: "arch-user", path: `${ORG}/arch/render_input/${OBJ}.png` }]);
  const w2 = world();
  assert.equal((await call(w2, { purpose: "consult_audio", ext: "m4a", bytes: 10, sha256: SHA })).status, 200);
  assert.equal(w2.signed[0]?.bucket, "voice-audio");
  const w3 = world();
  assert.equal((await call(w3, { purpose: "project_snapshot", project_ref: PROJECT, ext: "arch", bytes: 10, sha256: SHA })).status, 200);
  assert.equal(w3.signed[0]?.path, `${ORG}/arch/project_snapshot/${PROJECT}/${OBJ}.arch`);
});

test("본문: path·file_name·org_id·bucket·upsert 키, 대문자 확장자, 잘못된 sha256·bytes → 422, 서명 0", async (t) => {
  spy(t);
  const bad: unknown[] = [
    { ...okBody, path: `${OTHER_ORG}/arch/render_input/${OBJ}.png` },
    { ...okBody, file_name: "../../a.png" },
    { ...okBody, org_id: OTHER_ORG },
    { ...okBody, bucket: "org-files" },
    { ...okBody, upsert: true },
    { ...okBody, ext: "PNG" },
    { ...okBody, ext: "png.svg" },
    { ...okBody, purpose: "render" },
    { ...okBody, sha256: "z".repeat(64) },
    { ...okBody, bytes: 0 },
    { ...okBody, bytes: 1.5 },
    { ...okBody, bytes: "100" },
    { ...okBody, project_ref: "../x" },
    { purpose: "project_snapshot", ext: "arch", bytes: 10, sha256: SHA }, // project_ref 필수
  ];
  for (const b of bad) {
    const w = world();
    const r = await call(w, b);
    assert.equal(r.status, 422, JSON.stringify(b));
    assert.equal(w.signed.length, 0);
  }
});

test("확장자 허용 목록 밖 415, 목적별 크기 상한 초과 413 AR031", async (t) => {
  spy(t);
  assert.equal((await call(world(), { ...okBody, ext: "jpg" })).status, 415);
  assert.equal((await call(world(), { purpose: "proposal_sheet", ext: "png", bytes: 1, sha256: SHA })).status, 415);
  for (const purpose of UPLOAD_PURPOSES) {
    const p = PURPOSE_POLICIES[purpose];
    const body = { purpose, ext: p.exts[0], bytes: p.maxBytes + 1, sha256: SHA, ...(p.requiresProjectRef ? { project_ref: PROJECT } : {}) };
    const r = await call(world(), body);
    assert.equal(r.status, 413, purpose);
    assert.equal(r.json.error.code, "AR031");
    const atLimit = await call(world(), { ...body, bytes: p.maxBytes });
    assert.equal(atLimit.status, 200, purpose);
  }
});

test("consult_audio 상한은 voice-audio 버킷 50MB(52428800) 이하", () => {
  assert.ok(PURPOSE_POLICIES.consult_audio.maxBytes <= 52428800);
});

test("web_edit 판정 주입: fallback·denied는 project_snapshot만 402, 미주입은 기존 동작", async (t) => {
  spy(t);
  const snap = { purpose: "project_snapshot", project_ref: PROJECT, ext: "arch", bytes: 10, sha256: SHA };
  const fb = await call(world({ webEdit: "fallback" }), snap);
  assert.equal(fb.status, 402);
  assert.equal(fb.json.error.details.fallback, true);
  assert.equal(fb.json.error.details.can_download, true);
  assert.equal((await call(world({ webEdit: "denied" }), snap)).status, 402);
  assert.equal((await call(world({ webEdit: "allowed" }), snap)).status, 200);
  assert.equal((await call(world(), snap)).status, 200);
  assert.equal((await call(world({ webEdit: "denied" }))).status, 200); // render_input은 영향 없음
});

test("권한: 미인증 401, 역할 없음 403, 엔타이틀먼트 만료 402, 기능 없음 402", async (t) => {
  spy(t);
  assert.equal((await call(world({ session: new GatewayError("unauthorized") }))).status, 401);
  assert.equal((await call(world({ session: { userId: USER, orgId: ORG, role: "viewer", entitled: true, accessToken: "x".repeat(30) } }))).status, 403);
  const expired = await call(world({ session: { userId: USER, orgId: ORG, role: "member", entitled: false, accessToken: "x".repeat(30) } }));
  assert.equal(expired.status, 402);
  assert.equal(expired.json.error.details.can_download, true);
  assert.equal((await call(world({ features: { ai_render: false } }))).status, 402);
  assert.equal((await call(world({ features: { ai_render: "true" } }))).status, 402);
  assert.equal((await call(world({ features: { ai_intake: false } }), { purpose: "consult_audio", ext: "wav", bytes: 1, sha256: SHA })).status, 402);
});

test("레이트 리밋: 조직당 60회/분", async (t) => {
  spy(t);
  const rate = new MemoryRateLimitStore();
  for (let i = 0; i < 60; i++) assert.equal((await call(world(), okBody, rate)).status, 200);
  assert.equal((await call(world(), okBody, rate)).status, 429);
});

test("Storage 실패 503, 응답·로그에 경로·서명 URL·토큰·Storage 원문 없음", async (t) => {
  const lines = spy(t);
  const ok = await call(world());
  const failed = await call(world({ storageFails: true }));
  assert.equal(failed.status, 503);
  const all = lines.join("\n") + JSON.stringify(failed.json);
  for (const s of [ok.json.data.path, OBJ, STORAGE_TOKEN, "supabase.co", "key=service", "user-access-token-value"]) assert.ok(!all.includes(s), s);
  assert.ok(lines.some((l) => l.includes("uploads_sign.issued")));
});

test("tokenExpiry: JWT exp만 읽고 형식이 깨지면 null", () => {
  assert.equal(tokenExpiry(STORAGE_TOKEN), NOW / 1000 + 7200);
  assert.equal(tokenExpiry("nope"), null);
  assert.equal(tokenExpiry("a.!!!.b"), null);
  assert.equal(tokenExpiry(`a.${Buffer.from('{"exp":"1"}').toString("base64url")}.b`), null);
});
