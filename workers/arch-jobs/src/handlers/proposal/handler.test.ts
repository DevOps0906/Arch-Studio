import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { isNarrativeCrossBorder, loadProposalConfig } from "../../config.ts";
import type { JobRow } from "../../core/db.ts";
import { JobError } from "../../core/errors.ts";
import { buildHandlers } from "../../handlers.ts";
import type { RenderStorage } from "../render/storage.ts";
import { parseContentFile, PROPOSAL_TEMPLATE_VERSION, type ContentFile } from "./content.ts";
import { createProposalHandler } from "./handler.ts";
import { AI_DRAFT_LABEL, assembleProposalHtml, formatArea, formatDecimal, formatJudgmentValue, formatKrw, LEGAL_FOOTER } from "./html.ts";
import { mockNarrativeClient } from "./mock-narrative.ts";
import { mockPdfRenderer } from "./mock-pdf-renderer.ts";
import { checkNarrative, type NarrativeClient } from "./narrative.ts";
import type { PdfRenderer } from "./pdf-renderer.ts";
import type { ProposalStorage } from "./storage.ts";
import { checkSheetSvg } from "./svg.ts";

const ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OUT = "77777777-7777-4777-8777-777777777777";
const CONTENT = `${ORG}/arch/proposal_content/44444444-4444-4444-8444-000000000001.json`;
const SHEET = `${ORG}/arch/proposal_sheet/99999999-9999-4999-8999-999999999991.svg`;

const SVG_OK =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="420mm" height="297mm" viewBox="0 0 420 297" font-family="Noto Sans KR" data-sheet-id="A-101">\n' +
  "<title>배치도 — 시험 주택</title>\n" +
  '<rect x="0" y="0" width="420" height="297" fill="#ffffff"/>\n' +
  '<g id="A-WALL" fill="none" stroke="#000000" stroke-width="0.5" stroke-dasharray="2 1">\n' +
  '<line x1="0" y1="0" x2="10" y2="10"/><polygon points="0,0 1,1 2,0"/><path d="M0 0 L1 1"/>\n' +
  '<text x="1" y="2" font-size="3" text-anchor="middle" transform="rotate(-90 1 2)">거실 &amp; 주방</text>\n' +
  "</g>\n</svg>\n";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// 눈에 띄는 수치(스냅샷 출처 검사용).
function content(): Record<string, unknown> {
  return {
    overview: { title: "시험 주택 <b>&", address: "서울시 어딘가", use: "단독주택", zone: "제2종일반주거지역", site_area_m2: 330.517 },
    judgment: {
      engine_version: "engine-1.4.0",
      rule_pack_version: "kr-2026.10",
      application_date: "2026-10-01",
      items: [
        { key: "coverage", verdict: "PASS", value: 48.236, limit: 60, unit: "pct", basis: [{ law: "건축법", article: "제55조", effective_from: "2024-01-01", ordinance: false }] },
        { key: "height", verdict: "WARN", value: 11873.4, limit: 12000, unit: "mm", basis: [] },
        { key: "parking", verdict: "FAIL", value: 1, limit: 2, unit: "count", basis: [] },
      ],
      pending_changes: 0,
    },
    area_table: { rows: [{ name: "거실", floor: "1층", area_m2: 32.4 }, { name: "침실", area_m2: 14.85 }], total_m2: 1159.367 },
    cost: { items: [{ label: "골조", amount_krw: 123456789 }], total_krw: 987654321, basis: "표준 단가" },
    notes: "남향 선호",
  };
}

function fileBytes(kind: string, c: Record<string, unknown> = content(), sheets: string[] = [sha(enc(SVG_OK))]): Uint8Array {
  return enc(JSON.stringify({ schema: "proposal_content.v1", template_version: PROPOSAL_TEMPLATE_VERSION, kind, content: c, render_ids: [], sheet_sha256: sheets }));
}

function job(kind = "proposal", bytes = fileBytes(kind), payload: Record<string, unknown> = {}): JobRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    org_id: ORG,
    queue: "arch.proposal_pdf",
    job_type: "arch.proposal_pdf",
    payload: {
      run_id: RUN,
      variant: kind === "proposal" ? "proposal" : "doc_template",
      kind,
      content_path: CONTENT,
      content_sha256: sha(bytes),
      render_ids: [],
      drawing_sheets: [SHEET],
      template_version: PROPOSAL_TEMPLATE_VERSION,
      narrative: kind === "proposal",
      ...payload,
    },
    status: "running",
    attempts: 1,
    max_attempts: 2,
    credit_ledger_id: 1,
    run_after: "",
    last_error: null,
  };
}

interface Opts {
  objects?: Map<string, Uint8Array>;
  narrative?: NarrativeClient;
  renderer?: PdfRenderer;
  failDownload?: boolean;
  renderTimeoutMs?: number;
  narrativeCrossBorder?: boolean;
}

function objectsFor(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map([
    [CONTENT, bytes],
    [SHEET, enc(SVG_OK)],
  ]);
}

async function run(j: JobRow, o: Opts = {}) {
  const objs = o.objects ?? objectsFor(fileBytes(String(j.payload?.["kind"])));
  const uploads: { bucket: string; path: string; bytes: Uint8Array }[] = [];
  const beats: string[] = [];
  const htmls: string[] = [];
  const base = o.renderer ?? mockPdfRenderer();
  const renderer: PdfRenderer = { name: base.name, render: async (r) => (htmls.push(r.html), base.render(r)) };
  const storage: ProposalStorage = {
    async download(_b, path) {
      if (o.failDownload) throw new Error("network");
      const b = objs.get(path);
      if (!b) throw new Error("not found");
      return b;
    },
    async uploadPdf(bucket, path, bytes) {
      uploads.push({ bucket, path, bytes });
    },
  };
  const handler = createProposalHandler({
    narrative: o.narrative ?? mockNarrativeClient(),
    renderer,
    storage,
    randomUUID: () => OUT,
    narrativeCrossBorder: o.narrativeCrossBorder ?? true,
    ...(o.renderTimeoutMs !== undefined ? { renderTimeoutMs: o.renderTimeoutMs } : {}),
  });
  const result = await handler({ job: j, signal: new AbortController().signal, heartbeat: async (_p, m) => void beats.push(m ?? "") });
  return { result, uploads, beats, htmls };
}

async function rejectsWith(p: Promise<unknown>, code: string, retryable = false): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof JobError && e.code === code && e.retryable === retryable);
}

function parsed(kind = "proposal", c: Record<string, unknown> = content()): ContentFile {
  const b = fileBytes(kind, c);
  const f = parseContentFile(b, sha(b));
  assert.ok(f);
  return f;
}

/** <style>·<svg>·태그를 뺀 본문 텍스트(엔티티 복원). */
function visibleText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

test("proposal 핸들러(모의): exports <org>/arch/pdf/<uuid>.pdf 저장 · 결과 4장 형식 · 단계 narrative→assemble→render", async () => {
  const { result, uploads, beats } = await run(job());
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0]?.bucket, "exports");
  assert.equal(uploads[0]?.path, `${ORG}/arch/pdf/${OUT}.pdf`);
  const r = result?.runResult as Record<string, unknown>;
  assert.equal(r.pdf_path, `${ORG}/arch/pdf/${OUT}.pdf`);
  assert.equal(r.pages, 1);
  assert.equal(r.bytes, uploads[0]?.bytes.byteLength);
  assert.equal(r.sheets_included, 1);
  assert.deepEqual(r.narrative, { model: "mock-narrative-v1", ai_label: true });
  assert.equal(new TextDecoder().decode(uploads[0]?.bytes.subarray(0, 5)), "%PDF-");
  assert.deepEqual(beats.map((m) => (JSON.parse(m) as { stage: string }).stage), ["narrative", "assemble", "render"]);
});

test("결정성: 같은 스냅샷 → 같은 HTML · 같은 PDF 바이트", async () => {
  const a = await run(job());
  const b = await run(job());
  assert.equal(a.htmls[0], b.htmls[0]);
  assert.deepEqual(a.uploads[0]?.bytes, b.uploads[0]?.bytes);
  const f = parsed();
  const n = checkNarrative({ model: "m", sections: [{ heading: "가", body: "나" }] });
  assert.equal(assembleProposalHtml({ file: f, sheets: [SVG_OK], narrative: n }), assembleProposalHtml({ file: parsed(), sheets: [SVG_OK], narrative: n }));
});

test("수치 출처: 화면 본문의 모든 숫자는 스냅샷 값(포맷)·스냅샷 문자열에서만 나온다 · 서술·템플릿에는 숫자 없음", async () => {
  const { htmls } = await run(job());
  const html = htmls[0] ?? "";
  const c = content() as {
    overview: Record<string, unknown>;
    judgment: { items: { value: number; limit: number; unit: "pct" | "mm" | "count" }[]; engine_version: string; rule_pack_version: string; application_date: string };
    area_table: { rows: { area_m2: number; floor?: string; name: string }[]; total_m2: number };
    cost: { items: { amount_krw: number }[]; total_krw: number };
  };
  const allowed: string[] = [
    formatArea(c.overview.site_area_m2 as number),
    ...c.judgment.items.flatMap((it) => [formatJudgmentValue(it.value, it.unit), formatJudgmentValue(it.limit, it.unit)]),
    ...c.area_table.rows.map((r) => formatArea(r.area_m2)),
    formatArea(c.area_table.total_m2),
    ...c.cost.items.map((it) => formatKrw(it.amount_krw)),
    formatKrw(c.cost.total_krw),
    // 스냅샷 문자열(판정 기준·근거·용도지역·층 이름)
    c.judgment.engine_version, c.judgment.rule_pack_version, c.judgment.application_date, "제55조", "2024-01-01", "제2종일반주거지역", "1층",
  ];
  const allowedRuns = new Set(allowed.flatMap((s) => s.match(/\d+/g) ?? []));
  const runs = visibleText(html).match(/\d+/g) ?? [];
  assert.ok(runs.length > 0);
  for (const r of runs) assert.ok(allowedRuns.has(r), `스냅샷에 없는 숫자: ${r}`);
  // 대표 값이 실제로 들어갔다(포맷 확인).
  for (const s of ["48.24%", "11,873mm", "1,159.37㎡", "987,654,321원", "123,456,789원"]) assert.ok(html.includes(s), s);
});

test("서술: 요약에 숫자·자유 문장 없음 · 숫자가 섞인 서술은 재시도 없이 AR032", async () => {
  const seen: unknown[] = [];
  const spy: NarrativeClient = { crossBorder: false, narrate: async (r) => (seen.push(r.summary), mockNarrativeClient().narrate(r)) };
  await run(job(), { narrative: spy });
  const summary = JSON.stringify(seen[0]);
  assert.doesNotMatch(summary, /\d/);
  assert.doesNotMatch(summary, /시험 주택|서울|남향/);

  for (const body of ["건폐율은 48% 입니다.", "용적률 ２００％", "약 一百 제곱미터", "Ⅲ 단계", "삼십 퍼센트 이내", "이층 규모", "오천만 원", "约两万", "壹拾"]) {
    const bad: NarrativeClient = { crossBorder: false, narrate: async () => ({ model: "x", sections: [{ heading: "요약", body }] }) };
    await rejectsWith(run(job(), { narrative: bad }), "AR032");
  }
});

test("서술 숫자 검사: 거짓 양성 고정 — '일반'·'이웃'·'구성'·'만족'은 통과", () => {
  for (const body of ["일반 주거지역의 이웃 건물과 조화를 이루도록 구성했습니다.", "법규 기준을 만족하는 범위에서 계획했습니다."]) {
    assert.ok(checkNarrative({ model: "m", sections: [{ heading: "요약", body }] }), body);
  }
});

test("서술 경로 불일치: 설정 oss인데 국외 클라이언트 → 부르지 않고 재시도 없이 실패", async () => {
  let calls = 0;
  const abroad: NarrativeClient = { crossBorder: true, narrate: async (r) => (calls++, mockNarrativeClient().narrate(r)) };
  await rejectsWith(run(job(), { narrative: abroad, narrativeCrossBorder: false }), "narrative_route_mismatch");
  assert.equal(calls, 0);
  await run(job(), { narrative: abroad, narrativeCrossBorder: true });
  assert.equal(calls, 1);
});

test("꼬리말 '법적 판정 아님'·도면 고지는 모든 문서 종류에 · AI 초안 표시는 서술이 있을 때만", async () => {
  for (const kind of ["proposal", "overview", "area_table", "cost"]) {
    const { htmls } = await run(job(kind));
    const html = htmls[0] ?? "";
    assert.ok(html.includes("법적 판정 아님"), kind);
    assert.ok(html.includes(LEGAL_FOOTER.slice(0, 20)), kind);
    assert.ok(html.includes("도면 고지"), kind);
    assert.equal(html.includes(AI_DRAFT_LABEL), kind === "proposal", kind);
  }
});

test("HTML: 사용자 문자열 이스케이프 · 시트 SVG 인라인(외부 참조 없음)", async () => {
  const { htmls } = await run(job());
  const html = htmls[0] ?? "";
  assert.ok(html.includes("시험 주택 &lt;b&gt;&amp;"));
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes('<section class="sheet"><svg xmlns="http://www.w3.org/2000/svg"'));
  assert.doesNotMatch(html, /<(script|link|img|iframe)\b|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
});

test("서술 호출: doc_template(overview 등)은 서술을 부르지 않음", async () => {
  let calls = 0;
  const spy: NarrativeClient = { crossBorder: false, narrate: async (r) => (calls++, mockNarrativeClient().narrate(r)) };
  const { result } = await run(job("overview"), { narrative: spy });
  assert.equal(calls, 0);
  assert.equal((result?.runResult as Record<string, unknown>).narrative, null);
});

test("입력 재검사: 내용 해시 불일치·시트 바뀜·SVG 거부·다른 조직 경로·render_ids·버전 → 재시도 없이 실패", async () => {
  const bytes = fileBytes("proposal");
  await rejectsWith(run(job("proposal", bytes, { content_sha256: "0".repeat(64) })), "bad_input");
  const changed = objectsFor(bytes);
  changed.set(SHEET, enc(SVG_OK.replace("거실", "주방")));
  await rejectsWith(run(job("proposal", bytes), { objects: changed }), "bad_input");
  const evil = '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>';
  const evilBytes = fileBytes("proposal", content(), [sha(enc(evil))]);
  const evilObjs = objectsFor(evilBytes);
  evilObjs.set(SHEET, enc(evil));
  await rejectsWith(run(job("proposal", evilBytes), { objects: evilObjs }), "bad_input");
  await rejectsWith(run(job("proposal", bytes, { drawing_sheets: [`eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/arch/proposal_sheet/99999999-9999-4999-8999-999999999991.svg`] })), "bad_payload");
  await rejectsWith(run(job("proposal", bytes, { render_ids: ["bbbbbbbb-bbbb-4bbb-8bbb-000000000001"] })), "unsupported_render_ids");
  await rejectsWith(run(job("proposal", bytes, { template_version: "proposal-v0" })), "unsupported_template");
  await rejectsWith(run(job("proposal", bytes, { variant: "doc_template" })), "bad_payload");
  const extra = content();
  (extra.overview as Record<string, unknown>).secret = "x";
  const extraBytes = fileBytes("proposal", extra);
  await rejectsWith(run(job("proposal", extraBytes), { objects: objectsFor(extraBytes) }), "bad_input");
});

test("재시도 분류: 내려받기 실패·서술 일시 오류는 재시도 · 렌더러 예외·120초 초과·PDF 아닌 출력은 재시도 없음(04_API 공용 WeasyPrint 행)", async () => {
  await rejectsWith(run(job(), { failDownload: true }), "storage", true);
  const down: NarrativeClient = { crossBorder: false, narrate: async () => Promise.reject(new Error("503")) };
  await rejectsWith(run(job(), { narrative: down }), "AI_UNAVAILABLE", true);
  const failing: PdfRenderer = { name: "x", render: async () => Promise.reject(new Error("boom")) };
  await rejectsWith(run(job(), { renderer: failing }), "pdf_render");
  const flaky: PdfRenderer = { name: "x", render: async () => Promise.reject(new JobError("x", { retryable: true, code: "net" })) };
  await rejectsWith(run(job(), { renderer: flaky }), "net");
  const slow: PdfRenderer = { name: "x", render: (r) => new Promise((_, reject) => r.signal.addEventListener("abort", () => reject(r.signal.reason))) };
  await rejectsWith(run(job(), { renderer: slow, renderTimeoutMs: 20 }), "pdf_timeout");
  const notPdf: PdfRenderer = { name: "x", render: async () => ({ pdf: enc("<html>"), pages: 1 }) };
  await rejectsWith(run(job(), { renderer: notPdf }), "AR032");
});

// 웹 service.test.ts의 SVG_CASES 중 대표(바꾸면 양쪽 함께).
test("SVG 허용 목록(워커 사본): 작성기 출력 통과 · 위험 요소 거부", () => {
  assert.equal(checkSheetSvg(SVG_OK).ok, true);
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="x"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x.example/a.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#a)"/></svg>',
    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    // 리뷰 반영: 문자 참조·CSS 이스케이프 우회
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#117;rl(http://169.254.169.254/x)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="&#x75;rl(http://169.254.169.254/x)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="\\75 rl(http://169.254.169.254/x)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect x="java&#115;cript:1"/></svg>',
  ]) {
    assert.equal(checkSheetSvg(bad).ok, false, bad);
  }
});

test("포맷: 로캘 무관 천 단위·고정 소수", () => {
  assert.equal(formatDecimal(1234567.891, 2), "1,234,567.89");
  assert.equal(formatDecimal(-0.001, 2), "0.00");
  assert.equal(formatKrw(1000), "1,000원");
  assert.equal(formatJudgmentValue(undefined, "pct"), "—");
  assert.equal(formatJudgmentValue(1, "bool"), "예");
});

// 웹 apps/web/src/server/ai/proposal/service.test.ts의 PROPOSAL_CONFIG_CASES와 같은 표(바꾸면 양쪽 함께). [env, 켜짐]
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

// 웹 service.test.ts의 NARRATIVE_ROUTE_CASES와 같은 표(바꾸면 양쪽 함께). [env, 국외]
const NARRATIVE_ROUTE_CASES: readonly [Record<string, string | undefined>, boolean][] = [
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "oss" }, false],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "OSS" }, true],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "commercial" }, true],
  [{ ARCH_PROPOSAL_NARRATIVE_ROUTE: "" }, true],
  [{}, true],
];

test("서술 경로 해석: 웹과 같은 표 — 'oss'만 국외 아님 · 설정에 반영", () => {
  for (const [env, expected] of NARRATIVE_ROUTE_CASES) {
    assert.equal(isNarrativeCrossBorder(env), expected, JSON.stringify(env));
    assert.equal(loadProposalConfig(env).narrativeCrossBorder, expected, JSON.stringify(env));
  }
});

test("설정·등록: 웹과 같은 표 — 켜짐일 때만 arch.proposal_pdf 등록(아니면 큐 claim 안 함)", () => {
  const renderStorage = (): RenderStorage => ({ download: async () => new Uint8Array(), uploadPng: async () => undefined });
  const proposalStorage = (): ProposalStorage => ({ download: async () => new Uint8Array(), uploadPdf: async () => undefined });
  for (const [env, expected] of PROPOSAL_CONFIG_CASES) {
    const c = loadProposalConfig(env);
    assert.equal(c.enabled && c.provider !== null, expected, JSON.stringify(env));
    assert.equal("arch.proposal_pdf" in buildHandlers(env, renderStorage, proposalStorage), expected, JSON.stringify(env));
  }
});
