// POST /api/ai/review: 스위치·크기·팩 서명/해시·rule_context 일치·서버 재계산·멱등(AR-06-051 B1). 차감은 가짜 start_ai_run이 센다.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { FIXTURE_PACK_RAW, fixtureModel } from "../../../../../../packages/rules/src/test-fixtures.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { manifestStoragePath, packStoragePath, sha256Hex, signRulePackManifest } from "../../rule-packs/manifest.ts";
import type { EligibleRulePackRow } from "../../rule-packs/types.ts";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import type { RunStarter } from "../gateway/start-run.ts";
import { isReviewEnabled } from "./config.ts";
import { handleReview, REVIEW_MAX_BODY, type ReviewDeps } from "./service.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const VERSION = "2000.01.1";
const PUBLISHED = "2026-10-20T00:00:00Z";

const pair = generateKeyPairSync("ed25519");
const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pubHex = pair.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
const otherPair = generateKeyPairSync("ed25519");
const otherPem = otherPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const PACK_TEXT = JSON.stringify(FIXTURE_PACK_RAW);
const PACK_BYTES = Buffer.from(PACK_TEXT, "utf8");

function signed(pem = privatePem): string {
  return signRulePackManifest({ privateKeyPem: pem, kid: "k1", version: VERSION, publishedAt: PUBLISHED, basisDate: "2000-01-01", pack: PACK_BYTES });
}

interface World {
  enabled: boolean;
  session: GatewaySession | GatewayError;
  rows: EligibleRulePackRow[];
  files: Map<string, string>;
  pubKeys: string | undefined;
  runs: Map<string, { run_id: string; job_id: string; credits: number }>;
  charged: number;
  lastOptions: Record<string, unknown> | undefined;
}

function world(over: Partial<World> = {}): World {
  const manifest = signed();
  const sig = (JSON.parse(manifest) as { sig: string }).sig;
  return {
    enabled: true,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    rows: [
      { version: VERSION, published_at: PUBLISHED, basis_date: "2000-01-01", sha256: sha256Hex(PACK_BYTES), signature: sig, kid: "k1", bytes: PACK_BYTES.byteLength, status: "published" },
    ],
    files: new Map([
      [manifestStoragePath(VERSION), manifest],
      [packStoragePath(VERSION), PACK_TEXT],
    ]),
    pubKeys: `k1:${pubHex}`,
    runs: new Map(),
    charged: 0,
    lastOptions: undefined,
    ...over,
  };
}

let seq = 0;
function deps(w: World): ReviewDeps {
  const starter: RunStarter = {
    async startAiRun(args) {
      const existing = w.runs.get(args.p_request_id);
      if (existing) return [existing];
      w.lastOptions = args.p_options;
      seq += 1;
      const hex = seq.toString(16).padStart(12, "0");
      const row = { run_id: `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`, job_id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`, credits: 15 };
      w.runs.set(args.p_request_id, row);
      w.charged += 15;
      return [row];
    },
    async runExists(id) {
      return w.runs.has(id);
    },
  };
  return {
    enabled: () => w.enabled,
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    userRepo: () => ({ eligibleRulePacks: async () => w.rows }),
    privilegedRepo: () => ({ readSmallText: async (path) => w.files.get(path) ?? null }),
    pubKeys: () => w.pubKeys,
    starter: () => starter,
    rateLimit: new MemoryRateLimitStore(),
    now: () => Date.UTC(2026, 10, 1),
  };
}

let reqSeq = 0;
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  reqSeq += 1;
  const model = fixtureModel();
  return {
    request_id: `22222222-2222-4222-8222-${reqSeq.toString(16).padStart(12, "0")}`,
    project_ref: PROJECT,
    rule_pack_version: model.rule_context.rule_pack_version,
    application_date: model.rule_context.application_date,
    municipality_code: model.rule_context.municipality_code,
    model,
    ...over,
  };
}

function req(b: unknown): Request {
  return new Request("http://localhost/api/ai/review", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-access-token-value-0123456789" },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

async function call(w: World, b: unknown): Promise<{ status: number; json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
  const res = await handleReview(req(b), deps(w));
  return { status: res.status, json: (await res.json()) as never };
}

test("정상 경로: 202, 15 차감, 서버 재계산 결과만 options.judgment에 들어간다", async () => {
  const w = world();
  const r = await call(w, body());
  assert.equal(r.status, 202);
  assert.equal(r.json.data?.credits, 15);
  assert.equal(w.charged, 15);
  const judgment = w.lastOptions?.judgment as { rule_pack_version: string; items: unknown[] };
  assert.equal(judgment.rule_pack_version, VERSION);
  assert.ok(judgment.items.length > 0);
  assert.equal(w.lastOptions?.rule_pack_version, VERSION);
});

test("데스크톱 judgment는 버려진다(거짓 PASS를 보내도 서버 계산이 저장)", async () => {
  const w = world();
  const fake = { engine_version: "x", rule_pack_version: VERSION, application_date: "2000-03-01", pending_changes: 0, items: [{ key: "coverage", verdict: "PASS", unit: "pct", basis: [] }] };
  const r = await call(w, body({ judgment: fake }));
  assert.equal(r.status, 202);
  assert.notDeepEqual(w.lastOptions?.judgment, fake);
});

test("킬 스위치: 꺼짐 503, 차감 0 (정확히 true 문자열만 켜짐)", async () => {
  const w = world({ enabled: false });
  const r = await call(w, body());
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "ai_review_disabled");
  assert.equal(w.charged, 0);
  assert.equal(isReviewEnabled({}), false);
  assert.equal(isReviewEnabled({ ARCH_AI_REVIEW_ENABLED: "true" }), true);
  assert.equal(isReviewEnabled({ ARCH_AI_REVIEW_ENABLED: "1" }), false);
  assert.equal(isReviewEnabled({ ARCH_AI_REVIEW_ENABLED: "TRUE" }), false);
});

test("본문 256KB 초과 → 413 AR031, 차감 0", async () => {
  const w = world();
  const r = await call(w, body({ pad: "x".repeat(REVIEW_MAX_BODY) }));
  assert.equal(r.status, 413);
  assert.equal(r.json.error?.code, "AR031");
  assert.equal(w.charged, 0);
});

test("팩 서명 실패: 다른 키로 서명 · 공개키 미주입 · 모르는 kid → 503, 차감 0", async () => {
  const forged = signed(otherPem);
  const w1 = world();
  w1.files.set(manifestStoragePath(VERSION), forged);
  w1.rows[0]!.signature = (JSON.parse(forged) as { sig: string }).sig; // DB 행도 맞춰 대조는 통과 → 서명 검증에서 걸린다
  const r1 = await call(w1, body());
  assert.equal(r1.status, 503);
  assert.equal(r1.json.error?.code, "rule_pack_unavailable");

  const w2 = world({ pubKeys: undefined });
  assert.equal((await call(w2, body())).status, 503);
  const w3 = world({ pubKeys: `other:${pubHex}` });
  assert.equal((await call(w3, body())).status, 503);
  const w4 = world({ pubKeys: "k1:zz" });
  assert.equal((await call(w4, body())).status, 503);
  assert.equal(w1.charged + w2.charged + w3.charged + w4.charged, 0);
});

test("팩 본문 변조(sha256 불일치) · 매니페스트 없음 → 503", async () => {
  const w = world();
  w.files.set(packStoragePath(VERSION), PACK_TEXT.replace("테스트 팩", "테스트 팬"));
  assert.equal((await call(w, body())).status, 503);
  const w2 = world();
  w2.files.delete(manifestStoragePath(VERSION));
  assert.equal((await call(w2, body())).status, 503);
  assert.equal(w.charged + w2.charged, 0);
});

test("자격 없는 팩 버전 → 422", async () => {
  const w = world({ rows: [] });
  const r = await call(w, body());
  assert.equal(r.status, 422);
  assert.equal(w.charged, 0);
});

test("재계산 불일치: 바깥 필드가 model.rule_context와 다르면 422, 차감 0", async () => {
  const w = world();
  assert.equal((await call(w, body({ application_date: "2000-04-01" }))).status, 422);
  assert.equal((await call(w, body({ municipality_code: "T-NO" }))).status, 422);
  assert.equal((await call(w, body({ rule_pack_version: "2000.01.2" }))).status, 422);
  assert.equal(w.charged, 0);
});

test("DesignModel 모양 오류 → 422, 차감 0", async () => {
  const w = world();
  const model = fixtureModel() as unknown as Record<string, unknown>;
  delete model["site"];
  assert.equal((await call(w, body({ model }))).status, 422);
  assert.equal(w.charged, 0);
});

test("멱등: 같은 request_id 재전송은 추가 차감 없음", async () => {
  const w = world();
  const b = body();
  const a = await call(w, b);
  const c = await call(w, b);
  assert.equal(a.status, 202);
  assert.equal(c.status, 202);
  assert.equal(a.json.data?.run_id, c.json.data?.run_id);
  assert.equal(w.charged, 15);
});

test("viewer 403 · 만료 402", async () => {
  const base = { userId: USER, orgId: ORG, accessToken: "user-access-token-value-0123456789" };
  assert.equal((await call(world({ session: { ...base, role: "viewer", entitled: true } as GatewaySession }), body())).status, 403);
  assert.equal((await call(world({ session: { ...base, role: "member", entitled: false } as GatewaySession }), body())).status, 402);
});
