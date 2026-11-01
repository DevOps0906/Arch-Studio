// POST /api/ai/proposal: 스위치·동의·시트 재검사·내용 해시·멱등·같은 버전 재요청 0(AR-06-032 1단계). 차감은 가짜 start_ai_run이 센다.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { GatewayError } from "../gateway/http.ts";
import type { GatewaySession } from "../gateway/session.ts";
import type { RunStarter } from "../gateway/start-run.ts";
import { MemoryRateLimitStore } from "../../licenses/rate-limit.ts";
import { isNarrativeCrossBorder, isProposalEnabled } from "./config.ts";
import { buildContentFile, canonicalJson, PROPOSAL_TEMPLATE_VERSION, sha256Hex } from "./content.ts";
import { handleProposal, type ProposalDeps } from "./service.ts";
import { checkSheetSvg, SHEET_MAX_BYTES } from "./svg.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ORG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const SHEET_A = `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999991.svg`;
const SHEET_B = `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999992.svg`;
const NOW = Date.UTC(2026, 10, 1, 3, 0, 0);

const SVG_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="420mm" height="297mm" viewBox="0 0 420 297" font-family="Noto Sans KR" data-sheet-id="A-101">\n' +
  "<title>배치도 — 시험 주택</title>\n" +
  '<rect x="0" y="0" width="420" height="297" fill="#ffffff"/>\n' +
  '<g id="A-WALL" fill="none" stroke="#000000" stroke-width="0.5" stroke-dasharray="2 1">\n' +
  '<line x1="0" y1="0" x2="10" y2="10"/><polygon points="0,0 1,1 2,0"/><path d="M0 0 L1 1"/>\n' +
  '<text x="1" y="2" font-size="3" text-anchor="middle" transform="rotate(-90 1 2)">거실 &amp; 주방</text>\n' +
  "</g>\n</svg>\n";

const enc = (s: string) => new TextEncoder().encode(s);

function content(): Record<string, unknown> {
  return {
    overview: { title: "시험 주택", address: "서울시 어딘가", use: "단독주택", zone: "제2종일반주거지역", site_area_m2: 330.5 },
    judgment: {
      engine_version: "engine-1.4.0",
      rule_pack_version: "kr-2026.10",
      application_date: "2026-10-01",
      items: [{ key: "coverage", verdict: "PASS", value: 48.2, limit: 60, unit: "pct", basis: [{ law: "건축법", article: "제55조", effective_from: "2024-01-01", ordinance: false }] }],
      pending_changes: 0,
    },
    area_table: { rows: [{ name: "거실", floor: "1층", area_m2: 32.4 }], total_m2: 159.36 },
    cost: { items: [{ label: "골조", amount_krw: 120000000 }], total_krw: 120000000 },
  };
}

interface World {
  enabled: boolean;
  crossBorder: boolean;
  session: GatewaySession | GatewayError;
  features: Record<string, unknown>;
  ack: boolean;
  objects: Map<string, Uint8Array>;
  storageFails?: boolean;
  /** 가짜 DB: request_id → 실행. doc_template은 같은 content_sha256·template_version 이력이 있으면 0크레딧(start_ai_run proposal 분기). */
  runs: Map<string, { run_id: string; job_id: string; credits: number }>;
  docHistory: Set<string>;
  puts: Map<string, Uint8Array>;
  options: Record<string, unknown>[];
  charged: number;
  starterCalls: number;
  storeCalls: number;
}

function world(over: Partial<World> = {}): World {
  return {
    enabled: true,
    crossBorder: true,
    session: { userId: USER, orgId: ORG, role: "member", entitled: true, accessToken: "user-access-token-value-0123456789" },
    features: { ai_render: true },
    ack: true,
    objects: new Map([
      [SHEET_A, enc(SVG_OK)],
      [SHEET_B, enc(SVG_OK)],
    ]),
    runs: new Map(),
    docHistory: new Set(),
    puts: new Map(),
    options: [],
    charged: 0,
    starterCalls: 0,
    storeCalls: 0,
    ...over,
  };
}

let seq = 0;
function fakeStarter(w: World): RunStarter {
  return {
    async startAiRun(args) {
      w.starterCalls += 1;
      const existing = w.runs.get(args.p_request_id);
      if (existing) return [existing];
      w.options.push(args.p_options);
      const sha = String(args.p_options.content_sha256);
      const version = String(args.p_options.template_version);
      let credits = args.p_variant === "proposal" ? 10 : 1;
      if (args.p_variant === "doc_template" && w.docHistory.has(`${sha}:${version}`)) credits = 0;
      if (args.p_variant === "doc_template") w.docHistory.add(`${sha}:${version}`); // 가짜: 바로 succeeded로 본다
      seq += 1;
      const hex = seq.toString(16).padStart(12, "0");
      const row = { run_id: `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`, job_id: `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`, credits };
      w.runs.set(args.p_request_id, row);
      w.charged += credits;
      return [row];
    },
    async runExists(requestId) {
      return w.runs.has(requestId);
    },
  };
}

let uuidSeq = 0;
function deps(w: World): ProposalDeps {
  return {
    enabled: () => w.enabled,
    narrativeCrossBorder: () => w.crossBorder,
    session: {
      async resolve() {
        if (w.session instanceof GatewayError) throw w.session;
        return w.session;
      },
    },
    org: () => ({ orgFeatures: async () => w.features, hasCrossBorderAck: async () => w.ack }),
    store: () => ({
      async size(path) {
        w.storeCalls += 1;
        if (w.storageFails) throw new Error(`storage 500 ${path} service_role=secret`);
        return w.objects.get(path)?.byteLength ?? null;
      },
      async read(path) {
        w.storeCalls += 1;
        return w.objects.get(path) ?? new Uint8Array();
      },
      async putContent(path, bytes) {
        w.storeCalls += 1;
        w.puts.set(path, bytes);
      },
    }),
    starter: () => fakeStarter(w),
    rateLimit: new MemoryRateLimitStore(),
    now: () => NOW,
    randomUUID: () => {
      uuidSeq += 1;
      return `44444444-4444-4444-8444-${uuidSeq.toString(16).padStart(12, "0")}`;
    },
  };
}

let reqSeq = 0;
function rid(): string {
  reqSeq += 1;
  return `22222222-2222-4222-8222-${reqSeq.toString(16).padStart(12, "0")}`;
}

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { request_id: rid(), project_ref: PROJECT, kind: "proposal", content: content(), render_ids: [], drawing_sheets: [SHEET_A], ...over };
}

function req(b: unknown): Request {
  return new Request("http://localhost/api/ai/proposal", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer user-access-token-value-0123456789" },
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

function quiet(t: TestContext): string[] {
  const lines: string[] = [];
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, (...a: unknown[]) => void lines.push(a.join(" ")));
  return lines;
}

async function call(w: World, b: unknown = body(), d: ProposalDeps = deps(w)): Promise<{ status: number; json: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
  const res = await handleProposal(req(b), d);
  return { status: res.status, json: (await res.json()) as never };
}

test("proposal: 정상 → 202 · variant proposal 10 · options는 경로·해시·버전만(본문 수치 없음) · 내용 파일 해시 일치", async (t) => {
  quiet(t);
  const w = world();
  const r = await call(w);
  assert.equal(r.status, 202);
  assert.deepEqual(Object.keys(r.json.data ?? {}).sort(), ["credits", "job_id", "run_id"]);
  assert.equal(w.charged, 10);
  const opt = w.options[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(opt).sort(), ["content_path", "content_sha256", "doc_kind", "drawing_sheets", "render_ids", "template_version"]);
  assert.equal(opt.template_version, PROPOSAL_TEMPLATE_VERSION);
  assert.match(String(opt.content_path), new RegExp(`^${ORG}/arch/proposal_content/[0-9a-f-]{36}\\.json$`));
  const stored = w.puts.get(String(opt.content_path));
  assert.ok(stored);
  assert.equal(sha256Hex(stored), opt.content_sha256);
  const doc = JSON.parse(new TextDecoder().decode(stored)) as Record<string, unknown>;
  assert.deepEqual(doc.sheet_sha256, [sha256Hex(enc(SVG_OK))]);
  assert.deepEqual(doc.content, content());
});

// 워커 handler.test.ts의 PROPOSAL_CONFIG_CASES와 같은 표(바꾸면 양쪽 함께). [env, 켜짐]
const PROPOSAL_CONFIG_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "development" }, true],
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "test" }, true],
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "production" }, false],
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", ARCH_PROPOSAL_PROVIDER: "mock" }, false],
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", NODE_ENV: "development" }, false],
  [{ ARCH_AI_PROPOSAL_ENABLED: "true", ARCH_PROPOSAL_PROVIDER: "weasyprint", NODE_ENV: "production" }, false],
  [{ ARCH_AI_PROPOSAL_ENABLED: "TRUE", ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_AI_PROPOSAL_ENABLED: "1", ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_PROPOSAL_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{ ARCH_AI_RENDER_ENABLED: "true", ARCH_RENDER_PROVIDER: "mock", NODE_ENV: "development" }, false],
  [{}, false],
];

// 워커 handler.test.ts의 NARRATIVE_ROUTE_CASES와 같은 표(바꾸면 양쪽 함께). [env, 국외]
const NARRATIVE_ROUTE_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "oss" }, false],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "OSS" }, true],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "commercial" }, true],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "" }, true],
  [{}, true],
];

test("스위치: 'true' + dev·test의 mock일 때만 켬 — 워커와 같은 표 · 서술 경로는 'oss'만 국외 아님(워커와 같은 표)", () => {
  for (const [env, expected] of PROPOSAL_CONFIG_CASES) assert.equal(isProposalEnabled(env), expected, JSON.stringify(env));
  for (const [env, expected] of NARRATIVE_ROUTE_CASES) assert.equal(isNarrativeCrossBorder(env), expected, JSON.stringify(env));
});

test("스위치 off → 503 ai_proposal_disabled · 세션·저장소·start_ai_run 호출 0 · 차감 0", async (t) => {
  quiet(t);
  const w = world({ enabled: false, session: new GatewayError("unauthorized") });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(r.json.error?.code, "ai_proposal_disabled");
  assert.equal(w.starterCalls, 0);
  assert.equal(w.storeCalls, 0);
  assert.equal(w.charged, 0);
});

test("동의 없음 + 서술 국외 제공자 → 403 AI002 · 저장소·start_ai_run 0 · 차감 0", async (t) => {
  quiet(t);
  const w = world({ ack: false, crossBorder: true });
  const r = await call(w);
  assert.equal(r.status, 403);
  assert.equal(r.json.error?.code, "AI002");
  assert.equal(w.starterCalls, 0);
  assert.equal(w.storeCalls, 0);
  assert.equal(w.charged, 0);
});

test("동의 없음이어도: 서술 경로 oss(proposal) · 템플릿 문서(overview·area_table·cost)는 202", async (t) => {
  quiet(t);
  assert.equal((await call(world({ ack: false, crossBorder: false }))).status, 202);
  for (const kind of ["overview", "area_table", "cost"]) {
    const w = world({ ack: false, crossBorder: true });
    const r = await call(w, body({ kind }));
    assert.equal(r.status, 202, kind);
    assert.equal(w.charged, 1);
  }
});

test("같은 버전 재요청: doc_template 같은 내용·같은 시트 바이트(경로 달라도) → 0크레딧 · 같은 request_id 재전송 → 추가 차감 0", async (t) => {
  quiet(t);
  const w = world();
  const first = body({ kind: "overview", drawing_sheets: [SHEET_A] });
  assert.equal((await call(w, first)).status, 202);
  assert.equal(w.charged, 1);
  const again = await call(w, body({ kind: "overview", drawing_sheets: [SHEET_B] })); // 다른 request_id·다른 경로, 같은 바이트
  assert.equal(again.status, 202);
  assert.equal(again.json.data?.credits, 0);
  assert.equal(w.charged, 1);
  assert.equal(w.options[0]?.content_sha256, w.options[1]?.content_sha256);
  const replay = await call(w, first);
  assert.equal(replay.status, 202);
  assert.equal(w.charged, 1);

  // 내용이 바뀌면 해시가 달라 다시 1크레딧
  const changed = content();
  (changed.area_table as { total_m2: number }).total_m2 = 160;
  assert.equal((await call(w, body({ kind: "overview", content: changed }))).status, 202);
  assert.equal(w.charged, 2);
});

test("proposal(서술 포함)은 같은 request_id 재전송만 0 — 새 요청은 10(DB 규칙: 0크레딧은 doc_template만)", async (t) => {
  quiet(t);
  const w = world();
  const first = body();
  await call(w, first);
  await call(w, first);
  assert.equal(w.charged, 10);
  await call(w, body());
  assert.equal(w.charged, 20);
});

test("내용 해시: 키 순서와 무관하게 같음 · 시트 순서·바이트가 다르면 다름", () => {
  const c = content() as never;
  const a = buildContentFile({ kind: "overview", content: c, renderIds: [], sheetSha256: ["a".repeat(64), "b".repeat(64)] });
  const reordered = JSON.parse(canonicalJson(c)) as never;
  const b = buildContentFile({ kind: "overview", content: reordered, renderIds: [], sheetSha256: ["a".repeat(64), "b".repeat(64)] });
  assert.equal(a.sha256, b.sha256);
  assert.notEqual(a.sha256, buildContentFile({ kind: "overview", content: c, renderIds: [], sheetSha256: ["b".repeat(64), "a".repeat(64)] }).sha256);
  assert.notEqual(a.sha256, buildContentFile({ kind: "area_table", content: c, renderIds: [], sheetSha256: ["a".repeat(64), "b".repeat(64)] }).sha256);
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }] }), '{"a":[2,{"c":"x"}],"b":1}');
});

test("시트: 다른 조직·다른 목적·없는 객체 → 422 23514 · 2MB 초과 413 AR031 · 차감 0", async (t) => {
  quiet(t);
  const otherOrg = `${OTHER_ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999991.svg`;
  const otherPurpose = `${ORG}/arch/render_input/99999999-9999-4999-8999-999999999991.png`;
  const absent = `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999993.svg`;
  for (const p of [otherOrg, otherPurpose, absent]) {
    const w = world();
    const r = await call(w, body({ drawing_sheets: [p] }));
    assert.equal(r.status, 422, p);
    assert.equal(r.json.error?.code, "23514");
    assert.equal(w.charged, 0);
    assert.equal(w.puts.size, 0);
  }
  const big = world();
  big.objects.set(SHEET_A, new Uint8Array(SHEET_MAX_BYTES + 1));
  const r = await call(big);
  assert.equal(r.status, 413);
  assert.equal(r.json.error?.code, "AR031");
  assert.equal(big.charged, 0);
});

// 워커 svg 검사와 같은 표(바꾸면 양쪽 함께). [svg, 통과]
const SVG_CASES: readonly [string, boolean][] = [
  [SVG_OK, true],
  [`<?xml version="1.0" encoding="UTF-8"?>\n${SVG_OK}`, true],
  ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><a href="https://x.example"><rect/></a></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.example/a.png"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://x.example/#a)"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(x)</style></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:red"/></svg>', false],
  ['<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><!-- c --></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><g></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>', false],
  ['<svg xmlns="http://www.w3.org/1999/xhtml"></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg" xlink:href="x"></svg>', false],
  ['<g></g>', false],
  ["텍스트<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" x="2"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect x="javascript:1"/></svg>', false],
  // 리뷰 반영: 문자 참조·CSS 이스케이프 우회
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#117;rl(http://169.254.169.254/x)"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#x75;rl(http://169.254.169.254/x)"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\75 rl(http://169.254.169.254/x)"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><rect x="java&#115;cript:1"/></svg>', false],
  ['<svg xmlns="http://www.w3.org/2000/svg"><text x="1">A&#38;B</text></svg>', true],
];

test("SVG 허용 목록: 작성기 출력 통과 · script·foreignObject·이벤트·외부 href·url()·style·엔티티·주석 거부", () => {
  for (const [svg, ok] of SVG_CASES) assert.equal(checkSheetSvg(svg).ok, ok, svg.slice(0, 80));
});

test("SVG 검사 실패 → 422 proposal_sheet_rejected · 내용 파일·차감 0", async (t) => {
  quiet(t);
  const w = world();
  w.objects.set(SHEET_A, enc('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'));
  const r = await call(w);
  assert.equal(r.status, 422);
  assert.equal(r.json.error?.code, "proposal_sheet_rejected");
  assert.equal(w.puts.size, 0);
  assert.equal(w.charged, 0);
});

test("render_ids 있음 → 422 22023(1단계 범위 밖) · 차감 0", async (t) => {
  quiet(t);
  const w = world();
  const r = await call(w, body({ render_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-000000000001"] }));
  assert.equal(r.status, 422);
  assert.equal(r.json.error?.code, "22023");
  assert.equal(w.charged, 0);
});

test("본문: 모르는 키·공사비 문서에 cost 없음·시트 7장·중복 시트·금액 소수 → 422 · 깨진 JSON 400 · 512KB 초과 413", async (t) => {
  quiet(t);
  const noCost = content();
  delete noCost.cost;
  const fractional = content();
  (fractional.cost as { total_krw: number }).total_krw = 1.5;
  const sheets7 = Array.from({ length: 7 }, (_, i) => `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-99999999999${i}.svg`);
  for (const b of [body({ org_id: OTHER_ORG }), body({ credits: 0 }), body({ kind: "cost", content: noCost }), body({ drawing_sheets: sheets7 }), body({ drawing_sheets: [SHEET_A, SHEET_A] }), body({ content: fractional })]) {
    const w = world();
    assert.equal((await call(w, b)).status, 422);
    assert.equal(w.starterCalls, 0);
  }
  assert.equal((await call(world(), "{")).status, 400);
  const huge = content();
  huge.notes = "가".repeat(2000);
  (huge.area_table as { rows: unknown[] }).rows = Array.from({ length: 200 }, () => ({ name: "가".repeat(60), floor: "가".repeat(20), area_m2: 1 }));
  const big = body({ content: huge, pad: "x".repeat(600 * 1024) });
  assert.equal((await call(world(), big)).status, 413);
});

test("권한: viewer 403 · 엔타이틀먼트 만료 402 · ai_render 없음 402 · 세션 없음 401", async (t) => {
  quiet(t);
  const s = { userId: USER, orgId: ORG, entitled: true, accessToken: "user-access-token-value-0123456789" };
  assert.equal((await call(world({ session: { ...s, role: "viewer" } }))).status, 403);
  assert.equal((await call(world({ session: { ...s, role: "member", entitled: false } }))).status, 402);
  assert.equal((await call(world({ features: { ai_render: false } }))).status, 402);
  assert.equal((await call(world({ session: new GatewayError("unauthorized") }))).status, 401);
});

test("저장소 오류 → 503 storage_unavailable · 원문 로그 0 · 차감 0", async (t) => {
  const lines = quiet(t);
  const w = world({ storageFails: true });
  const r = await call(w);
  assert.equal(r.status, 503);
  assert.equal(w.charged, 0);
  assert.ok(!lines.join("\n").includes("secret"));
  assert.ok(!lines.join("\n").includes("proposal_sheet"));
});

test("레이트 리밋: 조직 20회/분 초과 429", async (t) => {
  quiet(t);
  const w = world({ ack: false }); // 동의 거부로 차감 없이 레이트만 센다
  const d = deps(w);
  for (let i = 0; i < 20; i += 1) assert.equal((await call(w, body(), d)).status, 403);
  assert.equal((await call(w, body(), d)).status, 429);
});
