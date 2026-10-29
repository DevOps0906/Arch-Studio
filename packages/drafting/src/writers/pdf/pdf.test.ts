// PDF 작성기·TTF 파서·글꼴 폭 표·PNG 자리 테스트(AR-06-022).
// PDF는 바이트 골든을 두지 않는다: jsPDF 버전이 바뀌면 같은 그림이어도 바이트가 바뀐다(객체 번호·정밀도·Producer).
// 대신 구조(쪽 수·쪽 크기·문자열·메타데이터)와 결정성(같은 입력 2회·별개 프로세스·다른 TZ에서 바이트 동일, 압축 켬/끔)을 본다.
// 한글 글꼴: 저장소에 글꼴 파일을 넣지 않는다. ARCH_TEST_KR_FONT(TTF 경로) 또는 시스템 NanumGothic이 있으면 시험하고 없으면 건너뛴다.
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- 별개 프로세스 결정성 시험
import { execFileSync } from "node:child_process";
// eslint-disable-next-line no-restricted-imports -- 해시
import { createHash } from "node:crypto";
// eslint-disable-next-line no-restricted-imports -- 시스템 글꼴(있을 때만) 읽기, 생성 스크립트 시험용 임시 폴더
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// eslint-disable-next-line no-restricted-imports -- 임시 폴더
import { tmpdir } from "node:os";
// eslint-disable-next-line no-restricted-imports -- 테스트는 Node 테스트 러너만 쓴다
import { test } from "node:test";
import fc from "fast-check";
import { CASES } from "../../../golden/_harness/cases.ts";
import { DISCLAIMER, DraftingError, type SheetModel } from "../../index.ts";
import { writePng } from "../png/index.ts";
import {
  advanceOf,
  base64,
  buildFontMetrics,
  fontMetricsJson,
  measureText,
  OutputError,
  parseTtf,
  PDF_DEFAULT_CREATION_DATE,
  PDF_WRITER_VERSION,
  writePdf,
  type FontMetrics,
  type TtfInfo,
} from "./index.ts";
import { buildTestTtf } from "./test-ttf.ts";

const sheet = (id: string): SheetModel => (CASES.find((c) => c.id === id) as (typeof CASES)[number]).build().sheet;
const latin1 = (u8: Uint8Array) => Buffer.from(u8).toString("latin1");
const sha = (u8: Uint8Array) => createHash("sha256").update(u8).digest("hex");

function firstExisting(paths: Array<string | undefined>): Uint8Array | null {
  for (const p of paths) if (p !== undefined && p !== "" && existsSync(p)) return new Uint8Array(readFileSync(p));
  return null;
}
const KR = firstExisting([
  // eslint-disable-next-line no-restricted-properties -- 테스트는 한글 글꼴 경로를 환경 변수로 받는다
  process.env.ARCH_TEST_KR_FONT,
  "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
  "/usr/share/fonts/truetype/nanum/NanumGothic-Regular.ttf",
  "/Library/Fonts/NanumGothic.ttf",
  "C:/Windows/Fonts/NanumGothic.ttf",
]);
const LATIN = firstExisting([
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
]);

const BUNDLE = ["writer-site-a3-basic", "writer-floor-a1-portrait", "writer-area-a2-landscape", "writer-blocks-inserts", "writer-hatch-ansi31"].map(sheet);

test("시트 묶음: 쪽 수·쪽 크기(용지 mm → pt)·메타데이터(고정 생성 시각·파일 ID·작성기 버전)", () => {
  const r = writePdf(BUNDLE, { compress: false });
  const t = latin1(r.bytes);
  assert.ok(t.startsWith("%PDF-1.3"));
  assert.ok(t.trimEnd().endsWith("%%EOF"));
  assert.equal(r.page_count, 5);
  assert.match(t, /\/Type \/Pages\n\/Kids \[[^\]]+\]\n\/Count 5\n/);
  const boxes = [...t.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const pt = (mm: number) => (mm * 72) / 25.4;
  assert.equal(boxes.length, 5);
  BUNDLE.forEach((s, i) => {
    assert.ok(Math.abs((boxes[i]?.[0] as number) - pt(s.paper.w / 100)) < 0.01, `쪽 ${i + 1} 폭`);
    assert.ok(Math.abs((boxes[i]?.[1] as number) - pt(s.paper.h / 100)) < 0.01, `쪽 ${i + 1} 높이`);
  });
  assert.ok(t.includes(`/CreationDate (${PDF_DEFAULT_CREATION_DATE})`));
  assert.ok(t.includes(`/Creator (Arch Studio drafting ${PDF_WRITER_VERSION})`));
  assert.ok(t.includes("/Producer (jsPDF 4.2.1)"));
  assert.ok(!/\/ModDate/.test(t));
  const id = t.match(/\/ID \[ <([0-9A-F]{32})> <([0-9A-F]{32})> \]/);
  assert.ok(id && id[1] === id[2], "파일 ID");
  // 파일 ID는 시트 묶음에서 나온다: 순서가 바뀌면 ID도 바뀐다.
  const other = latin1(writePdf([...BUNDLE].reverse(), { compress: false }).bytes).match(/\/ID \[ <([0-9A-F]{32})>/);
  assert.notEqual(other?.[1], id?.[1]);
});

test("결정성: 같은 입력 2회 → 같은 바이트(압축 켬·끔), 복제 입력도 같음", () => {
  for (const compress of [true, false]) {
    const a = writePdf(BUNDLE, { compress }).bytes;
    const b = writePdf(structuredClone(BUNDLE), { compress }).bytes;
    assert.equal(sha(a), sha(b), `compress=${compress}`);
  }
  const on = writePdf(BUNDLE).bytes;
  const off = writePdf(BUNDLE, { compress: false }).bytes;
  assert.ok(on.length < off.length, "기본은 압축");
  assert.ok(latin1(on).includes("/FlateDecode"));
  assert.ok(!latin1(off).includes("/FlateDecode"));
});

test("결정성: 별개 프로세스·다른 TZ(UTC, Asia/Seoul, America/New_York)에서도 같은 바이트(압축 켬·끔)", () => {
  const mod = (p: string) => JSON.stringify(new URL(p, import.meta.url).href);
  const code = [
    `import { writePdf } from ${mod("./index.ts")};`,
    `import { CASES } from ${mod("../../../golden/_harness/cases.ts")};`,
    `import { createHash } from "node:crypto";`,
    `const ids = ${JSON.stringify(["writer-site-a3-basic", "writer-floor-a1-portrait", "writer-area-a2-landscape", "writer-blocks-inserts", "writer-hatch-ansi31"])};`,
    `const sheets = ids.map((id) => CASES.find((c) => c.id === id).build().sheet);`,
    `for (const compress of [true, false]) console.log(createHash("sha256").update(writePdf(sheets, { compress }).bytes).digest("hex"));`,
  ].join("\n");
  const here = [sha(writePdf(BUNDLE).bytes), sha(writePdf(BUNDLE, { compress: false }).bytes)].join("\n") + "\n";
  for (const TZ of ["UTC", "Asia/Seoul", "America/New_York"]) {
    // eslint-disable-next-line no-restricted-properties -- 자식 프로세스에 환경을 넘기고 TZ만 바꾼다
    const env = { ...process.env, TZ };
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { env, encoding: "utf8" });
    assert.equal(out, here, TZ);
  }
});

test("생성 시각 주입: CreationDate 값만 바뀐다, 형식이 틀리면 INVALID_ARGUMENT", () => {
  const a = latin1(writePdf(BUNDLE, { compress: false }).bytes);
  const b = latin1(writePdf(BUNDLE, { compress: false, creation_date: "D:20261029123000+09'00'" }).bytes);
  assert.notEqual(a, b);
  assert.ok(b.includes("/CreationDate (D:20261029123000+09'00')"));
  const mask = (s: string) => s.replace(/\/CreationDate \([^)]*\)/, "/CreationDate (<masked>)");
  assert.equal(mask(a), mask(b));
  assert.throws(() => writePdf(BUNDLE, { creation_date: "2026-10-29" }), DraftingError);
});

test("글꼴 없음 → helvetica 대체 + AR057, 라틴 1 밖 글자는 ?로(한글 깨진 바이트 없음)", () => {
  const r = writePdf([sheet("writer-korean-long-names")], { compress: false });
  assert.deepEqual(r.font, { family: "helvetica", embedded: false });
  assert.equal(r.warnings.length, 2);
  assert.ok(r.warnings.every((w) => w.code === "AR057"));
  assert.match(r.warnings[0]?.detail as string, /주입되지 않아/);
  assert.match(r.warnings[1]?.detail as string, /\?로 바꿨습니다/);
  const t = latin1(r.bytes);
  assert.ok(t.includes("/BaseFont /Helvetica"));
  assert.ok(!t.includes("/FontFile2"));
  assert.ok(t.includes("(1/") || t.includes("1/"), "축척 문자");
});

test("읽을 수 없는 글꼴(TTF 아님·CFF·잘림) → 대체 + AR057, 쓸 수 없는 글꼴 이름 → INVALID_ARGUMENT", () => {
  const s = [sheet("writer-site-a3-basic")];
  for (const [ttf, re] of [
    [new Uint8Array([1, 2, 3]), /너무 짧음/],
    [buildTestTtf({ tag: 0x4f54544f }), /CFF/],
    [buildTestTtf().slice(0, 60), /파일 밖|잘렸/],
  ] as const) {
    const r = writePdf(s, { font: { family: "X", ttf } });
    assert.equal(r.font.embedded, false);
    assert.match(r.warnings[0]?.detail as string, re);
  }
  assert.throws(() => writePdf(s, { font: { family: "a/b", ttf: buildTestTtf() } }), DraftingError);
  assert.throws(() => writePdf(s, { font: { family: " ", ttf: buildTestTtf() } }), DraftingError);
});

test("입력 오류: 빈 묶음·고지 없는 시트·유한하지 않은 좌표는 DraftingError, jsPDF 실패(해석 못 하는 TTF)는 OutputError(AR056)", () => {
  assert.throws(() => writePdf([]), DraftingError);
  const noDisc = sheet("writer-site-a3-basic");
  noDisc.paper_prims = noDisc.paper_prims.filter((p) => !(p.t === "text" && p.s === DISCLAIMER));
  assert.throws(() => writePdf([noDisc]), (e: unknown) => e instanceof DraftingError && e.code === "DISCLAIMER_MISSING");
  const bad = sheet("writer-site-a3-basic");
  (bad.views[0] as SheetModel["views"][number]).prims.push({ layer: "A-WALL", key: "zz", t: "line", a: [0, 0], b: [Number.POSITIVE_INFINITY, 0] });
  assert.throws(() => writePdf([bad]), (e: unknown) => e instanceof DraftingError && e.code === "INVALID_ARGUMENT" && !(e instanceof OutputError));
  // 파서는 통과하지만 jsPDF가 임베드하지 못하는 TTF(윤곽·OS/2·post 없음).
  assert.throws(
    () => writePdf([sheet("writer-site-a3-basic")], { font: { family: "T", ttf: buildTestTtf({ format12: true }) } }),
    (e: unknown) => e instanceof OutputError && e instanceof DraftingError && e.user_code === "AR056" && e.failure === "pdf_failed",
  );
});

test("라틴 TTF 주입(시스템 글꼴이 있을 때): 임베드(FontFile2·Identity-H), 한글은 없는 글자로 AR057", { skip: LATIN === null && "시스템 라틴 TTF 없음" }, () => {
  const ttf = LATIN as Uint8Array;
  const r = writePdf([sheet("writer-site-a3-basic")], { compress: false, font: { family: "TestLatin", ttf } });
  assert.deepEqual(r.font, { family: "TestLatin", embedded: true });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0]?.detail as string, /없는 글자/);
  const t = latin1(r.bytes);
  assert.ok(t.includes("/FontFile2") && t.includes("/Identity-H"));
  assert.equal(sha(writePdf([sheet("writer-site-a3-basic")], { font: { family: "TestLatin", ttf } }).bytes), sha(writePdf([sheet("writer-site-a3-basic")], { font: { family: "TestLatin", ttf } }).bytes));
});

test("한글 TTF 주입(ARCH_TEST_KR_FONT 또는 시스템 NanumGothic이 있을 때): 경고 0, 임베드, 결정적", { skip: KR === null && "한글 TTF 없음" }, () => {
  const ttf = KR as Uint8Array;
  const sheets = [sheet("writer-korean-long-names"), sheet("writer-mtext-escapes"), sheet("writer-site-a3-watermark-fallback")];
  const r = writePdf(sheets, { font: { family: "NanumGothic", ttf } });
  assert.deepEqual(r.font, { family: "NanumGothic", embedded: true });
  assert.deepEqual(r.warnings, []);
  assert.equal(r.page_count, 3);
  assert.equal(sha(writePdf(structuredClone(sheets), { font: { family: "NanumGothic", ttf } }).bytes), sha(r.bytes));
  // 부분 집합 임베드: 원본 글꼴보다 훨씬 작다.
  assert.ok(r.bytes.length < ttf.length / 4, `${r.bytes.length} / ${ttf.length}`);
});

test("base64 = Buffer base64(임의 바이트)", () => {
  fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), (u8) => base64(u8) === Buffer.from(u8).toString("base64")));
  const big = new Uint8Array(100_000).map((_, i) => (i * 7919) & 0xff);
  assert.equal(base64(big), Buffer.from(big).toString("base64"));
});

test("TTF 파서: head·hhea·maxp·hmtx·cmap(형식 4·12)·name", () => {
  for (const format12 of [false, true]) {
    const p = parseTtf(buildTestTtf({ format12 }));
    assert.ok(p.ok, JSON.stringify(p));
    const f = (p as { ok: true; font: TtfInfo }).font;
    assert.equal(f.units_per_em, 1000);
    assert.equal(f.num_glyphs, 7);
    assert.equal(f.family, "Test Sans");
    assert.deepEqual(
      [0x20, 0x41, 0x42, 0x43, 0xac00, 0xac01, 0xac02].map((c) => f.glyph(c)),
      [3, 1, 2, 0, 4, 5, 0],
    );
    assert.equal(f.glyph(0x1d400), format12 ? 6 : 0);
    if (!format12) assert.deepEqual([f.glyph(0x30), f.glyph(0x31)], [2, 0], "idRangeOffset 경로");
    assert.deepEqual([0, 1, 3, 4, 5, 6, 7].map((g) => f.advance(g)), [500, 600, 250, 1000, 1000, 1000, 0]);
  }
  assert.equal(parseTtf(new Uint8Array(0)).ok, false);
  assert.equal(parseTtf(buildTestTtf({ tag: 0x74746366 })).ok, false);
});

test("시스템 TTF 파서 교차 확인(있을 때): 'A' 글리프·폭이 0이 아니고 한글 글꼴은 '가'가 있다", { skip: LATIN === null && KR === null && "시스템 TTF 없음" }, () => {
  for (const ttf of [LATIN, KR]) {
    if (ttf === null) continue;
    const p = parseTtf(ttf);
    assert.ok(p.ok);
    const f = (p as { ok: true; font: TtfInfo }).font;
    assert.ok(f.glyph(0x41) > 0 && f.advance(f.glyph(0x41)) > 0);
    if (ttf === KR) assert.ok(f.glyph(0xac00) > 0);
  }
});

test("글꼴 폭 표: 같은 폭 구간 병합, 없는 글자 제외, JSON 결정적, measureText", () => {
  const f = (parseTtf(buildTestTtf({ format12: true })) as { ok: true; font: TtfInfo }).font;
  const src = { file: "test.ttf", bytes: 1, sha256: "0".repeat(64) };
  const m = buildFontMetrics(f, src, [[0xac00, 0xac02], [0x20, 0x7e], [0x1d400, 0x1d400]]);
  assert.deepEqual(m.runs, [[0x20, 0x20, 250], [0x41, 0x42, 600], [0xac00, 0xac01, 1000], [0x1d400, 0x1d400, 1000]]);
  assert.equal(m.default_advance, 500);
  assert.equal(advanceOf(m, 0x41), 600);
  assert.equal(advanceOf(m, 0x43), null);
  assert.deepEqual(measureText(m, "AB 가C", 10), { width: (600 + 600 + 250 + 1000 + 500) / 100, missing: 1 });
  const j = fontMetricsJson(m);
  assert.equal(fontMetricsJson(buildFontMetrics(f, src, [[0x20, 0x7e], [0xac00, 0xac02], [0x1d400, 0x1d400]])), j, "범위 순서 무관");
  assert.deepEqual(JSON.parse(j) as FontMetrics, m);
  assert.ok(j.endsWith("]\n}\n"));
  assert.equal(JSON.parse(fontMetricsJson({ ...m, runs: [] })).runs.length, 0);
  assert.throws(() => buildFontMetrics(f, src, [[5, 1]]), DraftingError);
});

test("PNG: 미구현 → OutputError(AR056, png_not_implemented)", () => {
  assert.throws(
    () => writePng(sheet("writer-site-a3-basic")),
    (e: unknown) => e instanceof OutputError && e.user_code === "AR056" && e.failure === "png_not_implemented",
  );
});

test("fonts/*.metrics.json: 형식·정렬·겹침 없음, 한글 음절·ASCII 포함, 글꼴 파일은 없다", () => {
  const dir = new URL("../../../fonts/", import.meta.url);
  const files = readdirSync(dir);
  assert.ok(!files.some((f) => /\.(ttf|otf|ttc|woff2?)$/i.test(f)), "글꼴 파일 커밋 금지");
  assert.ok(files.includes("README.md"));
  for (const f of files.filter((n) => n.endsWith(".metrics.json"))) {
    const text = readFileSync(new URL(f, dir), "utf8");
    const m = JSON.parse(text) as FontMetrics;
    assert.equal(m.format, "arch-font-metrics/1");
    assert.equal(fontMetricsJson(m), text, `${f} 직렬화 결정성`);
    for (let i = 1; i < m.runs.length; i++) assert.ok((m.runs[i]?.[0] as number) > (m.runs[i - 1]?.[1] as number), `${f} 구간 ${i}`);
    assert.ok(advanceOf(m, 0xac00) !== null && advanceOf(m, 0xd7a3) !== null && advanceOf(m, 0x41) !== null, f);
  }
});

test("scripts/font-metrics/generate.ts: 같은 TTF → 같은 바이트, --check 일치 0·불일치 1, 잘못된 TTF 1", () => {
  const script = new URL("../../../../../scripts/font-metrics/generate.ts", import.meta.url).pathname;
  const tmp = mkdtempSync(`${tmpdir()}/arch-font-metrics-`);
  try {
    const ttf = `${tmp}/Test.ttf`;
    writeFileSync(ttf, buildTestTtf({ format12: true }));
    const out = `${tmp}/out.json`;
    const run = (...a: string[]) => execFileSync(process.execPath, [script, ...a], { encoding: "utf8", stdio: "pipe" });
    run(ttf, "--out", out);
    const first = readFileSync(out, "utf8");
    run(ttf, "--out", out);
    assert.equal(readFileSync(out, "utf8"), first);
    const m = JSON.parse(first) as FontMetrics;
    assert.equal(m.family, "Test Sans");
    assert.equal(m.source.file, "Test.ttf");
    assert.match(run(ttf, "--out", out, "--check"), /일치/);
    writeFileSync(out, first.replace("250", "251"));
    assert.throws(() => run(ttf, "--out", out, "--check"));
    writeFileSync(`${tmp}/bad.ttf`, new Uint8Array([0, 1, 2]));
    assert.throws(() => run(`${tmp}/bad.ttf`, "--out", out));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
