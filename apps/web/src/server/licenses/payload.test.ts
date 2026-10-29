// 실행: pnpm --filter ./apps/web test
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson } from "./canonical.ts";
import { buildLicensePayload, computeOfflineValidUntil, rfc3339, type OrgFeaturesView } from "./payload.ts";
import { prng } from "./test-helpers.ts";

const NOW = Date.UTC(2026, 9, 29, 9, 0, 0, 999);
const TRIAL: OrgFeaturesView = {
  state: "trial",
  plan_code: "trial",
  trial_ends_at: "2026-11-02T00:00:00+00:00",
  updates_until: null,
  drafting_watermark: true,
  rule_pack_updates: true,
  cloud_review: false,
  ai_render: true,
  render_max_px: 1024,
};

test("issued_at은 초 단위 RFC 3339(밀리초 버림)", () => {
  assert.equal(rfc3339(NOW), "2026-10-29T09:00:00Z");
  assert.throws(() => rfc3339(Number.NaN));
});

test("offline_valid_until: 영구 null, 플랜 발급 + 7일", () => {
  assert.equal(computeOfflineValidUntil("license", NOW, ["2026-10-30T00:00:00Z"]), null);
  assert.equal(computeOfflineValidUntil("plan", NOW, []), "2026-11-05T09:00:00Z");
  assert.equal(computeOfflineValidUntil("plan", NOW, [null, undefined, "garbage"]), "2026-11-05T09:00:00Z");
});

test("clamp: 상품 종료가 더 이르면 종료 시각, 늦으면 7일", () => {
  assert.equal(computeOfflineValidUntil("plan", NOW, ["2026-11-02T00:00:00+00:00"]), "2026-11-02T00:00:00Z");
  assert.equal(computeOfflineValidUntil("plan", NOW, ["2027-01-01T00:00:00Z"]), "2026-11-05T09:00:00Z");
  assert.equal(computeOfflineValidUntil("plan", NOW, ["2027-01-01T00:00:00Z", "2026-11-01T12:00:00+09:00"]), "2026-11-01T03:00:00Z");
});

test("속성(500회): 플랜 offline_valid_until ≤ 발급 + 7일, ≤ 모든 종료 시각", () => {
  const rnd = prng(7);
  for (let i = 0; i < 500; i++) {
    const now = Date.UTC(2026, 0, 1) + Math.floor(rnd() * 365 * 86_400_000);
    const ends = Array.from({ length: Math.floor(rnd() * 3) }, () => new Date(now + Math.floor((rnd() - 0.2) * 30 * 86_400_000)).toISOString());
    const out = Date.parse(computeOfflineValidUntil("plan", now, ends) as string);
    assert.ok(out <= now + 7 * 86_400_000);
    for (const e of ends) assert.ok(out <= Date.parse(e));
  }
});

test("플랜 payload: license_id·updates_until null, 체험 종료로 clamp, features는 4키만", () => {
  const p = buildLicensePayload({
    source: "plan",
    licenseId: "ignored",
    orgId: "o",
    sku: "trial",
    updatesUntil: "2030-01-01",
    activationId: "a",
    deviceHash: "d".repeat(64),
    kid: "k",
    nowMs: NOW,
    features: TRIAL,
  });
  assert.equal(p.license_id, null);
  assert.equal(p.updates_until, null);
  assert.equal(p.offline_valid_until, "2026-11-02T00:00:00Z");
  assert.deepEqual(p.features, { drafting_watermark: true, rule_pack_updates: true, cloud_review: false, ai_render: true });
  assert.ok(!canonicalJson(p).includes("render_max_px"));
  assert.ok(!canonicalJson(p).includes("seat_id"), "확장 없으면 필드 생략");
});

test("확장점(AR-06-074): seat_id·rights 포함, product_ends_at으로 clamp", () => {
  const p = buildLicensePayload({
    source: "plan",
    licenseId: null,
    orgId: "o",
    sku: "sub_monthly",
    updatesUntil: null,
    activationId: "a",
    deviceHash: "d".repeat(64),
    kid: "k",
    nowMs: NOW,
    features: { ...TRIAL, state: "subscribed", trial_ends_at: null },
    extension: { seat_id: "s", rights: { web_edit: true, devices_max: 2 }, product_ends_at: "2026-10-31T00:00:00Z" },
  });
  assert.equal(p.seat_id, "s");
  assert.deepEqual(p.rights, { web_edit: true, devices_max: 2 });
  assert.equal(p.offline_valid_until, "2026-10-31T00:00:00Z");
});

const LICENSED_F: OrgFeaturesView = { ...TRIAL, state: "licensed", plan_code: null, trial_ends_at: null, updates_until: "2027-10-29", drafting_watermark: false };
const licenseInput = (extension?: Parameters<typeof buildLicensePayload>[0]["extension"], nowMs = NOW) =>
  buildLicensePayload({
    source: "license",
    licenseId: "l",
    orgId: "o",
    sku: "perpetual_early",
    updatesUntil: "2027-10-29",
    activationId: "a",
    deviceHash: "d".repeat(64),
    kid: "k",
    nowMs,
    features: LICENSED_F,
    extension,
  });

test("회귀 🟠4: 영구(license) 파일은 확장이 없어도 rights_expiry = issued_at + 30일(5개 권리, view_export 제외)", () => {
  const p = licenseInput();
  const exp = "2026-11-28T09:00:00Z"; // 발급 2026-10-29T09:00:00Z(밀리초 버림) + 30일
  assert.deepEqual(p.rights_expiry, { web_edit: exp, desktop_edit: exp, ai_render: exp, ai_chat: exp, cloud_review: exp });
  assert.ok(!("view_export" in (p.rights_expiry ?? {})));
  assert.equal(p.offline_valid_until, null);
  assert.ok(canonicalJson(p).includes('"rights_expiry":{"ai_chat":"2026-11-28T09:00:00Z"'), "정준화 키 정렬");
});

test("rights_expiry(license): 확장 값은 30일 상한으로 clamp, null·누락·깨진 값은 30일, 이른 값은 유지", () => {
  const p = licenseInput({
    rights_expiry: { web_edit: "2027-12-31T00:00:00Z", desktop_edit: null, ai_render: "2026-11-01T00:00:00+09:00", ai_chat: "garbage" },
  });
  const cap = "2026-11-28T09:00:00Z";
  assert.deepEqual(p.rights_expiry, { web_edit: cap, desktop_edit: cap, ai_render: "2026-10-31T15:00:00Z", ai_chat: cap, cloud_review: cap });
});

test("속성(300회): license 출처 rights_expiry 각 값 ≤ issued_at + 30일, 키 5개", () => {
  const rnd = prng(11);
  for (let i = 0; i < 300; i++) {
    const now = Date.UTC(2026, 0, 1) + Math.floor(rnd() * 365 * 86_400_000);
    const ext: Record<string, string | null> = {};
    for (const k of ["web_edit", "desktop_edit", "ai_render", "ai_chat", "cloud_review"]) {
      ext[k] = rnd() < 0.2 ? null : new Date(now + Math.floor((rnd() - 0.3) * 90 * 86_400_000)).toISOString();
    }
    const p = licenseInput({ rights_expiry: ext }, now);
    const cap = Math.floor(now / 1000) * 1000 + 30 * 86_400_000;
    for (const v of Object.values(p.rights_expiry ?? {})) assert.ok(v !== null && Date.parse(v) <= cap);
    assert.equal(Object.keys(p.rights_expiry ?? {}).length, 5);
  }
});

test("rights_expiry(plan): 이 작업은 기본값을 넣지 않는다(확장 값 그대로, 074 소유)", () => {
  const base = { source: "plan", licenseId: null, orgId: "o", sku: "trial", updatesUntil: null, activationId: "a", deviceHash: "d", kid: "k", nowMs: NOW, features: TRIAL } as const;
  assert.equal(buildLicensePayload(base).rights_expiry, undefined);
  assert.deepEqual(buildLicensePayload({ ...base, extension: { rights_expiry: { web_edit: "2026-11-02T00:00:00Z" } } }).rights_expiry, { web_edit: "2026-11-02T00:00:00Z" });
});
