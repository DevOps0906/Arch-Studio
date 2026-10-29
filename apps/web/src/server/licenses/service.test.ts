// 실행: pnpm --filter ./apps/web test
// DB·세션은 목(LicenseDeps 주입). 실제 RLS/RPC 시나리오는 tasks/logs/AR-06-040.md "통합 테스트(skip)" 목록.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DbCallError, LicenseApiError } from "./errors.ts";
import type { OrgFeaturesView } from "./payload.ts";
import { MemoryRateLimitStore } from "./rate-limit.ts";
import { handleActivate, handleDeactivate, handleList, handleRefresh } from "./service.ts";
import { serialHash } from "./serial.ts";
import { createLicenseSigner, LicenseSignerError, verifyLicenseFile, type SignedLicenseFile } from "./signing.ts";
import { newEd25519Pem } from "./test-helpers.ts";
import type { LicenseDeps, LicenseSession, PrivilegedLicenseRepo, RefreshActivation, UserLicenseRepo } from "./types.ts";

const SERIAL = "ARCH-7K3QD-9XWPM-2BNRT-HV6YC";
const SERIAL_BODY = "7K3QD9XWPM2BNRTHV6YC";
const DEVICE = "ab".repeat(32);
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const KEY = newEd25519Pem();
const SIGNER = createLicenseSigner({ privateKey: KEY.pem, kid: "lic-test", aiTokenPrivateKey: newEd25519Pem().pem, aiTokenKid: "ai-test" });

const LICENSED: OrgFeaturesView = {
  state: "licensed",
  plan_code: null,
  trial_ends_at: null,
  updates_until: "2027-10-29",
  drafting_watermark: false,
  rule_pack_updates: true,
  cloud_review: true,
  ai_render: true,
};
const TRIAL: OrgFeaturesView = { ...LICENSED, state: "trial", plan_code: "trial", trial_ends_at: "2026-11-01T00:00:00+00:00", updates_until: null, drafting_watermark: true };

interface World {
  role: string;
  features: OrgFeaturesView;
  activateLicenseError?: string;
  activatePlanError?: string;
  deactivateError?: string;
  orgFeaturesError?: string;
  refreshAct: RefreshActivation | null;
  licenseStatus: string;
  signerError?: LicenseSignerError;
  calls: string[];
  clock: number;
}

function world(over: Partial<World> = {}): World {
  return {
    role: "member",
    features: LICENSED,
    refreshAct: { id: ACT, org_id: ORG, license_id: LIC, source: "license", device_hash: DEVICE, deactivated_at: null },
    licenseStatus: "active",
    calls: [],
    clock: NOW,
    ...over,
  };
}

const db = (code: string) => new DbCallError({ code, message: `raw db message for ${code} serial ${SERIAL}` });

function deps(w: World, store = new MemoryRateLimitStore()): LicenseDeps {
  const session: LicenseSession = { userId: USER, orgId: ORG, role: w.role, accessToken: "token" };
  const user: UserLicenseRepo = {
    async orgFeatures(orgId) {
      w.calls.push(`user.orgFeatures:${orgId}`);
      if (w.orgFeaturesError) throw db(w.orgFeaturesError);
      return w.features;
    },
    async deactivateActivation(id) {
      w.calls.push(`user.deactivate:${id}`);
      if (w.deactivateError) throw db(w.deactivateError);
      return { id, org_id: ORG, deactivated_at: "2026-10-29T03:00:00+00:00" };
    },
    async countSelfDeactivations(orgId, since) {
      w.calls.push(`user.countSelf:${orgId}:${since}`);
      return 2;
    },
    async getLicense(id) {
      w.calls.push(`user.getLicense:${id}`);
      return id === LIC ? { id, org_id: ORG, sku_code: "perpetual_early", status: w.licenseStatus, updates_until: "2027-10-29", serial_last5: "HV6YC" } : null;
    },
    async listLicenses() {
      w.calls.push("user.listLicenses");
      return [{ id: LIC, org_id: ORG, sku_code: "perpetual_early", serial_last5: "HV6YC", status: "active", purchased_at: "2026-10-01T00:00:00Z", updates_until: "2027-10-01" }];
    },
    async listActiveActivations() {
      w.calls.push("user.listActivations");
      return [
        { id: ACT, license_id: LIC, source: "license", device_label: "사무실 PC", activated_at: "2026-10-02T00:00:00Z", last_seen_at: "2026-10-28T00:00:00Z" },
        { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", license_id: null, source: "plan", device_label: null, activated_at: "2026-10-03T00:00:00Z", last_seen_at: "2026-10-03T00:00:00Z" },
      ];
    },
  };
  const privileged: PrivilegedLicenseRepo = {
    async activateLicense(input) {
      w.calls.push(`priv.activateLicense:${input.serialHash}:${input.deviceHash}:${input.userId}`);
      if (w.activateLicenseError) throw db(w.activateLicenseError);
      return {
        activation: { id: ACT, activated_at: "2026-10-29T03:00:00+00:00", last_seen_at: "2026-10-29T03:00:00+00:00" },
        license: { id: LIC, org_id: ORG, sku: "perpetual_early", serial_last5: "HV6YC", updates_until: "2027-10-29", status: "active" },
      };
    },
    async activatePlanDevice(input) {
      w.calls.push(`priv.activatePlan:${input.orgId}:${input.userId}`);
      if (w.activatePlanError) throw db(w.activatePlanError);
      return { id: ACT, activated_at: "2026-10-29T03:00:00+00:00" };
    },
    async getActivationForRefresh(id) {
      w.calls.push(`priv.getActivation:${id}`);
      return w.refreshAct && w.refreshAct.id === id ? w.refreshAct : null;
    },
  };
  return {
    session: {
      async resolve(req) {
        if (req.headers.get("authorization") !== "Bearer good") throw new LicenseApiError("unauthorized");
        return session;
      },
    },
    userRepo: () => user,
    privilegedRepo: () => privileged,
    signer: () => {
      if (w.signerError) throw w.signerError;
      return SIGNER;
    },
    rateLimit: store,
    ipSalt: () => "salt",
    proxy: { header: "x-forwarded-for", trustedHops: 1 },
    now: () => w.clock,
  };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/license/${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { authorization: "Bearer good", "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
  });

async function json(res: Response) {
  return (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } };
}

/** 모든 로그 출력을 모은다. */
function spyLogs(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  return lines;
}

function verify(file: unknown) {
  const res = verifyLicenseFile(file, { [SIGNER.kid]: SIGNER.publicKeyDer });
  assert.equal(res.ok, true, "서명 검증");
  return (res as { ok: true; payload: Record<string, unknown> }).payload;
}

test("activate(시리얼): 200, 서명 파일 검증, RPC에는 해시·세션 user만", async () => {
  const w = world();
  const res = await handleActivate(post("activate", { serial: SERIAL.toLowerCase(), device_hash: DEVICE.toUpperCase() }), deps(w));
  assert.equal(res.status, 200);
  const body = await json(res);
  const data = body.data as { license_file: SignedLicenseFile; license: Record<string, unknown>; activation: Record<string, unknown> };
  const p = verify(data.license_file);
  assert.equal(p.source, "license");
  assert.equal(p.license_id, LIC);
  assert.equal(p.device_hash, DEVICE);
  assert.equal(p.offline_valid_until, null);
  assert.equal(p.issued_at, "2026-10-29T03:00:00Z");
  assert.equal(p.updates_until, "2027-10-29");
  assert.deepEqual(data.license, { id: LIC, sku: "perpetual_early", serial_last5: "HV6YC", updates_until: "2027-10-29", status: "active" });
  assert.ok(w.calls.includes(`priv.activateLicense:${serialHash(SERIAL_BODY)}:${DEVICE}:${USER}`));
  assert.ok(!JSON.stringify(body).includes(SERIAL_BODY));
});

test("activate: 본문의 org_id·user_id·시각 필드는 거부(422), DB 미호출", async () => {
  for (const extra of [{ org_id: ORG }, { user_id: USER }, { issued_at: "2099-01-01" }, { offline_valid_until: null }]) {
    const w = world();
    const res = await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE, ...extra }), deps(w));
    assert.equal(res.status, 422, JSON.stringify(extra));
    assert.deepEqual(w.calls, []);
  }
  const w = world();
  assert.equal((await handleActivate(post("activate", { serial: SERIAL, device_hash: "xyz" }), deps(w))).status, 422);
  assert.equal((await handleActivate(post("activate", "{bad"), deps(w))).status, 400);
  assert.equal((await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE, pad: "x".repeat(3000) }), deps(w))).status, 413);
});

test("activate: DB 오류 코드 매핑(AR001 409, AR002 404, AR003 403, AR006 403), DB 원문 미노출", async () => {
  for (const [code, status] of [["AR001", 409], ["AR002", 404], ["AR003", 403], ["AR006", 403], ["22023", 422], ["XX000", 500]] as const) {
    const res = await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world({ activateLicenseError: code })));
    assert.equal(res.status, status, code);
    const text = await res.text();
    assert.ok(!text.includes("raw db message") && !text.includes(SERIAL), code);
    assert.equal(JSON.parse(text).error.code, code === "XX000" ? "internal" : code);
  }
});

test("activate: 인증 없음 401, 역할 없음 403", async () => {
  assert.equal((await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }, { authorization: "Bearer bad" }), deps(world()))).status, 401);
  assert.equal((await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world({ role: "viewer" })))).status, 403);
});

test("activate: 형식이 틀린 시리얼도 버킷을 소모, 11번째 429 + retry-after, refresh와 같은 버킷", async () => {
  const store = new MemoryRateLimitStore();
  const w = world();
  for (let i = 0; i < 9; i++) {
    const res = await handleActivate(post("activate", { serial: `ARCH-${i}`, device_hash: DEVICE }), deps(w, store));
    assert.equal(res.status, 422);
  }
  assert.equal((await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(w, store))).status, 200, "10번째(refresh) 허용");
  const res = await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(w, store));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "3600");
  assert.equal((await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(w, store))).status, 429);
  // XFF 왼쪽 위조로 새 버킷을 만들 수 없다
  const spoof = await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }, { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }), deps(w, store));
  assert.equal(spoof.status, 429);
});

test("activate: 서명기 없음·깨짐이면 503, DB 미호출(활성화만 되고 파일 미발급 방지)", async () => {
  const w = world({ signerError: new LicenseSignerError("missing") });
  const res = await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(w));
  assert.equal(res.status, 503);
  assert.equal((await json(res)).error?.code, "license_signing_unavailable");
  assert.deepEqual(w.calls, []);
});

test("activate(플랜): 체험 종료로 offline_valid_until clamp, license null, 만료(AR003)는 402", async () => {
  const w = world({ features: TRIAL });
  const res = await handleActivate(post("activate", { mode: "plan", device_hash: DEVICE }), deps(w));
  assert.equal(res.status, 200);
  const data = (await json(res)).data as { license_file: SignedLicenseFile; license: unknown };
  const p = verify(data.license_file);
  assert.equal(data.license, null);
  assert.equal(p.source, "plan");
  assert.equal(p.sku, "trial");
  assert.equal(p.license_id, null);
  assert.equal(p.offline_valid_until, "2026-11-01T00:00:00Z", "발급 + 7일(11-05)보다 체험 종료가 이르다");
  assert.ok(w.calls.includes(`priv.activatePlan:${ORG}:${USER}`));

  const expired = await handleActivate(post("activate", { mode: "plan", device_hash: DEVICE }), deps(world({ activatePlanError: "AR003" })));
  assert.equal(expired.status, 402);
  assert.deepEqual((await json(expired)).error?.details, { reason: "expired", can_download: true });
  const limit = await handleActivate(post("activate", { mode: "plan", device_hash: DEVICE }), deps(world({ features: TRIAL, activatePlanError: "AR001" })));
  assert.equal(limit.status, 409);
  // RPC 통과 후 상태가 바뀐 경쟁(만료 직후) → 402
  assert.equal((await handleActivate(post("activate", { mode: "plan", device_hash: DEVICE }), deps(world({ features: { ...TRIAL, state: "trial_expired" } })))).status, 402);
});

test("deactivate: 사용자 JWT repo만 사용(service_role 0), oa만, AR004 429", async () => {
  const w = world({ role: "admin" });
  const res = await handleDeactivate(post("deactivate", { activation_id: ACT }), deps(w));
  assert.equal(res.status, 200);
  assert.deepEqual((await json(res)).data, { activation: { id: ACT, deactivated_at: "2026-10-29T03:00:00+00:00" }, self_deactivations_30d: 2 });
  assert.ok(w.calls.every((c) => c.startsWith("user.")), w.calls.join());
  assert.ok(w.calls.includes(`user.countSelf:${ORG}:2026-09-29T03:00:00.000Z`));

  assert.equal((await handleDeactivate(post("deactivate", { activation_id: ACT }), deps(world({ role: "member" })))).status, 403);
  assert.equal((await handleDeactivate(post("deactivate", { activation_id: ACT }), deps(world({ role: "owner", deactivateError: "AR004" })))).status, 429);
  assert.equal((await handleDeactivate(post("deactivate", { activation_id: ACT }), deps(world({ role: "owner", deactivateError: "P0002" })))).status, 404);
  assert.equal((await handleDeactivate(post("deactivate", { activation_id: "x" }), deps(world({ role: "owner" })))).status, 422);
});

test("refresh: 재서명(새 issued_at), 해제·기기 불일치·없음·비멤버는 같은 404", async () => {
  const w = world({ clock: NOW + 86_400_000 });
  const res = await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(w));
  assert.equal(res.status, 200);
  const p = verify(((await json(res)).data as { license_file: SignedLicenseFile }).license_file);
  assert.equal(p.issued_at, "2026-10-30T03:00:00Z");
  assert.equal(p.updates_until, "2027-10-29", "updates_until은 DB 값");

  const cases: Array<[string, Partial<World>, string?]> = [
    ["해제됨", { refreshAct: { id: ACT, org_id: ORG, license_id: LIC, source: "license", device_hash: DEVICE, deactivated_at: "2026-10-01T00:00:00Z" } }],
    ["기기 불일치", {}, "cd".repeat(32)],
    ["없음", { refreshAct: null }],
    ["비멤버", { orgFeaturesError: "42501" }],
    ["라이선스 RLS로 안 보임", { refreshAct: { id: ACT, org_id: ORG, license_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", source: "license", device_hash: DEVICE, deactivated_at: null } }],
  ];
  const bodies = new Set<string>();
  for (const [name, over, device] of cases) {
    const r = await handleRefresh(post("refresh", { activation_id: ACT, device_hash: device ?? DEVICE }), deps(world(over)));
    assert.equal(r.status, 404, name);
    bodies.add(await r.text());
  }
  assert.equal(bodies.size, 1, "응답 본문이 원인별로 다르지 않다");
});

test("refresh: 정지·환불 라이선스 AR003 403, 만료 플랜 402, 플랜은 7일 clamp 재계산", async () => {
  assert.equal((await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(world({ licenseStatus: "refunded" })))).status, 403);
  const planAct: RefreshActivation = { id: ACT, org_id: ORG, license_id: null, source: "plan", device_hash: DEVICE, deactivated_at: null };
  assert.equal(
    (await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(world({ refreshAct: planAct, features: { ...TRIAL, state: "trial_expired" } })))).status,
    402,
  );
  const sub = { ...TRIAL, state: "subscribed", plan_code: "sub_monthly", trial_ends_at: null };
  const r = await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(world({ refreshAct: planAct, features: sub })));
  const p = verify(((await json(r)).data as { license_file: SignedLicenseFile }).license_file);
  assert.equal(p.offline_valid_until, "2026-11-05T03:00:00Z");
  assert.equal(p.sku, "sub_monthly");
});

test("list: RLS repo만, 시리얼 끝 5자만, 기기 해시 없음", async () => {
  const w = world();
  const req = new Request("http://localhost/api/license/list", { headers: { authorization: "Bearer good" } });
  const res = await handleList(req, deps(w));
  assert.equal(res.status, 200);
  const data = (await json(res)).data as { licenses: Array<{ activations: unknown[]; serial_last5: string }>; plan_activations: unknown[]; last_eligible_build: unknown };
  assert.equal(data.licenses[0]?.serial_last5, "HV6YC");
  assert.equal(data.licenses[0]?.activations.length, 1);
  assert.equal(data.plan_activations.length, 1);
  assert.equal(data.last_eligible_build, null);
  assert.ok(w.calls.every((c) => c.startsWith("user.")));
  const text = JSON.stringify(data);
  assert.ok(!text.includes("serial_hash") && !text.includes("device_hash"));
});

test("로그 스파이: 전 시나리오에서 시리얼 원문·서명·payload·키·device_hash 노출 0", async (t) => {
  const lines = spyLogs(t);
  const files: SignedLicenseFile[] = [];
  const grab = async (res: Response) => {
    const b = await json(res.clone());
    const f = (b.data as { license_file?: SignedLicenseFile } | undefined)?.license_file;
    if (f) files.push(f);
  };
  await grab(await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world())));
  await grab(await handleActivate(post("activate", { mode: "plan", device_hash: DEVICE }), deps(world({ features: TRIAL }))));
  for (const code of ["AR001", "AR002", "AR003", "AR006", "XX000"]) {
    await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world({ activateLicenseError: code })));
  }
  await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world({ signerError: new LicenseSignerError("invalid_key") })));
  await grab(await handleRefresh(post("refresh", { activation_id: ACT, device_hash: DEVICE }), deps(world())));
  await handleDeactivate(post("deactivate", { activation_id: ACT }), deps(world({ role: "owner" })));
  const store = new MemoryRateLimitStore();
  for (let i = 0; i < 12; i++) await handleActivate(post("activate", { serial: SERIAL, device_hash: DEVICE }), deps(world(), store));

  assert.ok(lines.length > 10, "로그가 실제로 남았다");
  assert.equal(files.length, 3);
  const all = lines.join("\n");
  const forbidden = [SERIAL, SERIAL_BODY, serialHash(SERIAL_BODY), DEVICE, KEY.pem.split("\n")[1] as string, KEY.der64.slice(0, 40), "raw db message", "203.0.113.9"];
  for (const f of files) forbidden.push(f.sig, f.payload.slice(0, 40));
  for (const s of forbidden) assert.ok(!all.includes(s), `로그에 노출: ${s.slice(0, 12)}…`);
  assert.ok(all.includes("HV6YC") || all.includes("V6YC"), "끝 5자는 남을 수 있다");
});
