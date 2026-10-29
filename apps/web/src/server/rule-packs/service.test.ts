// 실행: pnpm --filter ./apps/web test. DB·저장소·세션은 목(ReleaseDeps 주입). 실제 RLS/RPC 시나리오는 tasks/logs/AR-06-042.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LicenseApiError } from "../licenses/errors.ts";
import type { OrgFeaturesView } from "../licenses/payload.ts";
import { MemoryRateLimitStore } from "../licenses/rate-limit.ts";
import { newEd25519Pem } from "../licenses/test-helpers.ts";
import { sha256Hex, signRulePackManifest } from "./manifest.ts";
import {
  handleLatestCostCatalog,
  handleListRulePacks,
  handleRulePackDownload,
  handleUpdateManifest,
  LIMITS,
  sanitizeReleaseLog,
  SignedUrlCache,
  type DownloadDeps,
} from "./service.ts";
import type { BuildRow, CostCatalogRow, EligibleRulePackRow, ReleasePrivilegedRepo, ReleaseUserRepo, RulePackObjectRow } from "./types.ts";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.UTC(2026, 9, 29, 3, 0, 0);
const PACK = Buffer.from('{"version":"2026.10.0"}', "utf8");
const KEY = newEd25519Pem();
const SIGNED = signRulePackManifest({ privateKeyPem: KEY.pem, kid: "pack-a", version: "2026.10.0", publishedAt: "2026-10-20T00:00:00Z", basisDate: "2026-10-14", pack: PACK });
const SIG = (JSON.parse(SIGNED) as { sig: string }).sig;

const ELIGIBLE: EligibleRulePackRow = {
  version: "2026.10.0",
  published_at: "2026-10-20T00:00:00+00:00",
  basis_date: "2026-10-14",
  sha256: sha256Hex(PACK),
  signature: SIG,
  kid: "pack-a",
  bytes: PACK.byteLength,
  status: "published",
};
const OBJECT: RulePackObjectRow = { storage_path: "rule-packs/2026.10.0/pack.json", status: "published", sha256: ELIGIBLE.sha256, bytes: ELIGIBLE.bytes, kid: "pack-a", signature: SIG };
const LICENSED: OrgFeaturesView = {
  state: "licensed_fallback",
  plan_code: null,
  trial_ends_at: null,
  updates_until: "2026-12-31",
  drafting_watermark: false,
  rule_pack_updates: false,
  cloud_review: false,
  ai_render: true,
};
const BUILD: BuildRow = { version: "0.2.0", build_date: "2026-11-01", storage_path: "builds/stable/0.2.0/ArchStudio_0.2.0_x64-setup.nsis.zip", signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ", notes: "개선", published_at: "2026-11-02T00:00:00+00:00" };

interface World {
  role: string;
  eligible: EligibleRulePackRow[];
  statusOf: Record<string, string>;
  object: RulePackObjectRow | null;
  manifestText: string | null;
  catalog: CostCatalogRow | null;
  features: OrgFeaturesView;
  builds: Record<string, { build_date: string }>;
  eligibleBuild: BuildRow | null;
  calls: string[];
  sessionError?: LicenseApiError;
  clock: number;
}

function world(over: Partial<World> = {}): World {
  return {
    role: "member",
    eligible: [ELIGIBLE],
    statusOf: { "2026.10.0": "published" },
    object: OBJECT,
    manifestText: SIGNED,
    catalog: null,
    features: LICENSED,
    builds: {},
    eligibleBuild: null,
    calls: [],
    clock: NOW,
    ...over,
  };
}

function deps(w: World): DownloadDeps {
  const userRepo: ReleaseUserRepo = {
    async eligibleRulePacks(orgId) {
      w.calls.push(`eligible:${orgId}`);
      return w.eligible;
    },
    async rulePackStatus(v) {
      return w.statusOf[v] ? { status: w.statusOf[v] as string } : null;
    },
    async changesPublishedAfter(after) {
      w.calls.push(`changes:${after}`);
      return [{ title: "건축법 시행령 개정", effective_from: "2026-12-01" }];
    },
    async latestCostCatalog() {
      return w.catalog;
    },
    async orgFeatures() {
      return w.features;
    },
  };
  const priv: ReleasePrivilegedRepo = {
    async rulePackObject() {
      return w.object;
    },
    async signedUrl(path, seconds) {
      w.calls.push(`sign:${path}:${seconds}`);
      return `https://proj.supabase.co/storage/v1/object/sign/arch-releases/${path}?token=t${w.calls.length}`;
    },
    async readSmallText(path, max) {
      w.calls.push(`read:${path}:${max}`);
      return w.manifestText;
    },
    async eligibleBuild(_org, platform, current) {
      w.calls.push(`build:${platform}:${current}`);
      return w.eligibleBuild;
    },
    async build(platform, version) {
      return w.builds[`${platform}:${version}`] ?? null;
    },
  };
  return {
    session: {
      async resolve() {
        if (w.sessionError) throw w.sessionError;
        return { userId: USER, orgId: ORG, role: w.role, accessToken: "tok" };
      },
    },
    userRepo: () => userRepo,
    privilegedRepo: () => priv,
    rateLimit: new MemoryRateLimitStore(),
    urlCache: new SignedUrlCache(),
    now: () => w.clock,
  };
}

const req = (path: string) => new Request(`https://arch.example${path}`, { headers: { authorization: "Bearer x" } });
async function body(r: Response): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } }> {
  return (await r.json()) as never;
}

test("다운로드: 자격 있으면 서명 URL(10분)·서명 매니페스트 원문·사실값, no-store", async () => {
  const w = world();
  const r = await handleRulePackDownload(req("/api/rule-packs/2026.10.0/download"), "2026.10.0", deps(w));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const b = await body(r);
  assert.equal(b.data?.signed_manifest, SIGNED);
  assert.equal(b.data?.sha256, ELIGIBLE.sha256);
  assert.equal(b.data?.bytes, PACK.byteLength);
  assert.ok(String(b.data?.url).startsWith("https://proj.supabase.co/"));
  assert.equal(b.data?.expires_at, new Date(NOW + 600_000).toISOString());
  assert.ok(w.calls.includes("sign:rule-packs/2026.10.0/pack.json:600"));
  assert.ok(w.calls.includes(`eligible:${ORG}`), "세션 조직으로만 자격 판정");
});

test("다운로드 멱등: 같은 조직·버전은 수명 절반 동안 같은 URL, 그 뒤 새로 발급", async () => {
  const w = world();
  const d = deps(w);
  const a = await body(await handleRulePackDownload(req("/x"), "2026.10.0", d));
  w.clock = NOW + 200_000;
  const b = await body(await handleRulePackDownload(req("/x"), "2026.10.0", d));
  assert.equal(a.data?.url, b.data?.url);
  assert.equal(w.calls.filter((c) => c.startsWith("sign:")).length, 1);
  w.clock = NOW + 301_000;
  const c = await body(await handleRulePackDownload(req("/x"), "2026.10.0", d));
  assert.notEqual(c.data?.url, a.data?.url);
});

test("다운로드: 자격 밖 AR011, 철회·없음 404, 형식 오류 422(경로 조작)", async () => {
  const notEligible = world({ eligible: [] });
  assert.equal((await body(await handleRulePackDownload(req("/x"), "2026.10.0", deps(notEligible)))).error?.code, "AR011");
  const withdrawn = world({ eligible: [], statusOf: { "2026.10.0": "withdrawn" } });
  const r = await handleRulePackDownload(req("/x"), "2026.10.0", deps(withdrawn));
  assert.equal(r.status, 404);
  assert.equal((await body(await handleRulePackDownload(req("/x"), "2099.01.0", deps(world({ eligible: [], statusOf: {} }))))).error?.code, "P0002");
  for (const bad of ["../2026.10.0", "2026.10.0%2F..", "2026.10", "2026.10.0/..", "rule-packs"]) {
    const w = world();
    const res = await handleRulePackDownload(req("/x"), bad, deps(w));
    assert.equal(res.status, 422, bad);
    assert.equal(w.calls.length, 0, "DB·저장소 호출 없음");
  }
});

test("다운로드: DB 행·저장 매니페스트가 어긋나면 500(서명값·URL 미노출)", async () => {
  const cases: Partial<World>[] = [
    { object: { ...OBJECT, storage_path: "rule-packs/2026.10.0/../../builds/x" } },
    { object: { ...OBJECT, sha256: "f".repeat(64) } },
    // 서명된 게시 시각·기준일이 DB 자격 행과 다름(감사 #1).
    { eligible: [{ ...ELIGIBLE, published_at: "2026-10-20T00:00:01+00:00" }] },
    { eligible: [{ ...ELIGIBLE, basis_date: "2026-10-15" }] },
    { manifestText: null },
    { manifestText: SIGNED.replace(SIG, SIG.split("").reverse().join("")) },
    { manifestText: signRulePackManifest({ privateKeyPem: KEY.pem, kid: "pack-a", version: "2026.10.0", publishedAt: "2026-10-20T00:00:00Z", basisDate: "2026-10-14", pack: Buffer.from("다른 본문") }) },
  ];
  for (const c of cases) {
    const w = world(c);
    const r = await handleRulePackDownload(req("/x"), "2026.10.0", deps(w));
    assert.equal(r.status, 500, JSON.stringify(Object.keys(c)));
    const text = await r.text();
    assert.ok(!text.includes(SIG) && !text.includes("supabase.co"));
    assert.equal(w.calls.filter((x) => x.startsWith("sign:")).length, 0, "서명 URL을 만들지 않는다");
  }
});

test("인증·역할·레이트 리밋", async () => {
  const unauth = world({ sessionError: new LicenseApiError("unauthorized") });
  assert.equal((await handleListRulePacks(req("/api/rule-packs"), deps(unauth))).status, 401);
  const viewer = world({ role: "viewer" });
  assert.equal((await handleRulePackDownload(req("/x"), "2026.10.0", deps(viewer))).status, 403);
  const w = world();
  const d = deps(w);
  for (let i = 0; i < LIMITS.download; i++) assert.equal((await handleRulePackDownload(req("/x"), "2026.10.0", d)).status, 200);
  const r = await handleRulePackDownload(req("/x"), "2026.10.0", d);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) > 0);
});

test("목록: 최신순, after 필터, 마지막 자격 팩, 개정 제목", async () => {
  const older = { ...ELIGIBLE, version: "2026.09.0", published_at: "2026-09-20T00:00:00+00:00" };
  const w = world({ eligible: [older, ELIGIBLE] });
  const b = await body(await handleListRulePacks(req("/api/rule-packs?after=2026.09.0"), deps(w)));
  const items = b.data?.items as { version: string; signature?: string }[];
  assert.deepEqual(items.map((i) => i.version), ["2026.10.0"]);
  assert.equal((b.data?.last_eligible as { version: string }).version, "2026.10.0");
  assert.deepEqual(b.data?.changes_after_last_eligible, [{ title: "건축법 시행령 개정", effective_from: "2026-12-01" }]);
  assert.ok(w.calls.includes("changes:2026-10-20T00:00:00+00:00"));
  assert.equal((await handleListRulePacks(req("/api/rule-packs?after=../x"), deps(world()))).status, 422);
  const none = await body(await handleListRulePacks(req("/api/rule-packs"), deps(world({ eligible: [] }))));
  assert.equal(none.data?.last_eligible, null);
});

test("단가표: 0행 204, 있으면 200", async () => {
  const empty = await handleLatestCostCatalog(req("/api/cost-catalogs/latest"), deps(world()));
  assert.equal(empty.status, 204);
  const catalog: CostCatalogRow = { version: "2026.10.0", basis_date: "2026-10-01", published_at: "2026-10-02T00:00:00Z", items: [{ code: "rc", krw_per_m2: 2_100_000 }], source_note: "공공 단가 기준", sha256: "a".repeat(64) };
  const b = await body(await handleLatestCostCatalog(req("/x"), deps(world({ catalog }))));
  assert.equal(b.data?.version, "2026.10.0");
  assert.deepEqual(b.data?.items, catalog.items);
});

test("업데이트: 204·Tauri 형식 200·자격 밖 AR010·형식 오류 422", async () => {
  const params = { target: "windows", arch: "x86_64", current: "0.1.0" };
  assert.equal((await handleUpdateManifest(req("/x"), params, deps(world()))).status, 204);
  const w = world({ eligibleBuild: BUILD });
  const r = await handleUpdateManifest(req("/x"), params, deps(w));
  assert.equal(r.status, 200);
  const m = (await r.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(m).sort(), ["notes", "pub_date", "signature", "url", "version"]);
  assert.equal(m.signature, BUILD.signature);
  assert.ok(w.calls.includes("build:windows-x86_64:0.1.0"));
  // 현재 빌드 build_date > updates_until → AR010 + 마지막 자격 버전 안내.
  const out = world({ builds: { "windows-x86_64:0.3.0": { build_date: "2027-02-01" } }, eligibleBuild: BUILD });
  const e = await body(await handleUpdateManifest(req("/x"), { ...params, current: "0.3.0" }, deps(out)));
  assert.equal(e.error?.code, "AR010");
  assert.deepEqual(e.error?.details, { last_eligible: { version: "0.2.0", download_page: "/account/licenses" } });
  for (const bad of [{ ...params, target: "linux" }, { ...params, arch: "arm" }, { ...params, current: "v1" }, { ...params, current: "1.0.0-beta" }]) {
    assert.equal((await handleUpdateManifest(req("/x"), bad, deps(world()))).status, 422);
  }
  // 저장 경로가 버전 폴더 밖이면 서명 URL을 만들지 않는다.
  const evil = world({ eligibleBuild: { ...BUILD, storage_path: "builds/stable/0.1.0/old.zip" } });
  assert.equal((await handleUpdateManifest(req("/x"), params, deps(evil))).status, 500);
});

test("로그 허용 목록: URL·토큰·서명은 형식상 통과하지 못한다", () => {
  const out = sanitizeReleaseLog({ route: "rule_pack_download", code: "https://x/?token=abc", version: "../x", reason: SIG });
  assert.deepEqual(out, { route: "rule_pack_download" });
  assert.deepEqual(sanitizeReleaseLog({ route: "update", code: "AR010", status: 403, version: "0.3.0", reason: "row_mismatch" }), {
    route: "update",
    code: "AR010",
    status: 403,
    version: "0.3.0",
    reason: "row_mismatch",
  });
});
